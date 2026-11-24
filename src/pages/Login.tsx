import { useState, type FormEvent } from "react";

import { Button, Field } from "../components/ui";
import { go, type User } from "../model";
import { useCMS } from "../store";
import { findUserByEmployeeId } from "../userIdentity";
import "./admin.css";

const demoRoles = [
  {
    roleId: "admin",
    employeeId: "000001",
    label: "超级管理员",
  },
  {
    roleId: "operator",
    employeeId: "000003",
    label: "内容运营",
  },
];

export default function Login() {
  const { state, update, toast } = useCMS();
  const [employeeId, setEmployeeId] = useState(
    () =>
      state.users.find((user) => user.id === "u1")?.employeeId ||
      state.users[0]?.employeeId ||
      "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedUser = findUserByEmployeeId(state.users, employeeId);

  function roleUser(roleId: string, preferredEmployeeId: string) {
    if (!state.roles.some((role) => role.id === roleId)) return undefined;
    return (
      state.users.find(
        (user) =>
          user.enabled !== false &&
          user.employeeId === preferredEmployeeId &&
          user.roleId === roleId,
      ) ||
      state.users.find(
        (user) =>
          user.enabled !== false && !!user.employeeId && user.roleId === roleId,
      )
    );
  }

  function chooseUser(user: User) {
    setEmployeeId(user.employeeId || "");
    setError("");
  }

  function login(user: User | undefined, method: "account" | "sso") {
    if (busy) return;
    if (
      !user ||
      !user.employeeId ||
      findUserByEmployeeId(state.users, user.employeeId)?.id !== user.id
    )
      return setError("请选择已启用且已填写工号的账号。");
    const assignedRole = state.roles.find((role) => role.id === user.roleId);
    if (!assignedRole)
      return setError("该账号未关联有效角色，请让演示管理员修复角色配置。");
    setBusy(true);
    const saved = update((draft) => {
      draft.userId = user.id;
    });
    setBusy(false);
    if (saved) {
      toast(`已切换为 ${user.name} 的本地演示身份。`);
      go(
        assignedRole.menus.includes("workbench")
          ? "workbench"
          : assignedRole.menus[0] || "workbench",
      );
    } else setError("演示身份未保存。请检查浏览器存储空间后重试。");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    login(findUserByEmployeeId(state.users, employeeId), "account");
  }

  const ssoUser = roleUser("operator", "000003");
  return (
    <main className="cms-login cms-login-simple">
      <section className="cms-login-entry" aria-labelledby="cms-login-title">
        <div className="cms-login-form-wrap">
          <h1 id="cms-login-title">恒瑞 CMS</h1>
          <form onSubmit={submit} className="cms-login-form">
            <Field label="工号" required error={error || undefined}>
              <select
                aria-label="登录工号"
                value={selectedUser?.id || ""}
                onChange={(event) => {
                  const user = state.users.find(
                    (u) => u.id === event.target.value,
                  );
                  if (user) chooseUser(user);
                }}
              >
                <option value="" disabled>
                  请选择工号
                </option>
                {state.users
                  .filter((u) => u.enabled !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id} disabled={!u.employeeId}>
                      {u.name} · {u.employeeId || "待补充工号"}
                    </option>
                  ))}
              </select>
            </Field>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !selectedUser}
              className="cms-login-submit"
            >
              {busy ? "登录中…" : "登录"}
            </Button>
          </form>
          <div className="cms-login-quick">
            <div>
              {demoRoles.map((item) => {
                const user = roleUser(item.roleId, item.employeeId);
                return (
                  <button
                    key={item.roleId}
                    disabled={!user || busy}
                    aria-pressed={!!user && selectedUser?.id === user.id}
                    onClick={() => {
                      if (user) chooseUser(user);
                    }}
                  >
                    {item.roleId === "operator" ? "普通用户" : item.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            className="cms-login-sso"
            disabled={busy || !ssoUser}
            onClick={() => {
              if (ssoUser) login(ssoUser, "sso");
            }}
          >
            企微登录（演示）
          </Button>
        </div>
      </section>
    </main>
  );
}
