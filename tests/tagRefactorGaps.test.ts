import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { prepareAdministration } from "../src/administration";
import {
  VISIBILITY_FIELD,
  current,
  type Rule,
  type Tag,
} from "../src/model";
import {
  bindTag,
  dimensionAllowsScope,
  selectableTag,
} from "../src/taxonomy";
import { applyRules, audiencesOf } from "../src/tagResults";
import { recalcRules, validateRuleDraft } from "../src/ruleImpact";
import { matchingResult, startTagMatching, advanceTagMatching } from "../src/tagMatching";
import {
  advanceUploads,
  confirmStaged,
  patchStaged,
  resolveStagedRecommendation,
  reviewProblems,
  startUploadBatch,
} from "../src/uploadReview";
import { previewTagImport, type TagImportRow } from "../src/tagTransfer";
import { auditModule } from "../src/audit";

const setup = () => {
  const s = prepareAdministration(prepareWorkspace(seedState()));
  s.userId = "u1";
  const a = s.assets[0];
  const v = current(a);
  v.title = "缺口验证文档";
  v.summary = "";
  v.content = ["第1页正文内容", "第2页正文内容"];
  v.pages = 2;
  v.kind = "PDF";
  v.process = "完成";
  v.pageStates = { 1: { status: "完成" }, 2: { status: "完成" } };
  v.approval = { mode: "exempt" };
  v.tags = [];
  v.fields = undefined;
  v.fieldsManual = undefined;
  s.suggestions = [];
  s.tasks = [];
  s.uploadBatches = [];
  s.rules = [];
  return { s, a, v };
};

const dim = (id: string, name: string, attrs: Partial<Tag> = {}): Tag => ({
  id,
  name,
  parentId: null,
  enabled: true,
  external: false,
  kind: "taxonomy",
  cardinality: "multi",
  scope: "both",
  ai: "closed",
  merge: "union",
  ...attrs,
});

const val = (id: string, parentId: string, name: string, attrs: Partial<Tag> = {}): Tag => ({
  id,
  name,
  parentId,
  enabled: true,
  external: false,
  ...attrs,
});

