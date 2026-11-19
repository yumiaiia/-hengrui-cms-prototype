import { describe, it, expect } from "vitest";
import {
  permissionModules,
  toggleRoleModule,
  toggleRoleAction,
} from "../src/permissions";
import { canRole, permissionNames, type Role } from "../src/model";
import { seedState } from "../src/seed";
import { prepareAdministration, saveManagedRole } from "../src/administration";
import { releaseInput, saveReleaseBatch } from "../src/publication";
import { prepareWorkspace } from "../src/workflow";
const role = (): Role => ({
  id: "custom",
  name: "内容查看",
  menus: ["library"],
  permissions: [],
});
describe("按业务模块组织菜单与操作权限", () => {
  it("每个操作只归属一个模块，所有实际权限都有归属", () => {
    const keys = permissionModules.flatMap((m) => m.actions.map((a) => a.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(permissionNames).sort());
  });
  it("勾选操作自动开启所属菜单，关闭菜单清除其操作且保留其他模块", () => {
    let r = toggleRoleAction(role(), "publish", true);
    r = toggleRoleAction(r, "edit", true);
    expect(r.menus).toContain("publishing");
    r = toggleRoleModule(r, "publishing", false);
    expect(r.permissions).not.toContain("publish");
    expect(r.permissions).toContain("edit");
    expect(r.menus).toContain("library");
  });
  it("只开启菜单可查看，不能据此执行操作；无菜单的旧权限也不生效", () => {
    expect(canRole(role(), "edit")).toBe(false);
    expect(
      canRole({ ...role(), menus: [], permissions: ["edit"] }, "edit"),
    ).toBe(false);
  });
  it("发布权限与编辑内容独立，不允许仅有编辑权限者提交发布", () => {
    const s = prepareAdministration(prepareWorkspace(seedState()));
    const a = s.assets.find((a) => a.id === "demo-page-linkage")!;
    s.roles.push({ ...role(), permissions: ["edit"] });
    s.users.push({
      id: "publisher-test",
      name: "测试",
      account: "p@example.com",
      roleId: "custom",
      createdAt: new Date().toISOString(),
    });
    s.userId = "publisher-test";
    expect(() =>
      saveReleaseBatch(
        s,
        [releaseInput(a)],
        new Date(Date.now() + 86400000).toISOString(),
        true,
      ),
    ).toThrow("不能提交发布");
    const r = s.roles.at(-1)!;
    Object.assign(r, toggleRoleAction(r, "publish", true));
    r.permissions = r.permissions.filter((p) => p !== "edit");
    expect(
      saveReleaseBatch(
        s,
        [releaseInput(a)],
        new Date(Date.now() + 86400000).toISOString(),
        true,
      ),
    ).toHaveLength(1);
  });
  it("保存拒绝菜单与操作脱节，系统管理菜单与管理权限自动联动", () => {
    const s = prepareAdministration(prepareWorkspace(seedState()));
    expect(() =>
      saveManagedRole(s, { ...role(), permissions: ["publish"] }, true),
    ).toThrow("同时开启");
    let r = toggleRoleModule(role(), "admin", true);
    expect(r.permissions).toContain("admin");
    r = toggleRoleAction(r, "admin", false);
    expect(r.menus).not.toContain("admin");
  });
});
