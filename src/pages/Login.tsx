import { useState, type FormEvent } from "react";

import { Button, Field } from "../components/ui";
import { go, now, uid, type User } from "../model";
import { useCMS } from "../store";
import "./admin.css";

const demoRoles = [
  {
    roleId: "admin",
    account: "chenlili",
    label: "超级管理员",
  },
  {
    roleId: "operator",
    account: "operator",
    label: "内容运营",
  },
];

export default function Login() {
  const { state, update, toast } = useCMS();
  const [account, setAccount] = useState(
    () =>
      state.users.find((user) => user.id === "u1")?.account ||
      state.users[0]?.account ||
      "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedUser = state.users.find(
    (user) =>
      user.enabled !== false &&
      user.account.toLowerCase() === account.trim().toLowerCase(),
  );

  function roleUser(roleId: string, preferredAccount: string) {
    if (!state.roles.some((role) => role.id === roleId)) return undefined;
    return (
      state.users.find(
        (user) =>
          user.enabled !== false &&
          user.account === preferredAccount &&
          user.roleId === roleId,
      ) ||
      state.users.find(
        (user) => user.enabled !== false && user.roleId === roleId,
      )
    );
  }

  function chooseUser(user: User) {
    setAccount(user.account);
    setError("");
  }

  function login(user: User | undefined, method: "account" | "sso") {
    if (busy) return;
    if (!user || user.enabled === false)
      return setError("请输入已启用账号的邮箱。");
    const assignedRole = state.roles.find((role) => role.id === user.roleId);
    if (!assignedRole)
      return setError("该账号未关联有效角色，请让演示管理员修复角色配置。");
    setBusy(true);
    const saved = update((draft) => {
      draft.userId = user.id;
      draft.audits.unshift({
        id: uid("log"),
        at: now(),
        user: user.name,
        action: method === "sso" ? "演示企微 SSO 登录" : "平台账号演示登录",
        object: user.account,
        detail: `在当前浏览器切换为「${assignedRole.name}」演示身份。未连接认证服务；演示密码不校验、不保存；不修改账号原有权限。`,
        category: "系统",
      });
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
    login(
      state.users.find(
        (user) =>
          user.enabled !== false &&
          user.account.toLowerCase() === account.trim().toLowerCase(),
      ),
      "account",
    );
  }

  const ssoUser = roleUser("operator", "operator");
  return (
    <main className="cms-login cms-login-simple">
      <section className="cms-login-entry" aria-labelledby="cms-login-title">
        <div className="cms-login-form-wrap">
          <h1 id="cms-login-title">恒瑞 CMS</h1>
          <form onSubmit={submit} className="cms-login-form">
            <Field label="账号" required error={error || undefined}>
              <select
                aria-label="登录账号"
                value={selectedUser?.id || ""}
                onChange={(event) => {
                  const user = state.users.find(
                    (u) => u.id === event.target.value,
                  );
                  if (user) chooseUser(user);
                }}
              >
                <option value="" disabled>
                  请选择账号
                </option>
                {state.users
                  .filter((u) => u.enabled !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.account}
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
                const user = roleUser(item.roleId, item.account);
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