describe("标签体系重构缺口修复验证", () => {
  it("缺口1：拦截枚举字段、仅规则产生及作用域越界绑定与匹配", () => {
    const { s, a, v } = setup();
    s.tags = [
      dim("d-mat", "仅材料维度", { scope: "material" }),
      val("v-mat", "d-mat", "第1页正文内容"),
      dim("d-page", "仅页级维度", { scope: "page" }),
      val("v-page", "d-page", "第2页正文内容"),
      dim("d-derived", "衍生维度", { scope: "material" }),
      val("v-derived", "d-derived", "第1页正文内容", { derivedOnly: true }),
      dim(VISIBILITY_FIELD, "用户可见范围", {
        kind: "enum",
        scope: "material",
        ai: "none",
        merge: "union",
      }),
      val("v-vis", VISIBILITY_FIELD, "已认证"),
    ];

    expect(dimensionAllowsScope(s.tags, "d-mat", undefined)).toBe(true);
    expect(dimensionAllowsScope(s.tags, "d-mat", 1)).toBe(false);
    expect(dimensionAllowsScope(s.tags, "d-page", undefined)).toBe(false);
    expect(dimensionAllowsScope(s.tags, "d-page", 2)).toBe(true);
    expect(selectableTag(s.tags, s.tags.find((t) => t.id === "v-derived")!, undefined)).toBe(false);
    expect(selectableTag(s.tags, s.tags.find((t) => t.id === "v-vis")!, undefined)).toBe(false);

    expect(() => bindTag(s, a.id, a.current, "v-vis")).toThrow("枚举字段");
    expect(() => bindTag(s, a.id, a.current, "v-derived")).toThrow("仅由规则产生");
    expect(() => bindTag(s, a.id, a.current, "v-mat", 1)).toThrow("仅支持材料级");
    expect(() => bindTag(s, a.id, a.current, "v-page")).toThrow("仅支持页级");

    const matched = matchingResult(v, s.tags, s.rules);
    expect(matched.tags.some((b) => b.tagId === "v-mat" && b.page === undefined)).toBe(true);
    expect(matched.tags.some((b) => b.tagId === "v-mat" && b.page === 1)).toBe(false);
    expect(matched.tags.some((b) => b.tagId === "v-page" && b.page === undefined)).toBe(false);
    expect(matched.tags.some((b) => b.tagId === "v-page" && b.page === 2)).toBe(true);
    expect(matched.tags.some((b) => b.tagId === "v-derived")).toBe(false);

    // reviewProblems 拦截越界绑定与单值多绑
    s.tags.push(dim("d-single", "单值维度", { cardinality: "single", merge: "priority" }));
    s.tags.push(val("v-s1", "d-single", "值1"), val("v-s2", "d-single", "值2"));
    const badItem = {
      id: "item-1",
      revision: 1,
      v: {
        ...structuredClone(v),
        tags: [
          { tagId: "v-mat", origin: "人工" as const, page: 1 },
          { tagId: "v-s1", origin: "人工" as const },
          { tagId: "v-s2", origin: "AI" as const },
        ],
      },
    };
    const probs = reviewProblems(s, badItem);
    expect(probs.some((p) => p.includes("作用域"))).toBe(true);
    expect(probs.some((p) => p.includes("单值维度"))).toBe(true);
  });

  it("缺口2&3：待归档支持字段人工设置与恢复按规则，标签更新批次编辑使用冻结规则快照", () => {
    const { s, a, v } = setup();
    s.tags = [
      dim("d-type", "内容类型", { cardinality: "single", scope: "material", merge: "priority" }),
      val("v-guide", "d-type", "指南共识"),
      dim(VISIBILITY_FIELD, "用户可见范围", {
        kind: "enum",
        scope: "material",
        ai: "none",
        merge: "union",
        fallbackId: "v-cert",
        humanEditable: true,
      }),
      val("v-all", VISIBILITY_FIELD, "未注册", { order: 1 }),
      val("v-reg", VISIBILITY_FIELD, "已注册待认证", { order: 2 }),
      val("v-cert", VISIBILITY_FIELD, "已认证", { order: 3 }),
    ];
    s.rules = [
      {
        id: "r1",
        name: "指南开放",
        enabled: true,
        priority: 10,
        trigger: { dimensionId: "d-type", valueIds: ["v-guide"], match: "any" },
        action: { dimensionId: VISIBILITY_FIELD, valueIds: ["v-all", "v-reg", "v-cert"] },
      },
    ];
    v.tags = [];
    const taskId = startTagMatching(s, [a.id]);
    const task = s.tasks.find((t) => t.id === taskId)!;
    while (task.status === "处理中") advanceTagMatching(s, task);
    const batch = s.uploadBatches!.find((b) => b.id === task.batchId)!;
    const item = batch.items[0];

    // 启动后停用实时规则，但批次内保留冻结快照 r1
    s.rules[0].enabled = false;
    patchStaged(s, batch.id, item.id, {
      tags: [{ tagId: "v-guide", origin: "人工" }],
    });
    expect(item.v.fields?.[VISIBILITY_FIELD]).toEqual(["v-all", "v-reg", "v-cert"]);

    // 人工修改字段后锁定，再点击恢复按规则则按冻结快照重算
    patchStaged(s, batch.id, item.id, {
      fields: { [VISIBILITY_FIELD]: ["v-cert"] },
      fieldsManual: [VISIBILITY_FIELD],
    });
    expect(audiencesOf(item.v, s.tags)).toEqual(["已认证"]);

    patchStaged(s, batch.id, item.id, {
      fieldsManual: [],
    });
    expect(item.v.fields?.[VISIBILITY_FIELD]).toEqual(["v-all", "v-reg", "v-cert"]);
    confirmStaged(s, batch.id, item.id);
    expect(item.confirmedRevision).toBe(item.revision);
  });

  it("缺口4：待归档采纳推荐标签执行单值替换、写入排除记忆并重算派生规则", () => {
    const { s, v } = setup();
    s.tags = [
      dim("d-type", "内容类型", { cardinality: "single", scope: "material", merge: "priority" }),
      val("v-old", "d-type", "旧类型"),
      val("v-new", "d-type", "指南共识"),
      dim(VISIBILITY_FIELD, "用户可见范围", {
        kind: "enum",
        scope: "material",
        ai: "none",
        merge: "union",
        fallbackId: "v-cert",
        humanEditable: true,
      }),
      val("v-all", VISIBILITY_FIELD, "未注册"),
      val("v-cert", VISIBILITY_FIELD, "已认证"),
    ];
    s.rules = [
      {
        id: "r1",
        name: "指南对未注册开放",
        enabled: true,
        priority: 10,
        trigger: { dimensionId: "d-type", valueIds: ["v-new"], match: "any" },
        action: { dimensionId: VISIBILITY_FIELD, valueIds: ["v-all", "v-cert"] },
      },
    ];
    const batchId = startUploadBatch(
      s,
      [
        {
          id: "u-item",
          v: {
            ...structuredClone(v),
            fileKey: "k-1",
            fileHash: "h-1",
            tags: [{ tagId: "v-old", origin: "人工" }],
          },
          recommendations: [{ id: "rec-1", name: "指南共识", parentId: "d-type" }],
        },
      ],
      { mode: "exempt" },
    );
    advanceUploads(s, Date.now() + 60000, batchId);
    const item = s.uploadBatches![0].items[0];
    resolveStagedRecommendation(s, batchId, item.id, "rec-1", "v-new");

    expect(item.v.tags.filter((b) => b.origin !== "规则").map((b) => b.tagId)).toEqual(["v-new"]);
    expect(item.v.tagExclusions?.some((e) => e.valueId === "v-old")).toBe(true);
    expect(item.v.fields?.[VISIBILITY_FIELD]).toEqual(["v-all", "v-cert"]);
  });

  it("缺口5&6：规则命中但结果全停用时回落兜底值，停用或启用取值立即重算", () => {
    const { s, v } = setup();
    s.tags = [
      dim("d-type", "内容类型", { cardinality: "single", merge: "priority" }),
      val("v-guide", "d-type", "指南共识"),
      dim("d-target", "目标标签"),
      val("v-derived", "d-target", "派生标签", { derivedOnly: true }),
      dim(VISIBILITY_FIELD, "用户可见范围", {
        kind: "enum",
        scope: "material",
        ai: "none",
        merge: "union",
        fallbackId: "v-cert",
        humanEditable: true,
      }),
      val("v-all", VISIBILITY_FIELD, "未注册"),
      val("v-cert", VISIBILITY_FIELD, "已认证"),
    ];
    s.rules = [
      {
        id: "r-vis",
        name: "指南可见",
        enabled: true,
        priority: 10,
        trigger: { dimensionId: "d-type", valueIds: ["v-guide"], match: "any" },
        action: { dimensionId: VISIBILITY_FIELD, valueIds: ["v-all"] },
      },
      {
        id: "r-tag",
        name: "派生目标标签",
        enabled: true,
        priority: 10,
        trigger: { dimensionId: "d-type", valueIds: ["v-guide"], match: "any" },
        action: { dimensionId: "d-target", valueIds: ["v-derived"] },
      },
    ];
    v.tags = [{ tagId: "v-guide", origin: "AI" }];
    recalcRules(s);
    expect(v.fields?.[VISIBILITY_FIELD]).toEqual(["v-all"]);
    expect(v.tags.some((b) => b.tagId === "v-derived" && b.origin === "规则")).toBe(true);

    // 停用结果取值 v-all 与 v-derived 并重算：字段落兜底值 v-cert，规则标签撤回
    s.tags.find((t) => t.id === "v-all")!.enabled = false;
    s.tags.find((t) => t.id === "v-derived")!.enabled = false;
    recalcRules(s);
    expect(v.fields?.[VISIBILITY_FIELD]).toEqual(["v-cert"]);
    expect(v.tags.some((b) => b.tagId === "v-derived")).toBe(false);

    // 兜底值也停用时字段留空
    s.tags.find((t) => t.id === "v-cert")!.enabled = false;
    recalcRules(s);
    expect(v.fields?.[VISIBILITY_FIELD]).toBeUndefined();

    // 重新启用并重算：全部补回
    s.tags.find((t) => t.id === "v-all")!.enabled = true;
    s.tags.find((t) => t.id === "v-derived")!.enabled = true;
    s.tags.find((t) => t.id === "v-cert")!.enabled = true;
    recalcRules(s);
    expect(v.fields?.[VISIBILITY_FIELD]).toEqual(["v-all"]);
    expect(v.tags.some((b) => b.tagId === "v-derived" && b.origin === "规则")).toBe(true);
  });

  it("缺口7&防循环：规则防呆校验、互指规则单层求值防死循环、Excel校验与审计模块归属", () => {
    const tags: Tag[] = [
      dim("d-a", "维度A", { cardinality: "single", merge: "priority" }),
      val("a1", "d-a", "A1", { derivedOnly: true }),
      val("a2", "d-a", "A2"),
      dim("d-b", "维度B", { cardinality: "single", merge: "priority" }),
      val("b1", "d-b", "B1"),
      val("b2", "d-b", "B2"),
    ];
    const baseRule: Rule = {
      id: "r-new",
      name: "合法规则",
      enabled: true,
      priority: 10,
      trigger: { dimensionId: "d-a", valueIds: ["a2"], match: "any" },
      action: { dimensionId: "d-b", valueIds: ["b1"] },
    };
    expect(validateRuleDraft(tags, [], baseRule)).toBe("");
    expect(
      validateRuleDraft(tags, [], {
        ...baseRule,
        action: { dimensionId: "d-a", valueIds: ["a2"] },
      }),
    ).toContain("不能相同");
    expect(
      validateRuleDraft(tags, [], {
        ...baseRule,
        trigger: { dimensionId: "d-a", valueIds: ["a1"], match: "any" },
      }),
    ).toContain("仅规则产生");
    expect(
      validateRuleDraft(tags, [], {
        ...baseRule,
        action: { dimensionId: "d-b", valueIds: ["b1", "b2"] },
      }),
    ).toContain("单值目标维度");

    // 互指规则（A->B 与 B->A）单层求值不死循环
    const { s, v } = setup();
    s.tags = tags;
    s.rules = [
      baseRule,
      {
        id: "r-back",
        name: "反向规则",
        enabled: true,
        priority: 10,
        trigger: { dimensionId: "d-b", valueIds: ["b1"], match: "any" },
        action: { dimensionId: "d-a", valueIds: ["a1"] },
      },
    ];
    v.tags = [{ tagId: "a2", origin: "人工" }];
    applyRules(v, s.tags, s.rules);
    expect(v.tags).toEqual([
      { tagId: "a2", origin: "人工" },
      expect.objectContaining({ tagId: "b1", origin: "规则" }),
    ]);
    // 再次重算完全幂等，不会把 b1 当成触发输入去触发 a1
    applyRules(v, s.tags, s.rules);
    expect(v.tags.some((b) => b.tagId === "a1")).toBe(false);

    // Excel 导入前置防呆校验
    const badImport: TagImportRow[] = [
      {
        sheet: "维度",
        row: 2,
        name: "非法字段",
        enabled: true,
        external: false,
        kind: "enum",
        ai: "closed",
      },
      {
        sheet: "维度",
        row: 3,
        name: "非法单值",
        enabled: true,
        external: false,
        kind: "taxonomy",
        cardinality: "single",
        merge: "union",
      },
    ];
    const preview = previewTagImport(s, badImport);
    expect(preview.rows[0].error).toContain("不参与");
    expect(preview.rows[1].error).toContain("优先级");

    // 审计模块归属
    expect(auditModule({ action: "新增维度", category: "标签" })).toBe("标签管理");
    expect(auditModule({ action: "停用取值", category: "标签" })).toBe("标签管理");
    expect(auditModule({ action: "删除规则", category: "标签" })).toBe("标签管理");
  });
});
