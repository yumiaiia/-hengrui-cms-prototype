import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { refValueId } from "../src/referenceTags";
import { VISIBILITY_FIELD } from "../src/model";
import { priorityConflict, recalcRules, ruleImpact } from "../src/ruleImpact";
import { prepareAdministration } from "../src/administration";
import { advanceTagMatching, startTagMatching } from "../src/tagMatching";
import {
  previewTagImport,
  readTagWorkbook,
  writeTagWorkbook,
  type TagImportRow,
} from "../src/tagTransfer";

const setup = () => prepareWorkspace(seedState());

describe("规则影响面", () => {
  it("按命中触发取值统计受影响内容", () => {
    const s = setup();
    const all = s.rules.find((r) => r.id === "rule-preset-audience-all")!;
    const member = s.rules.find(
      (r) => r.id === "rule-preset-audience-member",
    )!;
    const allIds = ruleImpact(s, all);
    expect(allIds.length).toBeGreaterThan(0);
    expect(allIds.every((id) => s.assets.some((a) => a.id === id))).toBe(true);
    expect(new Set([...allIds, ...ruleImpact(s, member)]).size).toBeLessThanOrEqual(
      s.assets.length,
    );
  });
  it("改规则后立即重算，人工改过的字段不被覆盖", () => {
    const s = setup();
    const manual = s.assets[0];
    const manualVersion = manual.versions.find(
      (v) => v.number === manual.current,
    )!;
    manualVersion.fields ||= {};
    manualVersion.fields[VISIBILITY_FIELD] = [
      refValueId("用户可见范围", "已认证"),
    ];
    manualVersion.fieldsManual = [VISIBILITY_FIELD];
    const rule = s.rules.find((r) => r.id === "rule-preset-audience-all")!;
    rule.action.valueIds = [refValueId("用户可见范围", "已认证")];
    const changed = recalcRules(s);
    expect(changed).toBeGreaterThan(0);
    expect(
      manualVersion.fields[VISIBILITY_FIELD],
    ).toEqual([refValueId("用户可见范围", "已认证")]);
    const other = s.assets.find(
      (a) =>
        a.id !== manual.id &&
        (a.versions.find((v) => v.number === a.current)!.fields?.[
          VISIBILITY_FIELD
        ] || []).length === 1,
    );
    expect(other).toBeTruthy();
  });
  it("停用规则后重算会撤销规则产物", () => {
    const s = setup();
    const rule = s.rules.find((r) => r.id === "rule-preset-audience-all")!;
    expect(
      s.assets.some((a) =>
        (a.versions.find((v) => v.number === a.current)!.fields?.[
          VISIBILITY_FIELD
        ] || []).includes(refValueId("用户可见范围", "未注册")),
      ),
    ).toBe(true);
    rule.enabled = false;
    recalcRules(s);
    expect(
      s.assets.some((a) =>
        (a.versions.find((v) => v.number === a.current)!.fields?.[
          VISIBILITY_FIELD
        ] || []).includes(refValueId("用户可见范围", "未注册")),
      ),
    ).toBe(false);
  });
});

describe("批次规则快照", () => {
  it("批次启动后改规则不影响本批结果", () => {
    const s = prepareAdministration(setup());
    s.userId = "u1";
    const asset = s.assets.find((a) => a.id === "a1")!;
    const taskId = startTagMatching(s, [asset.id]);
    const task = s.tasks.find((t) => t.id === taskId)!;
    const batch = s.uploadBatches!.find((b) => b.id === task.batchId)!;
    expect(batch.ruleSnapshot?.length).toBe(s.rules.length);
    for (const rule of s.rules) rule.enabled = false;
    for (let i = 0; task.status === "处理中" && i < 50; i++)
      advanceTagMatching(s, task);
    const item = batch.items[0];
    // 规则已全部停用；仍能产出结果，说明批次用的是启动时的规则快照。
    const fields = item.v.fields?.[VISIBILITY_FIELD] || [];
    expect(fields.length).toBeGreaterThan(0);
  });
});

describe("优先级唯一", () => {
  it("同一目标维度下优先级重复会被识别", () => {
    const s = setup();
    const first = s.rules.find((r) => r.id === "rule-preset-audience-all")!;
    const second = s.rules.find(
      (r) => r.id === "rule-preset-audience-member",
    )!;
    expect(priorityConflict(s.rules, second)).toBeUndefined();
    const draft = { ...second, priority: first.priority };
    expect(priorityConflict(s.rules, draft)?.id).toBe(first.id);
    // 不同目标维度可以同优先级
    const channel = s.rules.find(
      (r) => r.id === "rule-preset-channel-wework",
    )!;
    expect(
      priorityConflict(s.rules, { ...channel, priority: first.priority }),
    ).toBeUndefined();
  });
});

