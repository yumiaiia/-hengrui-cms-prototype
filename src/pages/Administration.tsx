import { useState, type FormEvent } from "react";
import { Download, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Note,
  PageHeader,
  Pagination,
  SearchBox,
  Tabs,
} from "../components/ui";
import {
  current,
  dateLabel,
  go,
  now,
  ocrWarnings,
  permissionNames,
  uid,
  type Audit,
  type CredentialRevision,
  type Permission,
  type Role,
  type User,
} from "../model";
import { useCMS } from "../store";
import { csvCell, download } from "../storage";
import "./admin.css";

const menus = [
  { key: "workbench", label: "工作台" },
  { key: "library", label: "内容库" },
  { key: "collection", label: "公众号采集" },
  { key: "credentials", label: "审批凭证" },
  { key: "tags", label: "标签管理" },
  { key: "admin", label: "系统管理" },
];
const permissions = Object.entries(permissionNames) as [Permission, string][];
const categories: Audit["category"][] = ["内容", "审批校验", "标签", "系统"];
const hasAdminAccess = (role: Role | undefined) =>
  !!role?.permissions.includes("admin") && role.menus.includes("admin");
const csvValue = (value: string) =>
  csvCell(/^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value);
interface UserDraft {
  id?: string;
  name: string;
  account: string;
  roleId: string;
}
interface OcrSource {
  label: string;
  credentialId?: string;
  revision: CredentialRevision;
}

