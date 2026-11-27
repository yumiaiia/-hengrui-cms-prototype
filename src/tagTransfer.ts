import { captureBindingNames } from "./tagResults";
import { similarTags, normalizeTagName } from "./tagSimilarity";
import {
  canRole,
  uid,
  type Cardinality,
  type Rule,
  type State,
  type Tag,
} from "./model";
import { validateTag } from "./taxonomy";
import { tagImpact, tagUsage } from "./tagMatching";
import { recalcRules, ruleImpact } from "./ruleImpact";

/** 一次导入可能包含三类行：维度、取值、规则。 */
export type ImportSheet = "维度" | "取值" | "规则";
export interface TagImportRow {
  sheet: ImportSheet;
  row: number;
  id?: string;
  name: string;
  parentId?: string;
  parentName?: string;
  enabled: boolean;
  external: boolean;
  aliases?: string[];
  kind?: "taxonomy" | "enum";
  cardinality?: Cardinality;
  scope?: "material" | "page" | "both";
  ai?: "closed" | "open" | "none";
  merge?: "union" | "priority";
  fallback?: string;
  humanEditable?: boolean;
  derivedOnly?: boolean;
  order?: number;
  rule?: {
    triggerDimension: string;
    triggerValues: string[];
    match: "any" | "all";
    actionDimension: string;
    actionValues: string[];
    priority: number;
  };
  error?: string;
}
export interface TagImportPreview {
  tags: Tag[];
  rules: Rule[];
  input: TagImportRow[];
  decisions: Record<string, "keep" | "skip">;
  rows: {
    sheet: ImportSheet;
    row: number;
    name: string;
    action: string;
    changes?: string;
    error?: string;
    similar?: {
      id: string;
      name: string;
      parentId: string | null;
      enabled: boolean;
    }[];
    decision?: "keep" | "skip";
  }[];
  added: number;
  updated: number;
  unchanged: number;
  affected: number;
  baseline: string;
}
const dimensionHeaders = [
  "ID",
  "维度名称",
  "类型",
  "基数",
  "作用域",
  "AI 匹配",
  "合并策略",
  "兜底值",
  "允许人工修改",
];
const valueHeaders = [
  "ID",
  "维度ID",
  "维度名称",
  "取值",
  "别名",
  "排序",
  "仅规则产生",
  "启用",
  "对外展示",
];
const ruleHeaders = [
  "ID",
  "规则名称",
  "触发维度",
  "触发取值",
  "匹配方式",
  "目标维度",
  "结果取值",
  "优先级",
  "启用",
];
const yesNo = (value?: boolean) => (value ? "是" : "否");
const listCell = (values?: string[]) => (values || []).join("、");
export const parseAliasCell = (value: string) => [
  ...new Set(
    value
      .split(/[\n,，、;；]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const KIND_LABEL = { taxonomy: "分类维度", enum: "字段" } as const;
const KIND_VALUE = { 分类维度: "taxonomy", 字段: "enum" } as const;
const SCOPE_LABEL = {
  material: "材料级",
  page: "页级",
  both: "材料级与页级",
} as const;
const SCOPE_VALUE: Record<string, "material" | "page" | "both"> = {
  材料级: "material",
  页级: "page",
  材料级与页级: "both",
  两者: "both",
};
const AI_LABEL = { closed: "闭集", open: "开放", none: "不参与" } as const;
const AI_VALUE: Record<string, "closed" | "open" | "none"> = {
  闭集: "closed",
  闭集参与: "closed",
  开放: "open",
  开放参与: "open",
  不参与: "none",
};
const MERGE_LABEL = { union: "并集", priority: "优先级" } as const;
const MERGE_VALUE: Record<string, "union" | "priority"> = {
  并集: "union",
  优先级: "priority",
};
const MATCH_LABEL = { any: "任一命中", all: "全部命中" } as const;
const MATCH_VALUE: Record<string, "any" | "all"> = {
  任一命中: "any",
  全部命中: "all",
  任一: "any",
  全部: "all",
};
function styleSheet(sheet: import("exceljs").Worksheet, width: number) {
  sheet.columns.forEach((column, index) => (column.width = index === 0 ? 38 : 24));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).eachCell(
    (cell) =>
      (cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF245AB5" },
      }),
  );
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: { row: 1, column: width } };
}
export async function writeTagWorkbook(
  tags: Tag[],
  rules: Rule[] = [],
  template = false,
) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  const dimensions = tags.filter((t) => t.parentId === null);
  const values = tags.filter((t) => t.parentId !== null);
  const nameOf = (id?: string) => tags.find((t) => t.id === id)?.name || "";
  const dimensionSheet = book.addWorksheet("维度");
  dimensionSheet.addRow(dimensionHeaders);
  for (const dimension of template ? [] : dimensions)
    dimensionSheet.addRow([
      dimension.id,
      dimension.name,
      KIND_LABEL[dimension.kind || "taxonomy"],
      dimension.cardinality === "single" ? "单值" : "多值",
      SCOPE_LABEL[dimension.scope || "material"],
      AI_LABEL[dimension.ai || "closed"],
      MERGE_LABEL[dimension.merge || "union"],
      nameOf(dimension.fallbackId),
      yesNo(dimension.humanEditable),
    ]);
  styleSheet(dimensionSheet, dimensionHeaders.length);
  const valueSheet = book.addWorksheet("取值");
  valueSheet.addRow(valueHeaders);
  for (const value of template ? [] : values)
    valueSheet.addRow([
      value.id,
      value.parentId,
      nameOf(value.parentId || undefined),
      value.name,
      listCell(value.aliases),
      value.order ?? "",
      yesNo(value.derivedOnly),
      yesNo(value.enabled),
      yesNo(value.external),
    ]);
  styleSheet(valueSheet, valueHeaders.length);
  const ruleSheet = book.addWorksheet("规则");
  ruleSheet.addRow(ruleHeaders);
  for (const rule of template ? [] : rules)
    ruleSheet.addRow([
      rule.id,
      rule.name,
      nameOf(rule.trigger.dimensionId),
      listCell(
        rule.trigger.valueIds.map((id) => nameOf(id)).filter(Boolean),
      ),
      MATCH_LABEL[rule.trigger.match],
      nameOf(rule.action.dimensionId),
      listCell(rule.action.valueIds.map((id) => nameOf(id)).filter(Boolean)),
      rule.priority,
      yesNo(rule.enabled),
    ]);
  styleSheet(ruleSheet, ruleHeaders.length);
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
function assertHeader(
  sheet: import("exceljs").Worksheet,
  expected: string[],
) {
  if (expected.some((h, i) => sheet.getRow(1).getCell(i + 1).text !== h))
    throw new Error(`${sheet.name} 表头不正确，请使用导入模板`);
}
export async function readTagWorkbook(
  buffer: ArrayBuffer,
): Promise<TagImportRow[]> {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  await book.xlsx.load(buffer);
  const rows: TagImportRow[] = [];
  const dimensionSheet = book.getWorksheet("维度");
  const valueSheet = book.getWorksheet("取值");
  const ruleSheet = book.getWorksheet("规则");
  if (!dimensionSheet || !valueSheet)
    throw new Error("缺少工作表：维度 / 取值");
  assertHeader(dimensionSheet, dimensionHeaders);
  assertHeader(valueSheet, valueHeaders);
  const readRows = (
    sheet: import("exceljs").Worksheet,
    headers: string[],
    build: (cells: string[], formula: boolean, index: number) => TagImportRow,
  ) =>
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const cells = headers.map((_, i) => row.getCell(i + 1).text.trim());
      if (!cells.some(Boolean)) return;
      const formula = headers.some((_, i) => row.getCell(i + 1).type === 6);
      rows.push(build(cells, formula, index));
    });
  readRows(dimensionSheet, dimensionHeaders, (cells, formula, index) => {
    const invalid = !["是", "否"].includes(cells[8]);
    return {
      sheet: "维度",
      row: index,
      id: cells[0] || undefined,
      name: cells[1],
      // 维度禁止停用：导入一律视为启用。
      enabled: true,
      external: false,
      kind: KIND_VALUE[cells[2] as keyof typeof KIND_VALUE],
      cardinality: cells[3] === "单值" ? "single" : "multi",
      scope: SCOPE_VALUE[cells[4]],
      ai: AI_VALUE[cells[5]],
      merge: MERGE_VALUE[cells[6]],
      fallback: cells[7] || undefined,
      humanEditable: cells[8] === "是",
      error: formula
        ? "请填写文本，不支持公式"
        : invalid
          ? "允许人工修改须填写是或否"
          : !cells[1]
            ? "维度名称必填"
            : undefined,
    };
  });
  readRows(valueSheet, valueHeaders, (cells, formula, index) => {
    const aliases = parseAliasCell(cells[4] || "");
    const invalid = [cells[7], cells[8]].some(
      (value) => !["是", "否"].includes(value),
    );
    return {
      sheet: "取值",
      row: index,
      id: cells[0] || undefined,
      parentId: cells[1] || undefined,
      parentName: cells[2] || undefined,
      name: cells[3],
      aliases,
      order: cells[5] ? Number(cells[5]) : undefined,
      derivedOnly: cells[6] === "是",
      enabled: cells[7] === "是",
      external: cells[8] === "是",
      error: formula
        ? "请填写文本，不支持公式"
        : invalid
          ? "启用、对外展示须填写是或否"
          : !cells[3]
            ? "取值名称必填"
            : undefined,
    };
  });
  if (ruleSheet) {
    assertHeader(ruleSheet, ruleHeaders);
    readRows(ruleSheet, ruleHeaders, (cells, formula, index) => ({
      sheet: "规则",
      row: index,
      id: cells[0] || undefined,
      name: cells[1],
      enabled: cells[8] === "是",
      external: false,
      rule: {
        triggerDimension: cells[2],
        triggerValues: parseAliasCell(cells[3] || ""),
        match: MATCH_VALUE[cells[4] || "任一命中"] || "any",
        actionDimension: cells[5],
        actionValues: parseAliasCell(cells[6] || ""),
        priority: Number(cells[7] || 50),
      },
      error: formula
        ? "请填写文本，不支持公式"
        : !cells[1]
          ? "规则名称必填"
          : undefined,
    }));
  }
  return rows;
}
export function previewTagImport(
  state: State,
  input: TagImportRow[],
  decisions: Record<string, "keep" | "skip"> = {},
): TagImportPreview {
  const tags = structuredClone(state.tags);
  const rules = structuredClone(state.rules || []);
  const rows: TagImportPreview["rows"] = [];
  const seen = new Set<string>();
  const changed: string[] = [];
  const changedRules: string[] = [];
  const assignedIds = new Map<string, string>();
  const pendingFallback: { dimensionId: string; name: string; sheet: string; row: number }[] = [];
  let added = 0,
    updated = 0,
    unchanged = 0;
  const dimensionByName = (name: string) =>
    tags.find(
      (t) => t.parentId === null && normalizeTagName(t.name) === normalizeTagName(name),
    );
  const valueByName = (dimensionId: string | undefined, name: string) =>
    tags.find(
      (t) =>
        t.parentId === dimensionId &&
        normalizeTagName(t.name) === normalizeTagName(name),
    );
  const order = { 维度: 0, 取值: 1, 规则: 2 } as const;
  for (const row of [...input].sort((a, b) => order[a.sheet] - order[b.sheet])) {
    try {
      const decision = decisions[`${row.sheet}-${row.row}`];
      if (decision === "skip") {
        rows.push({
          sheet: row.sheet,
          row: row.row,
          name: row.name,
          action: "跳过",
          decision,
        });
        continue;
      }
      if (row.error) throw new Error(row.error);
      if (row.sheet === "规则") {
        const spec = row.rule!;
        const triggerDimension =
          dimensionByName(spec.triggerDimension) ||
          tags.find((t) => t.id === spec.triggerDimension);
        const actionDimension =
          dimensionByName(spec.actionDimension) ||
          tags.find((t) => t.id === spec.actionDimension);
        if (!triggerDimension) throw new Error("触发维度不存在");
        if (!actionDimension) throw new Error("目标维度不存在");
        if (triggerDimension.id === actionDimension.id)
          throw new Error("触发维度与目标维度不能相同");
        const triggerValues = spec.triggerValues.map((name) => {
          const value = valueByName(triggerDimension.id, name);
          if (!value) throw new Error(`触发取值不存在：${name}`);
          if (value.derivedOnly)
            throw new Error(`仅规则产生的取值不能作为触发条件：${name}`);
          return value.id;
        });
        const actionValues = spec.actionValues.map((name) => {
          const value = valueByName(actionDimension.id, name);
          if (!value) throw new Error(`结果取值不存在：${name}`);
          return value.id;
        });
        if (!triggerValues.length) throw new Error("至少一个触发取值");
        if (!actionValues.length) throw new Error("至少一个结果取值");
        if (actionDimension.cardinality === "single" && actionValues.length > 1)
          throw new Error("单值目标维度每条规则仅能选择一个结果取值");
        const old = row.id
          ? rules.find((r) => r.id === row.id)
          : rules.find((r) => r.name === row.name);
        const priority = Number.isFinite(spec.priority) ? spec.priority : 50;
        const clash = rules.find(
          (r) =>
            r.id !== old?.id &&
            r.action.dimensionId === actionDimension.id &&
            r.priority === priority,
        );
        if (clash)
          throw new Error(
            `同一目标维度的优先级不能重复：${priority}（${clash.name}）`,
          );
        const rule: Rule = {
          id: old?.id || row.id || uid("rule"),
          name: row.name,
          enabled: row.enabled,
          priority,
          trigger: {
            dimensionId: triggerDimension.id,
            valueIds: triggerValues,
            match: spec.match,
          },
          action: { dimensionId: actionDimension.id, valueIds: actionValues },
        };
        const same =
          !!old &&
          JSON.stringify({ ...old, id: "" }) ===
            JSON.stringify({ ...rule, id: "" });
        if (!old) {
          rules.push(rule);
          added++;
        } else if (same) unchanged++;
        else {
          Object.assign(old, rule);
          updated++;
          changedRules.push(rule.id);
        }
        rows.push({
          sheet: "规则",
          row: row.row,
          name: row.name,
          action: !old ? "新增" : same ? "无变化" : "更新",
          changes: old && !same ? "规则条件或结果有变化" : undefined,
          decision,
        });
        continue;
      }
      const isDimension = row.sheet === "维度";
      const parent = isDimension
        ? undefined
        : row.parentId
          ? tags.find((t) => t.id === row.parentId && t.parentId === null)
          : dimensionByName(row.parentName || "");
      if (!isDimension && !parent) throw new Error("所属维度不存在");
      const old = row.id
        ? tags.find((t) => t.id === row.id)
        : tags.find(
            (t) =>
              t.parentId === (parent?.id || null) &&
              normalizeTagName(t.name) === normalizeTagName(row.name),
          );
      if (old && (old.parentId === null) !== isDimension)
        throw new Error("不能改变维度与取值的层级");
      if (isDimension && old && old.kind && row.kind && old.kind !== row.kind)
        throw new Error("维度类型创建后不可修改");
      const effectiveKind =
        (isDimension ? row.kind || old?.kind : undefined) || "taxonomy";
      const effectiveCardinality =
        (isDimension ? row.cardinality || old?.cardinality : undefined) ||
        "multi";
      if (isDimension && effectiveKind === "enum" && row.ai && row.ai !== "none")
        throw new Error("枚举字段不支持 AI 匹配，请设为不参与");
      if (
        isDimension &&
        effectiveKind === "enum" &&
        row.scope &&
        row.scope !== "material"
      )
        throw new Error("枚举字段作用域仅支持材料级");
      if (
        isDimension &&
        effectiveCardinality === "single" &&
        row.merge === "union"
      )
        throw new Error("单值维度合并策略仅支持优先级");
      const fallback = row.fallback
        ? valueByName(parent?.id || old?.id, row.fallback) ||
          tags.find((t) => t.id === row.fallback)
        : undefined;
      const tag: Tag = {
        ...(old || {}),
        id: old?.id || row.id || uid("tag"),
        name: row.name.trim(),
        parentId: parent?.id || null,
        enabled: row.enabled,
        external: row.external,
        aliases: isDimension
          ? undefined
          : row.aliases?.length
            ? row.aliases
            : undefined,
        ...(isDimension
          ? {
              kind: effectiveKind,
              cardinality: effectiveCardinality,
              scope:
                effectiveKind === "enum" ? "material" : row.scope || "material",
              ai: effectiveKind === "enum" ? "none" : row.ai || "closed",
              merge:
                effectiveCardinality === "single"
                  ? "priority"
                  : row.merge || "union",
              fallbackId: fallback?.id,
              humanEditable: row.humanEditable,
            }
          : {
              derivedOnly: row.derivedOnly || undefined,
              order: Number.isFinite(row.order) ? row.order : old?.order,
            }),
      };
      // 兜底值可能写在后面的"取值"表里，先记下来，整轮处理完再解析。
      if (isDimension && row.fallback && !fallback)
        pendingFallback.push({
          dimensionId: tag.id,
          name: row.fallback,
          sheet: row.sheet,
          row: row.row,
        });
      if (seen.has(tag.id)) throw new Error("文件中存在重复取值");
      seen.add(tag.id);
      if (!isDimension) {
        const error = validateTag(tags, tag);
        if (error) throw new Error(error);
      }
      const same =
        old &&
        ["name", "parentId", "enabled", "external", "kind", "cardinality", "ai"].every(
          (key) => old[key as keyof Tag] === tag[key as keyof Tag],
        ) &&
        (old.scope || "material") === (tag.scope || "material") &&
        (old.merge || "union") === (tag.merge || "union") &&
        old.fallbackId === tag.fallbackId &&
        !!old.humanEditable === !!tag.humanEditable &&
        !!old.derivedOnly === !!tag.derivedOnly &&
        old.order === tag.order &&
        JSON.stringify(old.aliases || []) === JSON.stringify(tag.aliases || []);
      const action = !old ? "新增" : same ? "无变化" : "更新";
      const similar =
        !isDimension && (!old || old.name !== tag.name || old.parentId !== tag.parentId)
          ? similarTags(tags, tag).map((x) => x.tag)
          : [];
      const changes =
        old && !same
          ? [
              old.name !== tag.name ? `${old.name} → ${tag.name}` : "",
              ...tagImpact(old, tag),
            ]
              .filter(Boolean)
              .join("；")
          : "";
      if (!old) {
        if (!row.id) assignedIds.set(`${row.sheet}-${row.row}`, tag.id);
        tags.push(tag);
        added++;
      } else if (same) unchanged++;
      else {
        Object.assign(old, tag);
        updated++;
        changed.push(tag.id);
      }
      rows.push({
        sheet: row.sheet,
        row: row.row,
        name: row.name,
        action,
        changes,
        similar,
        decision,
      });
    } catch (e) {
      rows.push({
        sheet: row.sheet,
        row: row.row,
        name: row.name,
        action: "错误",
        error: e instanceof Error ? e.message : "格式错误",
      });
    }
  }
  for (const pending of pendingFallback) {
    const value = valueByName(pending.dimensionId, pending.name);
    const dimension = tags.find((t) => t.id === pending.dimensionId);
    if (value && dimension) dimension.fallbackId = value.id;
    else {
      const entry = rows.find(
        (r) => r.sheet === pending.sheet && r.row === pending.row,
      );
      if (entry) {
        entry.action = "错误";
        entry.error = `兜底值不存在：${pending.name}`;
      }
    }
  }
  return {
    tags,
    rules,
    input: input.map((row) => ({
      ...structuredClone(row),
      id: assignedIds.get(`${row.sheet}-${row.row}`) || row.id,
    })),
    decisions: { ...decisions },
    rows,
    added,
    updated,
    unchanged,
    affected:
      tagUsage(state, changed) +
      changedRules.reduce(
        (total, id) => {
          const rule = rules.find((r) => r.id === id);
          return total + (rule ? ruleImpact(state, rule).length : 0);
        },
        0,
      ),
    baseline: JSON.stringify({ tags: state.tags, rules: state.rules }),
  };
}
export function applyTagImport(s: State, preview: TagImportPreview) {
  const user = s.users.find((u) => u.id === s.userId && u.enabled !== false),
    role = s.roles.find((r) => r.id === user?.roleId);
  if (!user || !canRole(role, "taxonomy")) throw new Error("没有标签管理权限");
  if (preview.rows.some((r) => r.error)) throw new Error("请先修正导入错误");
  if (JSON.stringify({ tags: s.tags, rules: s.rules }) !== preview.baseline)
    throw new Error("标签库已变化，请重新导入预览");
  const checked = previewTagImport(s, preview.input, preview.decisions);
  if (checked.rows.some((r) => r.error)) throw new Error("请先修正导入错误");
  if (checked.rows.some((r) => r.similar?.length && r.decision !== "keep"))
    throw new Error("请处理全部相似标签提示");
  if (
    checked.tags.some((t) =>
      s.tags.some(
        (old) =>
          old.id === t.id &&
          (old.name !== t.name || old.parentId !== t.parentId),
      ),
    )
  )
    captureBindingNames(s);
  s.tags = structuredClone(checked.tags);
  s.rules = structuredClone(checked.rules);
  // 与界面保存一致：规则变化后立即重算当前版本（幂等，只动规则产物）。
  recalcRules(s);
}