describe("Excel 三表交换", () => {
  it("维度 / 取值 / 规则三表导出后可原样读回", async () => {
    const s = setup();
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags, s.rules)).arrayBuffer(),
    );
    expect(new Set(rows.map((r) => r.sheet))).toEqual(
      new Set(["维度", "取值", "规则"]),
    );
    const preview = previewTagImport(s, rows);
    expect(preview.rows.some((r) => r.error)).toBe(false);
    expect(preview.added + preview.updated).toBe(0);
    expect(preview.unchanged).toBe(s.tags.length + s.rules.length);
  });
  it("规则表改动可被识别为更新", async () => {
    const s = setup();
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags, s.rules)).arrayBuffer(),
    );
    const row = rows.find((r) => r.sheet === "规则" && r.rule)!;
    row.rule!.priority = 5;
    const preview = previewTagImport(s, rows);
    expect(preview.updated).toBe(1);
    expect(preview.rows.find((r) => r.sheet === "规则")?.action).toBe("更新");
  });
  it("规则引用了不存在的取值时整行报错", async () => {
    const s = setup();
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags, s.rules)).arrayBuffer(),
    );
    const row = rows.find((r) => r.sheet === "规则" && r.rule)!;
    row.rule!.triggerValues = ["不存在的取值"];
    const preview = previewTagImport(s, rows);
    expect(
      preview.rows.find((r) => r.sheet === "规则")?.error,
    ).toContain("触发取值不存在");
  });
  it("新增字段与其兜底值同批导入可解析", () => {
    const s = setup();
    const rows: TagImportRow[] = [
      {
        sheet: "维度",
        row: 2,
        name: "新字段",
        enabled: true,
        external: false,
        kind: "enum",
        cardinality: "multi",
        ai: "none",
        merge: "union",
        fallback: "甲",
        humanEditable: true,
      },
      {
        sheet: "取值",
        row: 2,
        name: "甲",
        parentName: "新字段",
        enabled: true,
        external: false,
      },
      {
        sheet: "取值",
        row: 3,
        name: "乙",
        parentName: "新字段",
        enabled: true,
        external: false,
      },
    ];
    const preview = previewTagImport(s, rows);
    expect(preview.rows.some((r) => r.error)).toBe(false);
    const dimension = preview.tags.find((t) => t.name === "新字段")!;
    expect(preview.tags.find((t) => t.id === dimension.fallbackId)?.name).toBe(
      "甲",
    );
  });
  it("同一目标维度优先级重复时导入报错", async () => {
    const s = setup();
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags, s.rules)).arrayBuffer(),
    );
    const ruleRows = rows.filter((r) => r.sheet === "规则" && r.rule);
    ruleRows[1].rule!.priority = ruleRows[0].rule!.priority;
    const preview = previewTagImport(s, rows);
    expect(
      preview.rows.find(
        (r) => r.sheet === "规则" && r.row === ruleRows[1].row,
      )?.error,
    ).toContain("优先级不能重复");
  });
  it("导入不允许修改维度类型", async () => {
    const s = setup();
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags, s.rules)).arrayBuffer(),
    );
    const dimension = rows.find(
      (r) => r.sheet === "维度" && r.name === "用户可见范围",
    )!;
    dimension.kind = "taxonomy";
    const preview = previewTagImport(s, rows);
    expect(
      preview.rows.find(
        (r) => r.sheet === "维度" && r.row === dimension.row,
      )?.error,
    ).toContain("类型创建后不可修改");
  });
  it("维度属性在往返后保持", async () => {
    const s = setup();
    const rows = await readTagWorkbook(
      await (await writeTagWorkbook(s.tags, s.rules)).arrayBuffer(),
    );
    const dimension = rows.find((r) => r.sheet === "维度" && r.name === "用户可见范围");
    expect(dimension?.kind).toBe("enum");
    expect(dimension?.merge).toBe("union");
    expect(dimension?.fallback).toBe("已认证");
    const preview = previewTagImport(s, rows);
    const tag = preview.tags.find((t) => t.name === "用户可见范围")!;
    expect(tag.fallbackId).toBe(refValueId("用户可见范围", "已认证"));
  });
});
