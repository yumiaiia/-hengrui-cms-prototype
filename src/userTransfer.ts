import { saveManagedUser, superRoleId } from "./administration";
import { normalizeEmployeeId } from "./userIdentity";
import { canRole, type State, type User } from "./model";
export interface UserImportRow {
  row: number;
  name: string;
  employeeId: string;
  roleName: string;
  error?: string;
}
export interface UserImportPreview {
  rows: UserImportRow[];
  baseline: string;
}
const headers = ["姓名", "工号", "角色名称"];
const baseline = (s: State) => JSON.stringify([s.users, s.roles]);
export function previewUserImport(
  s: State,
  input: UserImportRow[],
): UserImportPreview {
  const seen = new Set<string>();
  const rows = input.map((row) => {
    const next = {
      ...row,
      name: row.name.trim(),
      employeeId: normalizeEmployeeId(row.employeeId),
      roleName: row.roleName.trim(),
    };
    if (!next.error) {
      const role = s.roles.find(
        (r) => r.name === next.roleName && r.id !== superRoleId,
      );
      const duplicate = seen.has(next.employeeId);
      seen.add(next.employeeId);
      const copy = structuredClone(s);
      try {
        if (duplicate) throw new Error("文件中存在重复工号");
        if (!role) throw new Error("角色不存在或不可分配超级管理员角色");
        saveManagedUser(copy, {
          name: next.name,
          employeeId: next.employeeId,
          roleId: role.id,
        });
      } catch (e) {
        next.error = e instanceof Error ? e.message : "格式错误";
      }
    }
    return next;
  });
  return { rows, baseline: baseline(s) };
}
export function applyUserImport(s: State, preview: UserImportPreview) {
  if (!preview.rows.length) throw new Error("没有可导入的用户");
  if (preview.baseline !== baseline(s))
    throw new Error("账号或角色已变化，请重新预览导入");
  const validated = previewUserImport(s, preview.rows);
  if (validated.rows.some((r) => r.error))
    throw new Error("请先修正全部导入错误，未创建任何账号");
  const draft = structuredClone(s);
  for (const row of validated.rows)
    saveManagedUser(draft, {
      name: row.name,
      employeeId: row.employeeId,
      roleId: draft.roles.find((r) => r.name === row.roleName)!.id,
    });
  s.users = draft.users;
}
export async function readUserWorkbook(
  buffer: ArrayBuffer,
): Promise<UserImportRow[]> {
  const { Workbook } = await import("exceljs"),
    book = new Workbook();
  await book.xlsx.load(buffer);
  const sheet = book.getWorksheet("用户");
  if (!sheet) throw new Error("缺少“用户”工作表，请使用导入模板");
  if (headers.some((h, i) => sheet.getRow(1).getCell(i + 1).text !== h))
    throw new Error("表头不正确，请使用导入模板");
  const rows: UserImportRow[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const cells = headers.map((_, i) => row.getCell(i + 1)),
      values = cells.map((c) => c.text.trim());
    if (values.every((v) => !v)) return;
    rows.push({
      row: index,
      name: values[0],
      employeeId: values[1],
      roleName: values[2],
      error: cells.some((c) => c.type === 6)
        ? "不支持公式，请填写文本"
        : typeof cells[1].value === "number"
          ? "工号必须为文本，请按模板填写以保留前导零"
          : undefined,
    });
  });
  if (!rows.length) throw new Error("文件没有用户数据");
  return rows;
}
export async function writeUserWorkbook(
  s: State,
  users: User[],
  template = false,
  errors?: UserImportRow[],
) {
  const actor = s.users.find((u) => u.id === s.userId),
    role = s.roles.find((r) => r.id === actor?.roleId);
  if (!actor || actor.enabled === false || !canRole(role, "admin"))
    throw new Error("没有用户管理权限");
  const { Workbook } = await import("exceljs"),
    book = new Workbook(),
    sheet = book.addWorksheet(errors ? "错误明细" : "用户");
  sheet.addRow(
    errors
      ? ["原文件行号", ...headers, "错误原因"]
      : template
        ? headers
        : [...headers, "启用状态", "创建时间"],
  );
  if (errors)
    for (const row of errors)
      sheet.addRow([
        row.row,
        row.name,
        row.employeeId,
        row.roleName,
        row.error || "通过",
      ]);
  else if (!template)
    for (const u of users)
      sheet.addRow([
        u.name,
        u.employeeId || "",
        s.roles.find((r) => r.id === u.roleId)?.name || "角色已失效",
        u.enabled === false ? "停用" : "启用",
        new Date(u.createdAt).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        }),
      ]);
  sheet.getColumn(errors ? 3 : 2).numFmt = "@";
  if (template) {
    const roles = book.addWorksheet("可分配角色");
    roles.addRow(["角色名称"]);
    for (const r of s.roles.filter((r) => r.id !== superRoleId))
      roles.addRow([r.name]);
  }
  for (const sh of book.worksheets) {
    sh.columns.forEach((c) => (c.width = 26));
    sh.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sh.getRow(1).eachCell(
      (c) =>
        (c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF245AB5" },
        }),
    );
    sh.views = [{ state: "frozen", ySplit: 1 }];
  }
  const bytes = await book.xlsx.writeBuffer();
  return new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
