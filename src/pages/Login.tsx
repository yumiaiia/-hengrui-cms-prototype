import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  FileCheck2,
  FolderClosed,
  MessageCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button, Field } from "../components/ui";
import { go, now, uid, type User } from "../model";
import { useCMS } from "../store";
import "./admin.css";

const demoRoles = [
  {
    roleId: "admin",
    account: "chenlili",
    label: "超级管理员",
    hint: "用户与角色管理",
  },
  {
    roleId: "medical",
    account: "medical",
    label: "医学部",
    hint: "审批与内容管理",
  },
  {
    roleId: "operator",
    account: "operator",
    label: "内容运营",
    hint: "按角色范围使用",
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
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedUser = state.users.find(
    (user) =>
      user.enabled !== false &&
      user.account.toLowerCase() === account.trim().toLowerCase(),
  );
  const selectedRole = state.roles.find(
    (role) => role.id === selectedUser?.roleId,
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
    setPassword("");
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
      setPassword("");
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

  const medicalUser = roleUser("medical", "medical");

  return (
    <main className="cms-login">
      <section className="cms-login-story" aria-label="医学内容管理平台介绍">
        <div className="cms-login-brand">
          <span className="cms-login-brand-icon">
            <FileCheck2 size={27} strokeWidth={1.6} />
          </span>
          <div>
            <strong>恒瑞医药</strong>
            <span>医学内容管理平台</span>
          </div>
        </div>
        <div className="cms-login-story-body">
          <span className="cms-login-eyebrow">
            MEDICAL CONTENT · LOCAL DEMO
          </span>
          <h1>
            让每份内容，
            <br />
            都有清晰的来处。
          </h1>
          <p className="cms-login-intro">
            内容版本、审批凭证与标签归档，
            <br />
            在同一个工作空间里核对和管理。
          </p>
          <div className="cms-filing-motif" aria-hidden="true">
            <div className="cms-file-tab">医学内容档案 / 演示样例</div>
            <div className="cms-file-back">
              <span>审批凭证</span>
            </div>
            <div className="cms-file-middle">
              <span>版本记录</span>
            </div>
            <div className="cms-file-front">
              <div className="cms-file-header">
                <FolderClosed size={23} strokeWidth={1.5} />
                <span>学术资料 · 归档记录</span>
                <span className="cms-file-stamp">DEMO</span>
              </div>
              <div className="cms-file-lines">
                <span>内容版本</span>
                <strong>V2 · 当前归档</strong>
                <span>审批信息</span>
                <strong>凭证快照 · 待核对</strong>
                <span>来源记录</span>
                <strong>原始文件与公开链接</strong>
              </div>
              <div className="cms-file-footer">
                内容与审批分别登记，原始差异保留。
              </div>
            </div>
          </div>
        </div>
        <div className="cms-login-story-footer">
          <ShieldCheck size={17} />
          <span>虚构资料与本地交互演示，不用于真实业务认证。</span>
        </div>
      </section>

      <section className="cms-login-entry" aria-labelledby="cms-login-title">
        <div className="cms-login-form-wrap">
          <span className="cms-login-demo-label">
            <span />
            本地原型演示
          </span>
          <h2 id="cms-login-title">进入内容工作空间</h2>
          <p className="cms-login-subtitle">
            选择已存在的演示账号，体验该账号当前角色的使用范围。
          </p>
          <form onSubmit={submit} className="cms-login-form">
            <Field
              label="选择平台账号"
              hint="也可以在下方手动填写已存在的账号。"
            >
              <select
                value={selectedUser?.id || ""}
                onChange={(event) => {
                  const user = state.users.find(
                    (user) => user.id === event.target.value,
                  );
                  if (user) chooseUser(user);
                }}
              >
                <option value="" disabled>
                  手动填写账号 / 未匹配账号
                </option>
                {state.users
                  .filter((user) => user.enabled !== false)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.account}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="登录邮箱" required error={error || undefined}>
              <input
                required
                type="email"
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                value={account}
                placeholder="输入已创建账号的邮箱"
                onChange={(event) => {
                  setAccount(event.target.value);
                  setError("");
                }}
                aria-describedby="cms-login-disclaimer"
              />
            </Field>
            <Field
              label="演示密码（选填）"
              hint="仅展示密码输入交互，不校验、不保存，也不会发送。"
            >
              <input
                type="password"
                autoComplete="off"
                value={password}
                placeholder="无需填写真实密码"
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className="cms-login-account-preview" aria-live="polite">
              <Users size={18} />
              <div>
                <strong>
                  {selectedUser
                    ? `${selectedUser.name} · ${selectedRole?.name || "角色未配置"}`
                    : "尚未匹配已有账号"}
                </strong>
                <span>
                  {selectedRole
                    ? "沿用当前角色的菜单与操作权限"
                    : "请从已有账号列表选择，不会自动创建账号或授予权限。"}
                </span>
              </div>
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !state.users.length}
              className="cms-login-submit"
              icon={<ArrowRight size={18} />}
            >
              {busy ? "保存演示身份…" : "平台账号演示登录"}
            </Button>
          </form>
          <div className="cms-login-divider">
            <span>或使用演示企业身份</span>
          </div>
          <Button
            className="cms-login-sso"
            icon={<MessageCircle size={19} />}
            disabled={busy || !medicalUser}
            onClick={() => {
              if (medicalUser) {
                chooseUser(medicalUser);
                login(medicalUser, "sso");
              }
            }}
          >
            演示企微 SSO
          </Button>
          <p className="cms-login-sso-hint">
            {medicalUser
              ? `直接切换到 ${medicalUser.name}（${medicalUser.account}）；不连接企业微信，不执行真实单点认证。`
              : "当前没有医学部演示账号，无法进行企微身份演示。"}
          </p>
          <fieldset className="cms-login-quick">
            <legend>快捷选择演示身份 · 选择后点击登录</legend>
            <div>
              {demoRoles.map((item) => {
                const user = roleUser(item.roleId, item.account);
                return (
                  <button
                    key={item.roleId}
                    type="button"
                    disabled={!user || busy}
                    aria-pressed={!!user && selectedUser?.id === user.id}
                    onClick={() => {
                      if (user) chooseUser(user);
                    }}
                  >
                    <strong>{item.label}</strong>
                    <span>{user ? item.hint : "账号未配置"}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p id="cms-login-disclaimer" className="cms-login-disclaimer">
            账号、权限与操作记录仅保存在当前浏览器。此页面是身份切换演示，不验证账号所有权，不代表生产环境的登录或权限安全。
          </p>
          {error ? (
            <p className="cms-form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
