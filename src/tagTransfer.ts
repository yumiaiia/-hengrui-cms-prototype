import { captureBindingNames } from "./tagResults";
import { similarTags, normalizeTagName } from "./tagSimilarity";
import { canRole, uid, type State, type Tag } from "./model";
import { validateTag } from "./taxonomy";
import { tagImpact, tagUsage } from "./tagMatching";
export interface TagImportRow {
  sheet: string;
  row: number;
  id: string;
  name: string;
  parentId?: string;
  parentName?: string;
  enabled: boolean;
  external: boolean;
  error?: string;
}
export interface TagImportPreview {
  tags: Tag[];
  input: TagImportRow[];
  decisions: Record<string, "keep" | "skip">;
  rows: {
    sheet: string;
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
const headers = ["ID", "名称", "启用", "对外展示"];
export async function writeTagWorkbook(tags: Tag[], template = false) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  for (const [name, roots] of [
    ["标签分类", true],
    ["标签", false],
  ] as const) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(roots ? headers : [...headers, "分类ID", "分类名称"]);
    for (const tag of template
      ? []
      : tags.filter(
          (t) => (t.parentId === null) === roots && !t.locked,
        ))
      sheet.addRow([
        tag.id,
        tag.name,
        tag.enabled ? "是" : "否",
        tag.external ? "是" : "否",
        ...(roots
          ? []
          : [
              tag.parentId,
              tags.find((t) => t.id === tag.parentId)?.name || "",
            ]),
      ]);
    sheet.columns.forEach(
      (col, i) => (col.width = i === 0 || i === 4 ? 42 : 24),
    );
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).eachCell(
      (c) =>
        (c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF245AB5" },
        }),
    );
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: roots ? "D1" : "F1" };
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
export async function readTagWorkbook(
  buffer: ArrayBuffer,
): Promise<TagImportRow[]> {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  await book.xlsx.load(buffer);
  const rows: TagImportRow[] = [];
  for (const name of ["标签分类", "标签"]) {
    const sheet = book.getWorksheet(name);
    if (!sheet) throw new Error(`缺少工作表：${name}`);
    const expected =
      name === "标签分类" ? headers : [...headers, "分类ID", "分类名称"];
    if (expected.some((h, i) => sheet.getRow(1).getCell(i + 1).text !== h))
      throw new Error(`${name} 表头不正确，请使用导入模板`);
    sheet.eachRow((row, index) => {
      if (
        index === 1 ||
        row.values.toString().replaceAll(",", "").trim() === ""
      )
        return;
      const values = expected.map((_, i) => row.getCell(i + 1).text.trim());
      const invalid = [values[2], values[3]].some(
        (v) => !["是", "否"].includes(v),
      );
      const formula = expected.some((_, i) => row.getCell(i + 1).type === 6);
      rows.push({
        sheet: name,
        row: index,
        id: values[0],
        name: values[1],
        enabled: values[2] === "是",
        external: values[3] === "是",
        parentId: values[4],
        parentName: values[5],
        error: formula
          ? "请填写文本，不支持公式"
          : invalid
            ? "启用、对外展示须填写是或否"
            : undefined,
      });
    });
  }
  return rows;
}
export function previewTagImport(
  state: State,
  input: TagImportRow[],
  decisions: Record<string, "keep" | "skip"> = {},
): TagImportPreview {
  const tags = structuredClone(state.tags),
    rows: TagImportPreview["rows"] = [],
    seen = new Set<string>(),
    changed: string[] = [];
  const assignedIds = new Map<string, string>();
  let added = 0,
    updated = 0,
    unchanged = 0;
  for (const row of [...input].sort(
    (a, b) => Number(a.sheet === "标签") - Number(b.sheet === "标签"),
  )) {
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
      const root = row.sheet === "标签分类";
      const parent = root
        ? undefined
        : row.parentId
          ? tags.find((t) => t.id === row.parentId && t.parentId === null)
          : tags.find(
              (t) =>
                t.parentId === null &&
                normalizeTagName(t.name) ===
                  normalizeTagName(row.parentName || ""),
            );
      if (!root && !parent) throw new Error("所属标签分类不存在");
      const old = row.id
        ? tags.find((t) => t.id === row.id)
        : tags.find(
            (t) =>
              t.parentId === (parent?.id || null) &&
              normalizeTagName(t.name) === normalizeTagName(row.name),
          );
      if (old && (old.parentId === null) !== root)
        throw new Error("不能改变标签级别");
      if (old?.locked)
        throw new Error("系统预置标签不可通过导入修改或停用");
      const tag: Tag = {
        id: old?.id || row.id || uid("tag"),
        name: row.name.trim(),
        parentId: parent?.id || null,
        enabled: row.enabled,
        external: row.external,
        locked: old?.locked,
        manualOnly: old?.manualOnly,
      };
      if (seen.has(tag.id)) throw new Error("文件中存在重复标签");
      seen.add(tag.id);
      const error = validateTag(tags, tag);
      if (error) throw new Error(error);
      const same =
        old &&
        ["name", "parentId", "enabled", "external"].every(
          (key) => old[key as keyof Tag] === tag[key as keyof Tag],
        );
      const action = !old ? "新增" : same ? "无变化" : "更新";
      const similar =
        !old || old.name !== tag.name || old.parentId !== tag.parentId
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
  return {
    tags,
    input: input.map((row) => ({
      ...structuredClone(row),
      id: assignedIds.get(`${row.sheet}-${row.row}`) || row.id,
    })),
    decisions: { ...decisions },
    rows,
    added,
    updated,
    unchanged,
    affected: tagUsage(state, changed),
    baseline: JSON.stringify(state.tags),
  };
}
export function applyTagImport(s: State, preview: TagImportPreview) {
  const user = s.users.find((u) => u.id === s.userId && u.enabled !== false),
    role = s.roles.find((r) => r.id === user?.roleId);
  if (!user || !canRole(role, "taxonomy")) throw new Error("没有标签管理权限");
  if (preview.rows.some((r) => r.error)) throw new Error("请先修正导入错误");
  if (JSON.stringify(s.tags) !== preview.baseline)
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
}
