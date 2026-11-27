import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { prepareAdministration } from "../src/administration";
import {
  VISIBILITY_FIELD,
  audienceLabel,
  current,
  primaryTagId,
  type Rule,
  type Tag,
} from "../src/model";
import { matchingResult } from "../src/tagMatching";
import { bindTag, removeTag } from "../src/taxonomy";
import { applyRules, audiencesOf, resolveRule } from "../src/tagResults";
import {
  previewTagImport,
  readTagWorkbook,
  writeTagWorkbook,
} from "../src/tagTransfer";
import { referenceTags } from "../src/referenceTags";

const base = () => {
  const s = prepareAdministration(prepareWorkspace(seedState()));
  s.userId = "u1";
  const a = s.assets[0];
  const v = current(a);
  v.title = "验收";
  v.summary = "";
  v.content = ["正文", "正文"];
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
const dimension = (name: string, attrs: Partial<Tag> = {}): Tag => ({
  id: `dim-${name}`,
  name,
  parentId: null,
  enabled: true,
  external: false,
  kind: "taxonomy",
  cardinality: "multi",
  ai: "closed",
  merge: "union",
  ...attrs,
});
const value = (qualified: string, attrs: Partial<Tag> = {}): Tag => {
  const [dim, ...rest] = qualified.split(":");
  return {
    id: `val-${qualified}`,
    name: rest.join(":"),
    parentId: `dim-${dim}`,
    enabled: true,
    external: false,
    ...attrs,
  };
};
const audienceValue = (name: string): Tag => ({
  id: `val-用户可见范围:${name}`,
  name,
  parentId: VISIBILITY_FIELD,
  enabled: true,
  external: false,
});
const rule = (attrs: Partial<Rule> = {}): Rule => ({
  id: "rule-1",
  name: "测试规则",
  enabled: true,
  priority: 10,
  trigger: {
    dimensionId: "dim-内容类型",
    valueIds: ["val-内容类型:指南共识"],
    match: "any",
  },
  action: {
    dimensionId: VISIBILITY_FIELD,
    valueIds: ["val-用户可见范围:已认证"],
  },
  ...attrs,
});

describe("打标别名", () => {
  it("正文只出现商品名（别名）时也能命中产品取值", () => {
    const { s, v } = base();
    s.tags = [
      dimension("产品", { cardinality: "single" }),
      value("产品:卡瑞利珠单抗", { aliases: ["艾瑞卡"] }),
    ];
    v.content = ["艾瑞卡用于治疗的正文", "普通内容"];
    const result = matchingResult(v, s.tags).tags;
    expect(
      result.some((b) => b.tagId === "val-产品:卡瑞利珠单抗" && !b.page),
    ).toBe(true);
    expect(
      result.some((b) => b.tagId === "val-产品:卡瑞利珠单抗" && b.page === 1),
    ).toBe(true);
    expect(
      result.some((b) => b.tagId === "val-产品:卡瑞利珠单抗" && b.page === 2),
    ).toBe(false);
  });
  it("未配置别名的取值仍按名称匹配", () => {
    const { s, v } = base();
    s.tags = [dimension("产品"), value("产品:阿帕替尼")];
    v.content = ["阿帕替尼正文", "普通内容"];
    expect(
      matchingResult(v, s.tags).tags.some(
        (b) => b.tagId === "val-产品:阿帕替尼",
      ),
    ).toBe(true);
  });
});

describe("单值维度", () => {
  it("AI 同一位置命中多个取值时按排序保留最靠前的一个", () => {
    const { s, v } = base();
    s.tags = [
      dimension("疾病领域", { cardinality: "single" }),
      value("疾病领域:肺癌", { order: 1 }),
      value("疾病领域:非小细胞肺癌", { order: 2 }),
    ];
    v.content = ["非小细胞肺癌与肺癌均出现", "普通内容"];
    const result = matchingResult(v, s.tags).tags.filter((b) => !b.page);
    expect(result).toHaveLength(1);
    expect(result[0].tagId).toBe("val-疾病领域:肺癌");
  });
  it("人工绑定单值维度的取值时替换同位置原取值，排除记忆按取值 ID 记录", () => {
    const { s, a, v } = base();
    s.tags = [
      dimension("疾病领域", { cardinality: "single" }),
      value("疾病领域:肺癌"),
      value("疾病领域:小细胞肺癌"),
    ];
    v.tags = [{ tagId: "val-疾病领域:肺癌", origin: "AI" }];
    bindTag(s, a.id, a.current, "val-疾病领域:小细胞肺癌");
    expect(v.tags.filter((b) => !b.page).map((b) => b.tagId)).toEqual([
      "val-疾病领域:小细胞肺癌",
    ]);
    expect(
      v.tagExclusions?.some(
        (e) => e.valueId === "val-疾病领域:肺癌" && !e.page,
      ),
    ).toBe(true);
  });
  it("多值维度不受单值约束影响", () => {
    const { s, a, v } = base();
    s.tags = [
      dimension("治疗方案"),
      value("治疗方案:化疗"),
      value("治疗方案:免疫治疗"),
    ];
    v.tags = [{ tagId: "val-治疗方案:化疗", origin: "AI" }];
    bindTag(s, a.id, a.current, "val-治疗方案:免疫治疗");
    expect(v.tags.filter((b) => !b.page)).toHaveLength(2);
  });
});

describe("字段与规则", () => {
  const visibilitySetup = () => {
    const ctx = base();
    ctx.s.tags = [
      dimension("内容类型", { cardinality: "single" }),
      value("内容类型:指南共识"),
      dimension("内容主题"),
      value("内容主题:方案解读"),
      dimension("用户可见范围", {
        id: VISIBILITY_FIELD,
        kind: "enum",
        cardinality: "multi",
        ai: "none",
        merge: "union",
        humanEditable: true,
      }),
      ...["未注册", "已注册待认证", "已认证"].map(audienceValue),
    ];
    ctx.s.rules = [
      rule({
        id: "all",
        priority: 10,
        action: {
          dimensionId: VISIBILITY_FIELD,
          valueIds: ["未注册", "已注册待认证", "已认证"].map(
            (name) => `val-用户可见范围:${name}`,
          ),
        },
      }),
      rule({
        id: "member",
        priority: 20,
        trigger: {
          dimensionId: "dim-内容主题",
          valueIds: ["val-内容主题:方案解读"],
          match: "any",
        },
        action: {
          dimensionId: VISIBILITY_FIELD,
          valueIds: ["已注册待认证", "已认证"].map(
            (name) => `val-用户可见范围:${name}`,
          ),
        },
      }),
    ];
    return ctx;
  };
  it("命中触发取值后推导受众集合，多条规则取并集（天然最宽）", () => {
    const { s, a, v } = visibilitySetup();
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    expect(audienceLabel(audiencesOf(v, s.tags), 3)).toBe("All三类用户");
    bindTag(s, a.id, a.current, "val-内容主题:方案解读");
    expect(audiencesOf(v, s.tags)).toEqual([
      "未注册",
      "已注册待认证",
      "已认证",
    ]);
  });
  it("单条规则命中只产出该规则的受众集合", () => {
    const { s, a, v } = visibilitySetup();
    bindTag(s, a.id, a.current, "val-内容主题:方案解读");
    expect(audiencesOf(v, s.tags)).toEqual(["已注册待认证", "已认证"]);
    expect(audienceLabel(audiencesOf(v, s.tags), 3)).toBe(
      "已注册待认证、已认证",
    );
  });
  it("人工调整受众后规则不再覆盖，清除人工标记后恢复按规则", () => {
    const { s, a, v } = visibilitySetup();
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    v.fields![VISIBILITY_FIELD] = ["val-用户可见范围:已认证"];
    v.fieldsManual = [VISIBILITY_FIELD];
    bindTag(s, a.id, a.current, "val-内容主题:方案解读");
    expect(audiencesOf(v, s.tags)).toEqual(["已认证"]);
    v.fieldsManual = [];
    applyRules(v, s.tags, s.rules);
    expect(audiencesOf(v, s.tags)).toEqual([
      "未注册",
      "已注册待认证",
      "已认证",
    ]);
  });
  it("所有规则都不命中时落兜底档", () => {
    const { s, v } = visibilitySetup();
    s.tags.find((t) => t.id === VISIBILITY_FIELD)!.fallbackId =
      "val-用户可见范围:已认证";
    applyRules(v, s.tags, s.rules);
    expect(audiencesOf(v, s.tags)).toEqual(["已认证"]);
  });
  it("优先级合并的字段只取最高优先级一条", () => {
    const { s, v } = base();
    s.tags = [
      dimension("内容类型", { cardinality: "single" }),
      value("内容类型:指南共识"),
      dimension("推广性质", {
        kind: "enum",
        cardinality: "single",
        ai: "none",
        merge: "priority",
      }),
      {
        id: "val-推广:推广",
        name: "推广",
        parentId: "dim-推广性质",
        enabled: true,
        external: false,
      },
      {
        id: "val-推广:非推广",
        name: "非推广",
        parentId: "dim-推广性质",
        enabled: true,
        external: false,
      },
    ];
    s.rules = [
      rule({
        id: "a",
        priority: 10,
        action: { dimensionId: "dim-推广性质", valueIds: ["val-推广:推广"] },
      }),
      rule({
        id: "b",
        priority: 20,
        action: { dimensionId: "dim-推广性质", valueIds: ["val-推广:非推广"] },
      }),
    ];
    v.tags = [{ tagId: "val-内容类型:指南共识", origin: "AI" }];
    applyRules(v, s.tags, s.rules);
    expect(v.fields?.["dim-推广性质"]).toEqual(["val-推广:推广"]);
  });
  it("规则结果可以只算不落库（试算），不修改内容", () => {
    const { s, v } = visibilitySetup();
    v.tags = [{ tagId: "val-内容类型:指南共识", origin: "AI" }];
    const probe = structuredClone(v);
    applyRules(probe, s.tags, s.rules);
    expect(audiencesOf(v, s.tags)).toEqual([]);
    expect(audiencesOf(probe, s.tags)).toHaveLength(3);
  });
  it("字段取值可配置：新增受众后规则与文案随之变化", () => {
    const { s, a, v } = visibilitySetup();
    s.tags.push({
      id: "val-用户可见范围:内部员工",
      name: "内部员工",
      parentId: VISIBILITY_FIELD,
      enabled: true,
      external: false,
      order: 4,
    });
    s.rules.push(
      rule({
        id: "staff",
        action: {
          dimensionId: VISIBILITY_FIELD,
          valueIds: ["val-用户可见范围:内部员工"],
        },
      }),
    );
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    expect(audiencesOf(v, s.tags)).toEqual([
      "未注册",
      "已注册待认证",
      "已认证",
      "内部员工",
    ]);
    expect(audienceLabel(audiencesOf(v, s.tags), 4)).toBe("全部 4 类用户");
  });
  it("触发按取值 ID 匹配，改名后规则仍生效", () => {
    const { s, a, v } = visibilitySetup();
    s.tags.find((t) => t.id === "val-内容类型:指南共识")!.name = "指南与共识";
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    expect(audienceLabel(audiencesOf(v, s.tags), 3)).toBe("All三类用户");
  });
});

describe("规则派生标签", () => {
  const setup = () => {
    const ctx = base();
    ctx.s.tags = [
      dimension("内容类型", { cardinality: "single" }),
      value("内容类型:指南共识"),
      dimension("关联产品"),
      value("关联产品:卡瑞利珠单抗"),
    ];
    ctx.s.rules = [
      rule({
        id: "derive",
        action: {
          dimensionId: "dim-关联产品",
          valueIds: ["val-关联产品:卡瑞利珠单抗"],
        },
      }),
    ];
    return ctx;
  };
  it("规则产出的取值来源记为「规则」并带 ruleId，落材料级", () => {
    const { s, a, v } = setup();
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    const derived = v.tags.find((b) => b.tagId === "val-关联产品:卡瑞利珠单抗");
    expect(derived?.origin).toBe("规则");
    expect(derived?.ruleId).toBe("derive");
    expect(derived?.page).toBeUndefined();
  });
  it("触发消失后规则产物自动撤销", () => {
    const { s, a, v } = setup();
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    removeTag(s, a.id, a.current, "val-内容类型:指南共识");
    expect(v.tags.some((b) => b.tagId === "val-关联产品:卡瑞利珠单抗")).toBe(
      false,
    );
  });
  it("人工移除规则产物后不再补回，人工添加可恢复", () => {
    const { s, a, v } = setup();
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    removeTag(s, a.id, a.current, "val-关联产品:卡瑞利珠单抗");
    expect(v.tags.some((b) => b.tagId === "val-关联产品:卡瑞利珠单抗")).toBe(
      false,
    );
    bindTag(s, a.id, a.current, "val-内容类型:指南共识");
    expect(v.tags.some((b) => b.tagId === "val-关联产品:卡瑞利珠单抗")).toBe(
      false,
    );
    bindTag(s, a.id, a.current, "val-关联产品:卡瑞利珠单抗");
    expect(
      v.tags.some(
        (b) => b.tagId === "val-关联产品:卡瑞利珠单抗" && b.origin === "人工",
      ),
    ).toBe(true);
  });
  it("仅由规则产生的取值不参与 AI 直出", () => {
    const { s, v } = setup();
    s.tags.find((t) => t.id === "val-关联产品:卡瑞利珠单抗")!.derivedOnly =
      true;
    v.content = ["正文提到卡瑞利珠单抗", "普通内容"];
    const result = matchingResult(v, s.tags, s.rules).tags;
    expect(
      result.filter((b) => b.tagId === "val-关联产品:卡瑞利珠单抗"),
    ).toHaveLength(0);
  });
  it("规则求值可单维度读取（试算 / 冲突提示用）", () => {
    const { s, v } = setup();
    v.tags = [{ tagId: "val-内容类型:指南共识", origin: "AI" }];
    const result = resolveRule(v, "dim-关联产品", s.tags, s.rules);
    expect(result.valueIds).toEqual(["val-关联产品:卡瑞利珠单抗"]);
    expect(result.ruleId).toBe("derive");
  });
});

describe("旧数据迁移", () => {
  const legacySeed = () => {
    const s = seedState();
    const root = primaryTagId("用户可见范围");
    s.tags.push(
      {
        id: root,
        name: "用户可见范围",
        parentId: null,
        enabled: true,
        external: false,
      },
      {
        id: "vis-all",
        name: "All三类用户",
        parentId: root,
        enabled: true,
        external: false,
      },
    );
    const a = s.assets[0];
    const v = current(a);
    v.tags.push({ tagId: "vis-all", origin: "人工" });
    (v as unknown as { visibilityManual?: boolean }).visibilityManual = true;
    const trigger = s.tags.find((t) => t.id === "t8");
    if (trigger)
      (s as unknown as { visibilityRules?: unknown }).visibilityRules = [
        { visibility: "已认证", triggers: [trigger.id] },
      ];
    return { s, a };
  };
  it("可见范围标签取值迁移为字段值（受众集合），旧标签树移除", () => {
    const { s, a } = legacySeed();
    const out = prepareWorkspace(s);
    const migrated = current(out.assets.find((x) => x.id === a.id)!);
    expect(audiencesOf(migrated, out.tags)).toEqual([
      "未注册",
      "已注册待认证",
      "已认证",
    ]);
    expect(migrated.fieldsManual).toContain(VISIBILITY_FIELD);
    expect(out.tags.some((t) => t.id === "vis-all")).toBe(false);
    expect(
      out.tags.some((t) => t.id === "vis-all" || t.parentId === "vis-all"),
    ).toBe(false);
  });
  it("旧可见范围触发配置转为规则，触发关系按新取值 ID 保留", () => {
    const { s } = legacySeed();
    const out = prepareWorkspace(s);
    const converted = out.rules.find(
      (r) => r.id === "rule-legacy-visibility-1",
    );
    expect(converted?.action.dimensionId).toBe(VISIBILITY_FIELD);
    const actionNames = converted!.action.valueIds.map(
      (id) => out.tags.find((t) => t.id === id)?.name,
    );
    expect(actionNames).toEqual(["已认证"]);
    expect(converted?.trigger.valueIds).toHaveLength(1);
    expect(
      out.tags.find((t) => t.id === converted!.trigger.valueIds[0])?.name,
    ).toBe("循证医学");
    expect(out.rules.length).toBeGreaterThan(0);
  });
  it("不再有任何写死 / 不可编辑的标签", () => {
    const out = prepareWorkspace(seedState());
    expect(out.tags.every((t) => !("locked" in t))).toBe(true);
    expect(out.tags.every((t) => !("manualOnly" in t))).toBe(true);
    expect(out.tags.every((t) => !("deriveFrom" in t))).toBe(true);
  });
  it("产品取值预置通用名别名", () => {
    const out = prepareWorkspace(seedState());
    const tag = out.tags.find((t) => t.name === "卡瑞利珠单抗");
    expect(tag?.aliases).toContain("艾瑞卡");
  });
  it("排除记忆迁移为取值 ID", () => {
    const s = seedState();
    const parent = primaryTagId("疾病领域");
    s.tags.push({
      id: "keep-1",
      name: "自建取值",
      parentId: parent,
      enabled: true,
      external: false,
    });
    current(s.assets[0]).tagExclusions = [
      { name: "自建取值", parentId: parent },
    ];
    const out = prepareWorkspace(s);
    const entry = current(out.assets.find((x) => x.id === "a1")!)
      .tagExclusions?.[0];
    expect(entry?.valueId).toBe("keep-1");
    expect(entry?.name).toBe("自建取值");
  });
});

describe("标签 Excel 别名导入导出", () => {
  it("导出的标签表包含别名列，读回后别名完整还原", async () => {
    const s = prepareWorkspace(seedState());
    const blob = await writeTagWorkbook(s.tags);
    const rows = await readTagWorkbook(await blob.arrayBuffer());
    const exported = rows.find((r) => r.name === "卡瑞利珠单抗");
    expect(exported?.aliases).toEqual(["艾瑞卡"]);
    const preview = previewTagImport(s, rows);
    expect(preview.rows.some((r) => r.error)).toBe(false);
    const unchanged = preview.rows.find((r) => r.name === "卡瑞利珠单抗");
    expect(unchanged?.action).toBe("无变化");
  });
  it("维度属性在导入导出后保留", async () => {
    const s = prepareWorkspace(seedState());
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags)).arrayBuffer(),
    );
    const preview = previewTagImport(s, rows);
    const dim = preview.tags.find((t) => t.name === "用户可见范围");
    expect(dim?.kind).toBe("enum");
    expect(dim?.merge).toBe("union");
    expect(referenceTags.some((t) => t.name === "内容类型")).toBe(true);
  });
});
