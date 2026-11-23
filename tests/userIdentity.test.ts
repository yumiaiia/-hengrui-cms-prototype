import { describe, expect, it } from "vitest";
import { prepareAdministration, saveManagedUser } from "../src/administration";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import {
  findUserByEmployeeId,
  prepareEmployeeIdentity,
} from "../src/userIdentity";

const setup = () => prepareAdministration(prepareWorkspace(seedState()));

describe("工号映射", () => {
  it("创建时保留前导零，修改本人不误判重复，编辑冲突不改变原数据", () => {
    const s = setup();
    saveManagedUser(s, {
      name: "员工",
      employeeId: " 001234 ",
      roleId: "operator",
    });
    const user = s.users.at(-1)!;
    expect(user.employeeId).toBe("001234");
    saveManagedUser(s, {
      id: user.id,
      name: "新姓名",
      employeeId: "001234",
      roleId: "operator",
    });
    expect(findUserByEmployeeId(s.users, "001234")?.id).toBe(user.id);
    const before = structuredClone(s);
    expect(() =>
      saveManagedUser(s, {
        id: user.id,
        name: "冲突",
        employeeId: "000001",
        roleId: "operator",
      }),
    ).toThrow("工号已存在");
    expect(s).toEqual(before);
  });

  it.each(["", "   ", "name@example.com", "AB 123", "a".repeat(65)])(
    "不接受无效工号 %j",
    (employeeId) => {
      const s = setup();
      const count = s.users.length;
      expect(() =>
        saveManagedUser(s, { name: "员工", employeeId, roleId: "operator" }),
      ).toThrow("有效的工号");
      expect(s.users).toHaveLength(count);
    },
  );

  it("登录只按工号映射，忽略大小写，不接受邮箱、未补录工号和停用账号", () => {
    const s = setup();
    const user = s.users[1];
    user.employeeId = "HR00123";
    user.account = "employee@example.com";
    expect(findUserByEmployeeId(s.users, " hr00123 ")?.id).toBe(user.id);
    expect(findUserByEmployeeId(s.users, user.account)).toBeUndefined();
    user.enabled = false;
    expect(findUserByEmployeeId(s.users, "HR00123")).toBeUndefined();
    delete user.employeeId;
    expect(findUserByEmployeeId(s.users, "")).toBeUndefined();
    expect(findUserByEmployeeId(s.users, user.account)).toBeUndefined();
  });

  it("映射存在歧义时不选择第一个用户", () => {
    const s = setup();
    s.users[1].employeeId = s.users[0].employeeId;
    expect(findUserByEmployeeId(s.users, "000001")).toBeUndefined();
  });
});

describe("工号迁移", () => {
  it("独立迁移旧账号，保留邮箱、账号 ID、启停、归属和自建角色，不猜测真实工号", () => {
    const before = setup();
    delete before.employeeIdentityRevision;
    for (const user of before.users) delete user.employeeId;
    before.users[0].account = "admin@hengrui.example.com";
    before.users[1].account = "medical@hengrui.example.com";
    before.users[2].account = "operator@hengrui.example.com";
    before.users.push({
      id: "legacy",
      name: "旧员工",
      account: "real@example.com",
      roleId: "operator",
      enabled: false,
      createdAt: "2026-01-01",
    });
    before.roles[1].name = "保留的角色名";
    before.assets[0].ownerId = "legacy";
    const snapshot = structuredClone(before);
    const migrated = prepareAdministration(before);
    expect(before).toEqual(snapshot);
    expect(migrated.users.slice(0, 3).map((u) => u.employeeId)).toEqual([
      "000001",
      "000002",
      "000003",
    ]);
    expect(migrated.users.at(-1)).toEqual(before.users.at(-1));
    expect(migrated.users.map(({ employeeId: _, ...user }) => user)).toEqual(
      before.users,
    );
    expect(migrated.roles).toEqual(before.roles);
    expect(migrated.assets).toEqual(before.assets);
    expect(prepareAdministration(migrated)).toBe(migrated);
    expect(prepareEmployeeIdentity(migrated)).toBe(migrated);
    saveManagedUser(migrated, {
      id: "legacy",
      name: "旧员工",
      employeeId: "HR0099",
      roleId: "operator",
    });
    expect(migrated.users.at(-1)).toMatchObject({
      id: "legacy",
      account: "real@example.com",
      employeeId: "HR0099",
      enabled: false,
    });
    expect(migrated.assets[0].ownerId).toBe("legacy");
  });

  it("不覆盖已保存的工号，也不产生重复工号", () => {
    const s = setup();
    delete s.employeeIdentityRevision;
    s.users[0].employeeId = "HR001";
    delete s.users[1].employeeId;
    s.users[1].account = "medical@hengrui.example.com";
    s.users[2].employeeId = "000002";
    const migrated = prepareEmployeeIdentity(s);
    expect(migrated.users[0].employeeId).toBe("HR001");
    expect(migrated.users[1].employeeId).toBeUndefined();
    expect(migrated.users[2].employeeId).toBe("000002");
  });
});