export default function Administration() {
  const { state, user, role, assets, can, update, toast } = useCMS();
  const [tab, setTab] = useState(
    () =>
      new URLSearchParams(window.location.hash.split("?")[1] || "").get(
        "tab",
      ) || "users",
  );
  const [userSearch, setUserSearch] = useState("");
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [userError, setUserError] = useState("");
  const [roleDraft, setRoleDraft] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [person, setPerson] = useState("");
  const [category, setCategory] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditId, setAuditId] = useState<string | null>(null);

  if (!user || !can("admin") || !role?.menus.includes("admin")) {
    return (
      <div className="cms-admin-page">
        <PageHeader
          title="系统管理"
          description="只有具备管理菜单和管理操作权限的账号可以访问。"
        />
        <Empty
          title="当前账号没有管理权限"
          description="用户、角色及审计记录不对当前身份开放。请联系管理员调整角色。"
          action={
            role?.menus.includes("workbench") ? (
              <Button onClick={() => go("workbench")}>返回工作台</Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const filteredUsers = state.users.filter((item) =>
    `${item.name} ${item.account} ${state.roles.find((r) => r.id === item.roleId)?.name || ""}`
      .toLowerCase()
      .includes(userSearch.trim().toLowerCase()),
  );
  const dateInvalid = !!start && !!end && start > end;
  const auditRows = dateInvalid
    ? []
    : state.audits
        .filter((item) => {
          const timestamp = Date.parse(item.at);
          return (
            `${item.action} ${item.object} ${item.detail}`
              .toLowerCase()
              .includes(auditSearch.trim().toLowerCase()) &&
            (!person || item.user === person) &&
            (!category || item.category === category) &&
            (!start || timestamp >= Date.parse(`${start}T00:00:00+08:00`)) &&
            (!end || timestamp <= Date.parse(`${end}T23:59:59.999+08:00`))
          );
        })
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const page = Math.min(
    auditPage,
    Math.max(1, Math.ceil(auditRows.length / 8)),
  );
  const selectedAudit = state.audits.find((item) => item.id === auditId);
  const chosenRole = state.roles.find((item) => item.id === userDraft?.roleId);
  const selfRoleBlocked =
    !!roleDraft && user.roleId === roleDraft.id && !hasAdminAccess(roleDraft);

  function editUser(item?: User) {
    setUserError("");
    setUserDraft(
      item
        ? {
            id: item.id,
            name: item.name,
            account: item.account,
            roleId: item.roleId,
          }
        : {
            name: "",
            account: "",
            roleId:
              state.roles.find((r) => r.id === "operator")?.id ||
              state.roles[0]?.id ||
              "",
          },
    );
  }

  function saveUser(event: FormEvent) {
    event.preventDefault();
    if (!userDraft || !can("admin")) return;
    const name = userDraft.name.trim();
    const account = userDraft.account.trim();
    const targetRole = state.roles.find((item) => item.id === userDraft.roleId);
    if (!name || !account || !targetRole)
      return setUserError("请填写姓名、账号并选择有效角色。");
    if (/\s/.test(account)) return setUserError("账号不能包含空白字符。");
    if (
      state.users.some(
        (item) =>
          item.id !== userDraft.id &&
          item.account.toLowerCase() === account.toLowerCase(),
      )
    )
      return setUserError(
        "账号已存在，请使用唯一账号（不区分大小写检查重复）。",
      );
    if (userDraft.id === user?.id && !hasAdminAccess(targetRole))
      return setUserError(
        "不能移除当前账号的管理入口。请由另一位管理员调整你的角色。",
      );
    if (userDraft.id && !state.users.some((item) => item.id === userDraft.id))
      return setUserError("该用户已不存在，请关闭窗口后刷新列表。");
    const previous = state.users.find((item) => item.id === userDraft.id);
    const previousRole = state.roles.find(
      (item) => item.id === previous?.roleId,
    );
    const saved = update(
      (draft) => {
        if (userDraft.id) {
          const item = draft.users.find((item) => item.id === userDraft.id)!;
          Object.assign(item, { name, account, roleId: targetRole.id });
        } else {
          draft.users.push({
            id: uid("user"),
            name,
            account,
            roleId: targetRole.id,
            createdAt: now(),
          });
        }
      },
      {
        action: userDraft.id ? "编辑用户" : "创建用户",
        object: `${name}（${account}）`,
        detail: `${previous ? `原角色：${previousRole?.name || "未分配"}；` : ""}角色：${targetRole.name}；数据范围：${targetRole.dataRange === "all" ? "全部内容" : "本人内容"}。本地演示账号，无真实认证。`,
        category: "系统",
      },
      "admin",
    );
    if (saved) {
      setUserDraft(null);
      toast(
        userDraft.id
          ? "用户信息已保存。"
          : "用户已创建，可在演示登录页选择该账号。",
      );
    }
  }

  function saveRole(event: FormEvent) {
    event.preventDefault();
    if (!roleDraft || !can("admin")) return;
    const name = roleDraft.name.trim();
    if (!name) return setRoleError("角色名称不能为空。");
    if (
      state.roles.some(
        (item) => item.id !== roleDraft.id && item.name.trim() === name,
      )
    )
      return setRoleError("角色名称已存在。");
    if (!state.roles.some((item) => item.id === roleDraft.id))
      return setRoleError("角色已不存在。");
    if (selfRoleBlocked)
      return setRoleError(
        "不能同时撤销自己正在使用的管理入口。请保留「系统管理」菜单和「用户、角色与审计」操作权限。",
      );
    if (
      roleDraft.permissions.includes("admin") &&
      !roleDraft.menus.includes("admin")
    )
      return setRoleError(
        "管理操作权限需要同时开放「系统管理」菜单，避免配置不可用的管理角色。",
      );
    const affected = state.users.filter(
      (item) => item.roleId === roleDraft.id,
    ).length;
    const saved = update(
      (draft) => {
        const item = draft.roles.find((item) => item.id === roleDraft.id)!;
        Object.assign(item, {
          name,
          menus: [...roleDraft.menus],
          permissions: [...roleDraft.permissions],
          dataRange: roleDraft.dataRange,
        });
      },
      {
        action: "编辑角色权限",
        object: name,
        detail: `菜单：${
          menus
            .filter((item) => roleDraft.menus.includes(item.key))
            .map((item) => item.label)
            .join("、") || "无"
        }；操作：${roleDraft.permissions.map((p) => permissionNames[p]).join("、") || "无"}；数据范围：${roleDraft.dataRange === "all" ? "全部内容" : "本人内容"}；影响 ${affected} 个账号。`,
        category: "系统",
      },
      "admin",
    );
    if (saved) {
      setRoleDraft(null);
      toast("角色已保存，关联账号按新的菜单、操作权限与数据范围使用。");
    }
  }

  function exportAudits() {
    if (!can("admin")) return toast("当前账号不能导出审计记录。");
    if (dateInvalid) return toast("开始日期不能晚于结束日期。");
    if (!auditRows.length) return toast("当前筛选没有可导出的审计记录。");
    try {
      const rows = [
        ["时间（上海）", "操作人", "分类", "操作", "对象", "详细记录"],
        ...auditRows.map((item) => [
          new Date(item.at).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          }),
          item.user,
          item.category,
          item.action,
          item.object,
          item.detail,
        ]),
      ];
      const blob = new Blob(
        ["\uFEFF", rows.map((row) => row.map(csvValue).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      );
      download(blob, `审计记录-${now().slice(0, 10)}.csv`);
      update(
        () => {},
        {
          action: "导出审计记录",
          object: `${auditRows.length} 条记录`,
          detail: `已导出当前筛选结果，日期：${start || "不限"} 至 ${end || "不限"}；操作人：${person || "全部"}；分类：${category || "全部"}。`,
          category: "系统",
        },
        "admin",
      );
      toast(`已下载 ${auditRows.length} 条审计记录（CSV）。`);
    } catch {
      toast("审计文件下载失败，请重试。");
    }
  }

  function ocrSources(audit: Audit): OcrSource[] {
    const text = `${audit.object} ${audit.detail}`;
    const matches = (
      revision: CredentialRevision,
      identity?: string,
      title?: string,
    ) =>
      (identity && audit.object === identity) ||
      (title && audit.object === title) ||
      (!!revision.number && text.includes(revision.number)) ||
      (!!revision.title && audit.object === revision.title) ||
      revision.evidence.some(
        (item) => !!item.number && text.includes(item.number),
      );
    const sources: OcrSource[] = [];
    for (const credential of state.credentials) {
      for (const revision of credential.revisions) {
        if (matches(revision, credential.id))
          sources.push({
            label: `审批凭证 · 修订 ${revision.revision}`,
            credentialId: credential.id,
            revision,
          });
      }
    }
    for (const asset of assets) {
      const version = current(asset);
      const snapshot = version.approval.snapshot;
      if (snapshot && matches(snapshot, asset.code, version.title))
        sources.push({
          label: `${asset.code} · 当前内容版本 V${version.number} · ${version.title}`,
          credentialId: version.approval.credentialId,
          revision: snapshot,
        });
    }
    return sources;
  }

  return (
    <div className="cms-admin-page">
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="系统管理"
        description="管理本地演示账号、角色边界与可追溯的操作记录。"
        action={<Badge tone="blue">管理员视图</Badge>}
      />
      <Tabs
        value={["users", "roles", "audit"].includes(tab) ? tab : "users"}
        onChange={setTab}
        items={[
          { key: "users", label: "用户管理", count: state.users.length },
          { key: "roles", label: "角色与权限", count: state.roles.length },
          { key: "audit", label: "操作审计", count: state.audits.length },
        ]}
      />

      {tab !== "roles" && tab !== "audit" ? (
        <section className="panel">
          <div className="toolbar">
            <SearchBox
              value={userSearch}
              onChange={setUserSearch}
              placeholder="搜索姓名、账号或角色"
            />
            <Button
              variant="primary"
              icon={<UserPlus size={16} />}
              onClick={() => editUser()}
            >
              创建用户
            </Button>
          </div>
          <Note>
            用户的数据范围继承角色，不单独配置。这里创建的账号仅保存在当前浏览器，不建立真实企业账号。
          </Note>
          {filteredUsers.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>用户 / 账号</th>
                    <th>角色</th>
                    <th>数据范围</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((item) => {
                    const assigned = state.roles.find(
                      (r) => r.id === item.roleId,
                    );
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          {item.id === user.id ? (
                            <Badge tone="blue">当前账号</Badge>
                          ) : null}
                          <div className="muted">{item.account}</div>
                        </td>
                        <td>{assigned?.name || "角色不存在"}</td>
                        <td>
                          {assigned
                            ? assigned.dataRange === "all"
                              ? "全部内容"
                              : "仅本人内容"
                            : "不可访问内容"}
                        </td>
                        <td>{dateLabel(item.createdAt)}</td>
                        <td>
                          <Button
                            variant="ghost"
                            icon={<Pencil size={15} />}
                            onClick={() => editUser(item)}
                          >
                            编辑用户
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="没有匹配的用户"
              description="调整姓名、账号或角色关键词。"
            />
          )}
        </section>
      ) : null}

      {tab === "roles" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>角色边界</h2>
              <p className="muted">
                菜单决定入口，操作权限决定可执行动作，数据范围决定可见内容。
              </p>
            </div>
            <ShieldCheck size={23} />
          </div>
          <Note>
            保存角色后，关联账号统一继承配置；菜单可见不等于拥有对应操作权限。当前账号的管理菜单与管理操作权限必须保留。
          </Note>
          <div className="cms-role-grid">
            {state.roles.map((item) => (
              <article className="cms-role-card" key={item.id}>
                <div className="section-heading">
                  <h3>{item.name}</h3>
                  <Badge tone="blue">
                    {state.users.filter((u) => u.roleId === item.id).length}{" "}
                    位用户
                  </Badge>
                </div>
                <dl className="cms-definition">
                  <div>
                    <dt>数据范围</dt>
                    <dd>
                      {item.dataRange === "all"
                        ? "全部内容"
                        : "仅本人创建的内容"}
                    </dd>
                  </div>
                  <div>
                    <dt>菜单入口</dt>
                    <dd>
                      {menus
                        .filter((menu) => item.menus.includes(menu.key))
                        .map((menu) => menu.label)
                        .join("、") || "未开放菜单"}
                    </dd>
                  </div>
                  <div>
                    <dt>操作权限</dt>
                    <dd>
                      {item.permissions
                        .map((p) => permissionNames[p])
                        .join("、") || "无操作权限"}
                    </dd>
                  </div>
                </dl>
                <Button
                  icon={<Pencil size={15} />}
                  onClick={() => {
                    setRoleError("");
                    setRoleDraft(structuredClone(item));
                  }}
                >
                  查看与编辑
                </Button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "audit" ? (
        <section className="panel">
          <div className="toolbar">
            <SearchBox
              value={auditSearch}
              onChange={(value) => {
                setAuditSearch(value);
                setAuditPage(1);
              }}
              placeholder="搜索操作、对象或详细记录"
            />
            <Button
              icon={<Download size={16} />}
              onClick={exportAudits}
              disabled={!auditRows.length || dateInvalid}
            >
              导出筛选结果 CSV
            </Button>
          </div>
          <div className="form-grid cms-audit-filters">
            <Field label="操作人">
              <select
                value={person}
                onChange={(event) => {
                  setPerson(event.target.value);
                  setAuditPage(1);
                }}
              >
                <option value="">全部操作人</option>
                {[...new Set(state.audits.map((item) => item.user))].map(
                  (name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="分类">
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setAuditPage(1);
                }}
              >
                <option value="">全部分类</option>
                {categories.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="开始日期（上海）">
              <input
                type="date"
                value={start}
                onChange={(event) => {
                  setStart(event.target.value);
                  setAuditPage(1);
                }}
              />
            </Field>
            <Field
              label="结束日期（上海）"
              error={dateInvalid ? "结束日期不能早于开始日期" : undefined}
            >
              <input
                type="date"
                value={end}
                onChange={(event) => {
                  setEnd(event.target.value);
                  setAuditPage(1);
                }}
              />
            </Field>
          </div>
          <p className="muted">
            CSV 包含全部筛选结果及完整记录，使用 UTF-8 BOM 并对公式前缀转义。
          </p>
          {auditRows.length ? (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>分类</th>
                      <th>操作 / 对象</th>
                      <th>详细记录</th>
                      <th>查看</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.slice((page - 1) * 8, page * 8).map((item) => (
                      <tr key={item.id}>
                        <td>{dateLabel(item.at)}</td>
                        <td>{item.user}</td>
                        <td>
                          <Badge>{item.category}</Badge>
                        </td>
                        <td>
                          <strong>{item.action}</strong>
                          <div className="muted">{item.object}</div>
                        </td>
                        <td>
                          <div className="cms-audit-excerpt">
                            {item.detail || "未填写详细说明"}
                          </div>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() => setAuditId(item.id)}
                          >
                            {item.category === "审批校验" ||
                            /OCR/i.test(item.action)
                              ? "OCR 核对详情"
                              : "查看记录"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                total={auditRows.length}
                page={page}
                onChange={setAuditPage}
              />
            </>
          ) : (
            <Empty
              title={dateInvalid ? "请修正日期范围" : "没有匹配的审计记录"}
              description="调整关键词、操作人、分类或时间范围。"
            />
          )}
        </section>
      ) : null}

      {userDraft ? (
        <Dialog
          title={userDraft.id ? "编辑用户" : "创建本地演示用户"}
          onClose={() => setUserDraft(null)}
          footer={
            <>
              <Button onClick={() => setUserDraft(null)}>取消</Button>
              <Button variant="primary" type="submit" form="cms-user-form">
                {userDraft.id ? "保存用户" : "创建用户"}
              </Button>
            </>
          }
        >
          <form
            id="cms-user-form"
            onSubmit={saveUser}
            className="cms-form-stack"
          >
            <div className="form-grid">
              <Field label="姓名" required>
                <input
                  autoFocus
                  required
                  maxLength={60}
                  value={userDraft.name}
                  onChange={(event) => {
                    setUserError("");
                    setUserDraft({ ...userDraft, name: event.target.value });
                  }}
                />
              </Field>
              <Field
                label="账号"
                required
                hint="唯一账号，不含空格；登录时按保存的拼写匹配。"
              >
                <input
                  required
                  maxLength={80}
                  autoComplete="off"
                  value={userDraft.account}
                  onChange={(event) => {
                    setUserError("");
                    setUserDraft({ ...userDraft, account: event.target.value });
                  }}
                />
              </Field>
            </div>
            <Field label="角色" required>
              <select
                required
                value={userDraft.roleId}
                onChange={(event) => {
                  setUserError("");
                  setUserDraft({ ...userDraft, roleId: event.target.value });
                }}
              >
                <option value="" disabled>
                  选择角色
                </option>
                {state.roles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Note>
              继承的数据范围：
              {chosenRole
                ? chosenRole.dataRange === "all"
                  ? "全部内容"
                  : "仅本人创建的内容"
                : "请选择角色"}
              。更改角色会同时更改菜单和操作权限。
            </Note>
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
          title="角色详情与权限编辑"
          onClose={() => setRoleDraft(null)}
          footer={
            <>
              <Button onClick={() => setRoleDraft(null)}>取消</Button>
              <Button
                variant="primary"
                type="submit"
                form="cms-role-form"
                disabled={selfRoleBlocked}
              >
                保存角色
              </Button>
            </>
          }
        >
          <form
            id="cms-role-form"
            onSubmit={saveRole}
            className="cms-form-stack"
          >
            <div className="form-grid">
              <Field label="角色名称" required>
                <input
                  autoFocus
                  required
                  maxLength={60}
                  value={roleDraft.name}
                  onChange={(event) => {
                    setRoleError("");
                    setRoleDraft({ ...roleDraft, name: event.target.value });
                  }}
                />
              </Field>
              <Field label="数据范围">
                <select
                  value={roleDraft.dataRange}
                  onChange={(event) =>
                    setRoleDraft({
                      ...roleDraft,
                      dataRange: event.target.value as Role["dataRange"],
                    })
                  }
                >
                  <option value="all">全部内容</option>
                  <option value="own">仅本人创建的内容</option>
                </select>
              </Field>
            </div>
            <fieldset className="cms-check-fieldset">
              <legend>菜单入口</legend>
              <div className="cms-check-grid">
                {menus.map((item) => (
                  <label key={item.key}>
                    <input
                      type="checkbox"
                      checked={roleDraft.menus.includes(item.key)}
                      onChange={(event) => {
                        setRoleError("");
                        setRoleDraft({
                          ...roleDraft,
                          menus: event.target.checked
                            ? [...roleDraft.menus, item.key]
                            : roleDraft.menus.filter((key) => key !== item.key),
                        });
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="cms-check-fieldset">
              <legend>操作权限</legend>
              <div className="cms-check-grid">
                {permissions.map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={roleDraft.permissions.includes(key)}
                      onChange={(event) => {
                        setRoleError("");
                        setRoleDraft({
                          ...roleDraft,
                          permissions: event.target.checked
                            ? [...roleDraft.permissions, key]
                            : roleDraft.permissions.filter((p) => p !== key),
                        });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Note tone={selfRoleBlocked ? "amber" : "blue"}>
              {selfRoleBlocked
                ? "此修改会使当前账号失去管理入口，不能保存。请保留「系统管理」菜单与「用户、角色与审计」权限。"
                : `将影响 ${state.users.filter((item) => item.roleId === roleDraft.id).length} 个关联账号。菜单、操作和数据范围分别生效；本地原型不代表服务端安全控制。`}
            </Note>
            {roleError ? (
              <p className="cms-form-error" role="alert">
                {roleError}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}

      {selectedAudit ? (
        <Dialog
          wide
          title={
            selectedAudit.category === "审批校验" ||
            /OCR/i.test(selectedAudit.action)
              ? "OCR 审计核对详情"
              : "操作记录详情"
          }
          onClose={() => setAuditId(null)}
          footer={<Button onClick={() => setAuditId(null)}>关闭</Button>}
        >
          <dl className="cms-definition cms-audit-meta">
            <div>
              <dt>操作</dt>
              <dd>{selectedAudit.action}</dd>
            </div>
            <div>
              <dt>对象</dt>
              <dd>{selectedAudit.object}</dd>
            </div>
            <div>
              <dt>操作人</dt>
              <dd>{selectedAudit.user}</dd>
            </div>
            <div>
              <dt>时间（上海）</dt>
              <dd>
                {new Date(selectedAudit.at).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  hour12: false,
                })}
              </dd>
            </div>
          </dl>
          <h3>操作发生时的完整记录</h3>
          <p className="cms-audit-detail">
            {selectedAudit.detail || "未填写详细说明"}
          </p>
          {selectedAudit.category === "审批校验" ||
          /OCR/i.test(selectedAudit.action) ? (
            <div className="cms-form-stack">
              <Note tone="amber">
                以下字段来自匹配的现存凭证修订与当前内容审批快照，不是从历史日志还原的图片识别结果。人工确认不会覆盖原始识别值，也不会消除差异提示。
              </Note>
              {ocrSources(selectedAudit).length ? (
                ocrSources(selectedAudit).map((source, index) => {
                  const warnings = ocrWarnings(source.revision);
                  return (
                    <section
                      className="cms-ocr-source"
                      key={`${source.label}-${index}`}
                    >
                      <div className="section-heading">
                        <h3>{source.label}</h3>
                        {source.credentialId &&
                        role.menus.includes("credentials") ? (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              go(
                                `credentials?open=${encodeURIComponent(source.credentialId!)}`,
                              )
                            }
                          >
                            查看凭证
                          </Button>
                        ) : null}
                      </div>
                      <dl className="cms-definition">
                        <div>
                          <dt>登记编号</dt>
                          <dd>{source.revision.number || "未填写"}</dd>
                        </div>
                        <div>
                          <dt>登记有效期</dt>
                          <dd>{source.revision.expiry || "未填写"}</dd>
                        </div>
                        <div>
                          <dt>登记材料包标题</dt>
                          <dd>{source.revision.title || "未填写"}</dd>
                        </div>
                        <div>
                          <dt>人工确认</dt>
                          <dd>
                            {source.revision.confirmed
                              ? source.revision.confirmation ||
                                "已确认，未填写说明"
                              : "未人工确认"}
                          </dd>
                        </div>
                      </dl>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>识别来源</th>
                              <th>原始识别编号</th>
                              <th>原始识别有效期</th>
                              <th>原始识别标题</th>
                              <th>识别状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {source.revision.evidence.map((item) => (
                              <tr key={item.id}>
                                <td>{item.name}</td>
                                <td>{item.number || "未识别"}</td>
                                <td>{item.expiry || "未识别"}</td>
                                <td>{item.title || "未识别"}</td>
                                <td>
                                  <Badge>{item.status}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {warnings.length ? (
                        <Note tone="amber">
                          <strong>仍需核对的原始差异</strong>
                          <ul>
                            {warnings.map((warning, i) => (
                              <li key={i}>{warning}</li>
                            ))}
                          </ul>
                        </Note>
                      ) : (
                        <p className="muted">
                          现存字段未发现编号、有效期或标题差异；仍需核对原审批材料的覆盖范围。
                        </p>
                      )}
                    </section>
                  );
                })
              ) : (
                <Empty
                  title="未匹配到现存 OCR 来源"
                  description="凭证或内容可能已变更。上方历史记录保留原文，不补造识别字段。"
                />
              )}
            </div>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
