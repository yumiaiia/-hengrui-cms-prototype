import { useState, type FormEvent } from "react";

import { Button, Field } from "../components/ui";
import { go, type User } from "../model";
import { useCMS } from "../store";
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

  function chooseUser(user: User) {
    setEmployeeId(user.employeeId || "");
    setError("");
  }

  function login(user: User | undefined) {
    if (busy) return;
    const id = (user?.employeeId || employeeId || "").trim();
    if (!id || !/^\d{1,64}$/.test(id))
      return setError("企业微信登录凭证已过期或无效，请重新发起登录。");
    const matches = state.users.filter((u) => (u.employeeId || "").trim() === id);
    if (!matches.length)
      return setError("未匹配到关联该工号的系统账号，请联系管理员。");
    const target = matches.find((u) => u.id === user?.id) || matches[0];
    if (target.enabled === false)
      return setError("当前工号对应账号已停用。");
    const assignedRole = state.roles.find((role) => role.id === target.roleId);
    if (!assignedRole)
      return setError("当前账号未配置有效角色，请联系管理员。");
    if (!assignedRole.menus.length)
      return setError("当前账号未配置菜单权限，请联系管理员。");
    setBusy(true);
    const saved = update((draft) => {
      draft.userId = target.id;
    });
    setBusy(false);
    if (saved) {
      toast(`已通过企业微信登录为 ${target.name}。`);
      go(
        assignedRole.menus.includes("workbench")
          ? "workbench"
          : assignedRole.menus[0] || "workbench",
      );
    } else setError("登录会话未保存，请检查浏览器存储空间后重试。");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    login(state.users.find((u) => (u.employeeId || "") === employeeId));
  }

  return (
    <main className="cms-login cms-login-simple">
      <section className="cms-login-entry" aria-labelledby="cms-login-title">
        <div className="cms-login-form-wrap">
          <h1 id="cms-login-title">恒瑞 CMS</h1>
          <p className="cms-login-sso-hint">
            本系统仅支持企业微信单点登录，授权后将按工号自动匹配账号。
          </p>
          <form onSubmit={submit} className="cms-login-form">
            <Field label="企微工号（演示）" error={error || undefined}>
              <select
                aria-label="模拟企微回调工号"
                value={employeeId}
                onChange={(event) => {
                  const user = state.users.find(
                    (u) => u.employeeId === event.target.value,
                  );
                  if (user) chooseUser(user);
                  else setEmployeeId(event.target.value);
                }}
              >
                {state.users.map((u) => (
                  <option key={u.id} value={u.employeeId || ""}>
                    {u.name} · {u.employeeId || "待补充工号"}
                    {u.enabled === false ? "（已停用）" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="primary"
              type="submit"
              disabled={busy}
              className="cms-login-submit"
            >
              {busy ? "正在通过企业微信授权…" : "企业微信登录"}
            </Button>
          </form>
          <div className="cms-login-quick">
            <div>
              {demoRoles.map((item) => {
                const user = state.users.find(
                  (u) =>
                    u.enabled !== false &&
                    u.employeeId === item.employeeId &&
                    u.roleId === item.roleId,
                );
                return (
                  <button
                    key={item.roleId}
                    type="button"
                    disabled={!user || busy}
                    onClick={() => {
                      if (user) chooseUser(user);
                    }}
                  >
                    {item.roleId === "operator" ? "普通用户" : item.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() =>
                setError("企业微信登录凭证已过期或无效，请重新发起登录。")
              }
            >
              模拟凭证过期
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
