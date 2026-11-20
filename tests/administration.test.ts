import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import {
  prepareAdministration,
  saveManagedUser,
  saveManagedRole,
  deleteManagedRole,
  setUserEnabled,
} from "../src/administration";
import { contentAttention } from "../src/workbench";
import { current, type Role } from "../src/model";
const setup = () => prepareAdministration(prepareWorkspace(seedState()));
const role = (): Role => ({
  id: "custom-role",
  name: "学术编辑",
  menus: ["workbench", "library"],
  permissions: ["edit"],
});
describe("账号与角色管理", () => {
  it("已保存的旧角色取消数据范围与重跑权限，保留自建账号和其他功能权限", () => {
    const before = setup();
    before.administrationRevision = 1;
    const ordinary = before.roles.find((r) => r.id === "operator")!;
    Object.assign(ordinary, {
      dataRange: "own",
      permissions: [...ordinary.permissions, "rerun"],
    });
    const s = prepareAdministration(before);
    expect(s.users).toEqual(before.users);
    expect(s.assets).toEqual(before.assets);
    expect(s.roles.every((r) => !("dataRange" in r))).toBe(true);
    expect(s.roles.find((r) => r.id === ordinary.id)?.permissions).toEqual(
      ordinary.permissions.filter((p) => String(p) !== "rerun"),
    );
    expect(s.administrationRevision).toBe(3);
  });
  it("只保留超管为内置保护对象，迁移邮箱保留用户及内容关联", () => {
    const before = prepareWorkspace(seedState()),
      s = prepareAdministration(before);
    expect(s.users.map((u) => u.id)).toEqual(before.users.map((u) => u.id));
    expect(s.assets.map((a) => a.ownerId)).toEqual(
      before.assets.map((a) => a.ownerId),
    );
    expect(s.users.every((u) => u.account.includes("@"))).toBe(true);
    expect(s.roles.find((r) => r.id === "admin")?.name).toBe("超级管理员");
    expect(prepareAdministration(s)).toBe(s);
  });
  it("支持创建角色并通过邮箱创建账号，邮箱忽略大小写和两端空格", () => {
    const s = setup();
    saveManagedRole(s, role(), true);
    saveManagedUser(s, {
      name: "测试用户",
      account: " Editor@Example.com ",
      roleId: "custom-role",
    });
    expect(s.users.at(-1)?.account).toBe("editor@example.com");
    expect(() =>
      saveManagedUser(s, {
        name: "另一用户",
        account: "EDITOR@example.com",
        roleId: "custom-role",
      }),
    ).toThrow("邮箱已存在");
  });
  it("拒绝非邮箱账号和分配超级管理员角色", () => {
    const s = setup();
    expect(() =>
      saveManagedUser(s, {
        name: "用户",
        account: "username",
        roleId: "operator",
      }),
    ).toThrow("邮箱地址");
    expect(() =>
      saveManagedUser(s, {
        name: "用户",
        account: "user@example.com",
        roleId: "admin",
      }),
    ).toThrow("不可分配");
  });
  it("超管账号与角色不能编辑、停用或删除", () => {
    const s = setup();
    expect(() => saveManagedUser(s, { ...s.users[0], name: "其他" })).toThrow(
      "系统保留",
    );
    expect(() => setUserEnabled(s, "u1", false)).toThrow("不能停用");
    expect(() => saveManagedRole(s, { ...s.roles[0], name: "其他" })).toThrow(
      "系统保留",
    );
    expect(() => deleteManagedRole(s, "admin")).toThrow("不能删除");
  });
  it("普通角色可以维护，分配给停用账号时仍禁止删除", () => {
    const s = setup();
    saveManagedRole(s, role(), true);
    saveManagedRole(s, { ...role(), name: "医学编辑" });
    saveManagedUser(s, {
      name: "用户",
      account: "a@example.com",
      roleId: "custom-role",
    });
    const u = s.users.at(-1)!;
    setUserEnabled(s, u.id, false);
    expect(() => deleteManagedRole(s, "custom-role")).toThrow("关联账号");
    expect(() =>
      saveManagedUser(s, {
        name: "重复",
        account: "a@example.com",
        roleId: "operator",
      }),
    ).toThrow("邮箱已存在");
    saveManagedUser(s, { ...u, roleId: "operator" });
    deleteManagedRole(s, "custom-role");
    expect(s.roles.some((r) => r.id === "custom-role")).toBe(false);
  });
  it("普通预设角色不锁定，普通用户角色可更名", () => {
    const s = setup();
    const medical = s.roles.find((r) => r.id === "operator")!;
    saveManagedRole(s, { ...medical, name: "自定义医学角色" });
    expect(medical.name).toBe("自定义医学角色");
  });
  it("拒绝重复角色名、空菜单以及不完整的管理权限", () => {
    const s = setup();
    expect(() =>
      saveManagedRole(s, { ...role(), name: "超级管理员" }, true),
    ).toThrow("名称已存在");
    expect(() => saveManagedRole(s, { ...role(), menus: [] }, true)).toThrow(
      "至少选择",
    );
    expect(() =>
      saveManagedRole(s, { ...role(), menus: ["admin"] }, true),
    ).toThrow("同时配置");
  });
  it("无管理权限者不能创建角色或账号", () => {
    const s = setup();
    s.userId = "u3";
    expect(() => saveManagedRole(s, role(), true)).toThrow("没有管理权限");
    expect(() =>
      saveManagedUser(s, {
        name: "用户",
        account: "b@example.com",
        roleId: "operator",
      }),
    ).toThrow("没有管理权限");
  });
});
describe("工作台待办", () => {
  it("同一份内容合并多个问题，覆盖材料打标失败、过期和审批待补充", () => {
    const s = setup(),
      a = s.assets.find((a) => a.id === "a1")!;
    const v = current(a);
    v.process = "完成";
    v.tagStatus = "失败";
    v.approval = { mode: "pending" };
    v.expiry = "2000-01-01";
    const list = contentAttention([a]);
    expect(list).toHaveLength(1);
    expect(list[0].issues.map((i) => i.category)).toEqual(
      expect.arrayContaining(["approval", "processing", "expiry"]),
    );
  });
  it("作废内容不进入待办，页级失败定位到具体页面", () => {
    const s = setup(),
      a = s.assets.find((a) => a.id === "a1")!;
    const v = current(a);
    v.process = "完成";
    v.pageStates = { 2: { status: "失败" } };
    expect(contentAttention([a])[0].issues[0].route).toContain("page=2");
    a.lifecycle = "已作废";
    expect(contentAttention([a])).toEqual([]);
  });
});
