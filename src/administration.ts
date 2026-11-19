import { moduleForPermission } from "./permissions";
import {
  now,
  uid,
  permissionNames,
  type Role,
  type State,
  type User,
} from "./model";
export const superRoleId = "admin";
export const superUserId = "u1";
export const menuOptions = [
  { key: "workbench", label: "工作台" },
  { key: "library", label: "内容库" },
  { key: "publishing", label: "发布管理" },
  { key: "collection", label: "公众号采集" },
  { key: "tags", label: "标签管理" },
  { key: "admin", label: "系统管理" },
];
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const hasAdminAccess = (role?: Role) =>
  !!role?.permissions.includes("admin") && role.menus.includes("admin");
function assertAdmin(s: State) {
  const actor = s.users.find((u) => u.id === s.userId);
  if (
    !actor ||
    actor.enabled === false ||
    !hasAdminAccess(s.roles.find((r) => r.id === actor.roleId))
  )
    throw new Error("当前账号没有管理权限。");
}
export function saveManagedUser(
  s: State,
  input: { id?: string; name: string; account: string; roleId: string },
) {
  assertAdmin(s);
  const old = s.users.find((u) => u.id === input.id);
  if (input.id === superUserId)
    throw new Error("超级管理员账号为系统保留，不能修改。");
  if (input.id && !old) throw new Error("用户已不存在。");
  const name = input.name.trim(),
    account = normalizeEmail(input.account);
  if (!name) throw new Error("请输入姓名。");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account))
    throw new Error("请输入有效的邮箱地址。");
  if (
    s.users.some(
      (u) => u.id !== input.id && normalizeEmail(u.account) === account,
    )
  )
    throw new Error("该邮箱已存在，请使用其他邮箱；停用账号的邮箱也不能重复。");
  const role = s.roles.find((r) => r.id === input.roleId);
  if (!role || role.id === superRoleId)
    throw new Error("请选择自建角色；超级管理员角色不可分配。");
  if (old?.id === s.userId && !hasAdminAccess(role))
    throw new Error("不能撤销当前账号的管理入口，请由其他管理员调整。");
  if (old) Object.assign(old, { name, account, roleId: role.id });
  else
    s.users.push({
      id: uid("user"),
      name,
      account,
      roleId: role.id,
      createdAt: now(),
      enabled: true,
    });
}
export function setUserEnabled(s: State, id: string, enabled: boolean) {
  assertAdmin(s);
  if (id === superUserId) throw new Error("超级管理员账号不能停用。");
  if (id === s.userId && !enabled) throw new Error("不能停用当前登录账号。");
  const user = s.users.find((u) => u.id === id);
  if (!user) throw new Error("用户已不存在。");
  user.enabled = enabled;
}
export function saveManagedRole(s: State, input: Role, creating = false) {
  assertAdmin(s);
  if (input.id === superRoleId)
    throw new Error("超级管理员角色为系统保留，不能修改。");
  const old = s.roles.find((r) => r.id === input.id);
  if (!creating && !old) throw new Error("角色已不存在。");
  if (creating && old) throw new Error("角色已存在，请重新创建。");
  const name = input.name.trim();
  if (!name) throw new Error("请输入角色名称。");
  if (
    s.roles.some(
      (r) =>
        r.id !== input.id && r.name.trim().toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error("角色名称已存在。");
  if (!input.menus.length) throw new Error("请至少选择一个菜单入口。");
  if (
    input.menus.some((m) => !menuOptions.some((option) => option.key === m)) ||
    input.permissions.some((p) => !(p in permissionNames))
  )
    throw new Error("包含无效的菜单或权限。");
  if (input.menus.includes("admin") !== input.permissions.includes("admin"))
    throw new Error("系统管理菜单和用户与角色管理权限需同时配置。");
  const orphan = input.permissions.find(
    (p) => !input.menus.includes(moduleForPermission(p)?.key || ""),
  );
  if (orphan)
    throw new Error(
      `请同时开启“${moduleForPermission(orphan)?.label}”菜单，或取消其操作权限。`,
    );
  const actor = s.users.find((u) => u.id === s.userId);
  if (actor?.roleId === input.id && !hasAdminAccess(input))
    throw new Error("不能撤销当前账号的管理入口。");
  const value = { ...structuredClone(input), name };
  if (old) Object.assign(old, value);
  else s.roles.push(value);
}
export function deleteManagedRole(s: State, id: string) {
  assertAdmin(s);
  if (id === superRoleId) throw new Error("超级管理员角色不能删除。");
  if (s.users.some((u) => u.roleId === id))
    throw new Error(
      "该角色仍有关联账号，请先为这些账号更换角色，停用账号也需调整。",
    );
  s.roles = s.roles.filter((r) => r.id !== id);
}
export function prepareAdministration(s: State) {
  if (s.administrationRevision === 3) return s;
  const next = structuredClone(s);
  for (const role of next.roles) {
    role.menus = role.menus.filter((m) =>
      menuOptions.some((option) => option.key === m),
    );
    role.permissions = role.permissions.filter((p) => p in permissionNames);
    if (
      (s.administrationRevision || 0) < 3 &&
      role.permissions.includes("edit")
    ) {
      if (
        role.menus.includes("publishing") &&
        !role.permissions.includes("publish")
      )
        role.permissions.push("publish");
      if (
        role.menus.includes("collection") &&
        !role.permissions.includes("collect")
      )
        role.permissions.push("collect");
    }
    role.permissions = role.permissions.filter((p) =>
      role.menus.includes(moduleForPermission(p)?.key || ""),
    );
    delete (role as Role & { dataRange?: unknown }).dataRange;
  }
  next.tasks = next.tasks.filter((task) => String(task.type) !== "标签重跑");
  next.notices = next.notices.filter(
    (notice) => !notice.title.includes("标签重跑"),
  );
  for (const article of next.articles)
    article.collectedAt ||=
      article.collectedVersion?.createdAt || article.checkedAt;
  const superRole = next.roles.find((r) => r.id === superRoleId);
  if (superRole) {
    superRole.name = "超级管理员";
    superRole.permissions = Object.keys(permissionNames) as Role["permissions"];
    superRole.menus = menuOptions.map((m) => m.key);
  }
  const used = new Set(
    next.users
      .filter((u) => u.account.includes("@"))
      .map((u) => normalizeEmail(u.account)),
  );
  for (const u of next.users) {
    if (!u.account.includes("@")) {
      const base =
        u.id === superUserId
          ? "admin"
          : u.account.replace(/[^a-z\d._-]/gi, "") || u.id;
      let email = `${base}@hengrui.example.com`;
      let i = 1;
      while (used.has(email)) email = `${base}-${i++}@hengrui.example.com`;
      u.account = email;
      used.add(email);
    } else u.account = normalizeEmail(u.account);
    u.enabled ??= true;
  }
  const admin = next.users.find((u) => u.id === superUserId);
  if (admin) {
    admin.roleId = superRoleId;
    admin.enabled = true;
  }
  next.administrationRevision = 3;
  return next;
}
