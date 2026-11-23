import {
  permissionModules,
  toggleRoleModule,
  toggleRoleAction,
} from "../permissions";
import { useState, type FormEvent } from "react";
import {
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
  Trash2,
  LockKeyhole,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Note,
  PageHeader,
  SearchBox,
  Tabs,
} from "../components/ui";
import {
  dateLabel,
  go,
  permissionNames,
  uid,
  type Role,
  type User,
} from "../model";
import { useCMS } from "../store";
import {
  deleteManagedRole,
  menuOptions as menus,
  saveManagedRole,
  saveManagedUser,
  setUserEnabled,
  superRoleId,
  superUserId,
} from "../administration";
import "./admin.css";
interface UserDraft {
  id?: string;
  name: string;
  employeeId: string;
  roleId: string;
}
export default function Administration() {
  const { state, user, role, can, update, toast } = useCMS();
  const [tab, setTab] = useState("users"),
    [userSearch, setUserSearch] = useState(""),
    [roleSearch, setRoleSearch] = useState("");
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null),
    [userError, setUserError] = useState("");
  const [roleDraft, setRoleDraft] = useState<Role | null>(null),
    [roleError, setRoleError] = useState(""),
    [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{
    type: "role" | "user";
    id: string;
    name: string;
    enabled?: boolean;
  }>();
  const [confirmError, setConfirmError] = useState("");
  if (!user || !can("admin") || !role?.menus.includes("admin"))
    return (
      <Empty
        title="当前账号没有管理权限"
        description="请联系管理员调整角色。"
        action={<Button onClick={() => go("workbench")}>返回工作台</Button>}
      />
    );
  const filteredUsers = state.users.filter((u) =>
    `${u.name} ${u.employeeId || ""} ${state.roles.find((r) => r.id === u.roleId)?.name}`
      .toLowerCase()
      .includes(userSearch.trim().toLowerCase()),
  );
  const filteredRoles = state.roles.filter((r) =>
    r.name.toLowerCase().includes(roleSearch.trim().toLowerCase()),
  );
  const lockedRole = roleDraft?.id === superRoleId;
  function editUser(item?: User) {
    setUserError("");
    setUserDraft(
      item
        ? {
            id: item.id,
            name: item.name,
            employeeId: item.employeeId || "",
            roleId: item.roleId,
          }
        : { name: "", employeeId: "", roleId: "" },
    );
  }
  function editRole(item?: Role) {
    setRoleError("");
    setCreating(!item);
    setRoleDraft(
      item
        ? structuredClone(item)
        : {
            id: uid("role"),
            name: "",
            permissions: [],
            menus: ["workbench", "library"],
          },
    );
  }
  function saveUser(e: FormEvent) {
    e.preventDefault();
    if (!userDraft) return;
    try {
      const ok = update(
        (s) => saveManagedUser(s, userDraft),
        undefined,
        "admin",
      );
      if (ok) {
        setUserDraft(null);
        toast(
          userDraft.id ? "用户信息已保存。" : "账号已创建，可使用该工号登录。",
        );
      }
    } catch (e) {
      setUserError(e instanceof Error ? e.message : "保存失败");
    }
  }
  function saveRole(e: FormEvent) {
    e.preventDefault();
    if (!roleDraft) return;
    try {
      const ok = update(
        (s) => saveManagedRole(s, roleDraft, creating),
        undefined,
        "admin",
      );
      if (ok) {
        setRoleDraft(null);
        toast(
          creating
            ? "角色已创建，可在创建账号时分配。"
            : "角色已保存，关联账号同步生效。",
        );
      }
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : "保存失败");
    }
  }
  function perform() {
    if (!confirm) return;
    try {
      const ok = update(
        (s) => {
          if (confirm.type === "role") deleteManagedRole(s, confirm.id);
          else setUserEnabled(s, confirm.id, !!confirm.enabled);
        },
        undefined,
        "admin",
      );
      if (ok) {
        toast(
          confirm.type === "role"
            ? "角色已删除。"
            : confirm.enabled
              ? "账号已启用。"
              : "账号已停用，内容和历史记录保留。",
        );
        setConfirm(undefined);
      }
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "操作失败");
    }
  }
  return (
    <div className="cms-admin-page">
      <PageHeader title="系统管理" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "users", label: "用户管理", count: state.users.length },
          { key: "roles", label: "角色管理", count: state.roles.length },
        ]}
      />
      {tab === "users" ? (
        <section className="panel">
          <div className="toolbar">
            <SearchBox
              value={userSearch}
              onChange={setUserSearch}
              placeholder="搜索姓名、工号或角色"
            />
            <Button
              variant="primary"
              icon={<UserPlus size={16} />}
              onClick={() => editUser()}
            >
              创建账号
            </Button>
          </div>

          {filteredUsers.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>姓名 / 工号</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((item) => {
                    const assigned = state.roles.find(
                      (r) => r.id === item.roleId,
                    );
                    const locked = item.id === superUserId;
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          {item.id === user.id ? (
                            <Badge tone="blue">当前账号</Badge>
                          ) : null}
                          <small className="row-secondary">
                            {item.employeeId || "待补充工号"}
                          </small>
                        </td>
                        <td>
                          {assigned?.name || "角色不存在"}
                          {locked ? (
                            <small className="row-secondary">系统保留</small>
                          ) : null}
                        </td>

                        <td>
                          <Badge
                            tone={item.enabled === false ? "gray" : "green"}
                          >
                            {item.enabled === false ? "已停用" : "已启用"}
                          </Badge>
                        </td>
                        <td>{dateLabel(item.createdAt)}</td>
                        <td>
                          {locked ? (
                            <span className="admin-locked">
                              <LockKeyhole size={14} />
                              系统保留
                            </span>
                          ) : (
                            <div className="actions">
                              <Button
                                variant="ghost"
                                icon={<Pencil size={14} />}
                                onClick={() => editUser(item)}
                              >
                                编辑
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={item.id === user.id}
                                onClick={() => {
                                  setConfirmError("");
                                  setConfirm({
                                    type: "user",
                                    id: item.id,
                                    name: item.name,
                                    enabled: item.enabled === false,
                                  });
                                }}
                              >
                                {item.enabled === false ? "启用" : "停用"}
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="没有匹配的账号"
              description="调整姓名、工号或角色关键词。"
            />
          )}
        </section>
      ) : null}
      {tab === "roles" ? (
        <section className="panel">
          <div className="toolbar">
            <SearchBox
              value={roleSearch}
              onChange={setRoleSearch}
              placeholder="搜索角色名称"
            />
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => editRole()}
            >
              创建角色
            </Button>
          </div>
          <div className="admin-inline-help">
            <ShieldCheck size={15} />
            仅超级管理员是内置角色，其余角色可创建、编辑；没有关联账号时可删除。
          </div>
          <div className="cms-role-grid">
            {filteredRoles.map((item) => {
              const count = state.users.filter(
                (u) => u.roleId === item.id,
              ).length;
              return (
                <article className="cms-role-card" key={item.id}>
                  <div className="section-heading">
                    <h3>{item.name}</h3>
                    <Badge tone={item.id === superRoleId ? "blue" : "gray"}>
                      {item.id === superRoleId ? "系统保留" : `${count} 位用户`}
                    </Badge>
                  </div>
                  <dl className="cms-definition">
                    <div>
                      <dt>菜单入口</dt>
                      <dd>
                        {menus
                          .filter((m) => item.menus.includes(m.key))
                          .map((m) => m.label)
                          .join("、") || "未开放菜单"}
                      </dd>
                    </div>
                    <div>
                      <dt>操作权限</dt>
                      <dd>
                        {item.permissions
                          .map((p) => permissionNames[p])
                          .join("、") || "仅查看，无操作权限"}
                      </dd>
                    </div>
                  </dl>
                  <div className="actions">
                    <Button
                      icon={
                        item.id === superRoleId ? (
                          <LockKeyhole size={14} />
                        ) : (
                          <Pencil size={14} />
                        )
                      }
                      onClick={() => editRole(item)}
                    >
                      {item.id === superRoleId ? "查看权限" : "编辑角色"}
                    </Button>
                    {item.id !== superRoleId ? (
                      <Button
                        variant="ghost"
                        icon={<Trash2 size={14} />}
                        onClick={() => {
                          setConfirmError("");
                          setConfirm({
                            type: "role",
                            id: item.id,
                            name: item.name,
                          });
                        }}
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          {!filteredRoles.length ? (
            <Empty
              title="没有匹配的角色"
              description="调整关键词，或创建新角色。"
            />
          ) : null}
        </section>
      ) : null}
      {userDraft ? (
        <Dialog
          title={userDraft.id ? "编辑账号" : "创建账号"}
          onClose={() => setUserDraft(null)}
          footer={
            <>
              <Button onClick={() => setUserDraft(null)}>取消</Button>
              <Button variant="primary" type="submit" form="cms-user-form">
                {userDraft.id ? "保存账号" : "创建账号"}
              </Button>
            </>
          }
        >
          <form
            id="cms-user-form"
            onSubmit={saveUser}
            className="cms-form-stack"
          >
            <Field label="姓名" required>
              <input
                aria-label="用户姓名"
                autoFocus
                required
                maxLength={60}
                value={userDraft.name}
                onChange={(e) => {
                  setUserError("");
                  setUserDraft({ ...userDraft, name: e.target.value });
                }}
              />
            </Field>
            <Field label="工号" required>
              <input
                aria-label="账号工号"
                type="text"
                required
                maxLength={64}
                autoComplete="off"
                placeholder="请输入工号"
                value={userDraft.employeeId}
                onChange={(e) => {
                  setUserError("");
                  setUserDraft({ ...userDraft, employeeId: e.target.value });
                }}
              />
            </Field>
            <Field label="角色" required>
              <select
                aria-label="账号角色"
                required
                value={userDraft.roleId}
                onChange={(e) => {
                  setUserError("");
                  setUserDraft({ ...userDraft, roleId: e.target.value });
                }}
              >
                <option value="" disabled>
                  请选择角色
                </option>
                {state.roles
                  .filter((r) => r.id !== superRoleId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </Field>
            {state.roles.length === 1 ? (
              <Note tone="amber">请先在角色管理中创建角色，再创建账号。</Note>
            ) : null}
            {userError ? (
              <p className="cms-form-error" role="alert">
                {userError}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
      {roleDraft ? (
        <Dialog
          wide
          title={
            lockedRole ? "超级管理员权限" : creating ? "创建角色" : "编辑角色"
          }
          onClose={() => setRoleDraft(null)}
          footer={
            <>
              <Button onClick={() => setRoleDraft(null)}>
                {lockedRole ? "关闭" : "取消"}
              </Button>
              {!lockedRole ? (
                <Button variant="primary" type="submit" form="cms-role-form">
                  {creating ? "创建角色" : "保存角色"}
                </Button>
              ) : null}
            </>
          }
        >
          <form
            id="cms-role-form"
            onSubmit={saveRole}
            className="cms-form-stack"
          >
            <fieldset disabled={lockedRole}>
              <div>
                <Field label="角色名称" required>
                  <input
                    aria-label="角色名称"
                    autoFocus
                    required
                    maxLength={60}
                    value={roleDraft.name}
                    onChange={(e) => {
                      setRoleError("");
                      setRoleDraft({ ...roleDraft, name: e.target.value });
                    }}
                  />
                </Field>
              </div>
              <div className="role-permission-intro">
                <strong>按模块配置权限</strong>
              </div>
              <div className="role-permission-modules">
                {permissionModules.map((module) => {
                  const enabled = roleDraft.menus.includes(module.key);
                  const count = module.actions.filter((a) =>
                    roleDraft.permissions.includes(a.key),
                  ).length;
                  return (
                    <section
                      className={`role-permission-module ${enabled ? "enabled" : ""}`}
                      key={module.key}
                    >
                      <div className="role-permission-module-heading">
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`访问：${module.label}`}
                            checked={enabled}
                            onChange={(e) => {
                              setRoleError("");
                              setRoleDraft(
                                toggleRoleModule(
                                  roleDraft,
                                  module.key,
                                  e.target.checked,
                                ),
                              );
                            }}
                          />
                          <span>
                            <strong>{module.label}</strong>
                          </span>
                        </label>
                        <span>
                          {enabled
                            ? module.actions.length
                              ? `${count}/${module.actions.length} 项操作`
                              : "可查看"
                            : "未开放"}
                        </span>
                      </div>
                      {module.actions.length > 0 ? (
                        <div className="role-permission-actions">
                          {module.actions.map((action) => (
                            <label key={action.key}>
                              <input
                                type="checkbox"
                                aria-label={`权限：${action.label}`}
                                checked={roleDraft.permissions.includes(
                                  action.key,
                                )}
                                onChange={(e) => {
                                  setRoleError("");
                                  setRoleDraft(
                                    toggleRoleAction(
                                      roleDraft,
                                      action.key,
                                      e.target.checked,
                                    ),
                                  );
                                }}
                              />
                              <span>
                                <strong>{action.label}</strong>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </fieldset>
            <Note>
              {lockedRole
                ? "系统内置超级管理员拥有全部权限，不能修改或删除，也不能分配给其他账号。"
                : creating
                  ? "保存后可为账号分配此角色。勾选操作时会自动开启对应菜单。"
                  : `保存后将对 ${state.users.filter((u) => u.roleId === roleDraft.id).length} 个关联账号生效。`}
            </Note>
            {roleError ? (
              <p className="cms-form-error" role="alert">
                {roleError}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
      {confirm ? (
        <Dialog
          title={
            confirm.type === "role"
              ? "删除角色"
              : confirm.enabled
                ? "启用账号"
                : "停用账号"
          }
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <Button onClick={() => setConfirm(undefined)}>取消</Button>
              <Button
                variant={confirm.enabled ? "primary" : "danger"}
                onClick={perform}
              >
                确认
                {confirm.type === "role"
                  ? "删除"
                  : confirm.enabled
                    ? "启用"
                    : "停用"}
              </Button>
            </>
          }
        >
          <p>
            {confirm.type === "role"
              ? `确认删除“${confirm.name}”？`
              : `确认${confirm.enabled ? "启用" : "停用"}“${confirm.name}”的账号？`}
          </p>
          <p className="muted admin-confirm-copy">
            {confirm.type === "role"
              ? `当前关联 ${state.users.filter((u) => u.roleId === confirm.id).length} 个账号。有关联账号时需要先更换角色。`
              : confirm.enabled
                ? "启用后可按其角色权限登录。"
                : "停用后不能登录，其内容和历史记录保留。"}
          </p>
          {confirmError ? (
            <p className="cms-form-error" role="alert">
              {confirmError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
