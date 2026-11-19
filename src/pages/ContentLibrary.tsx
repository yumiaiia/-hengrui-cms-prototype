import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Download,
  RotateCw,
  Tag,
  ShieldCheck,
  ArchiveX,
  Eye,
  ArrowUpRight,
  X,
} from "lucide-react";
import { useCMS } from "../store";
import {
  approvalLabel,
  credentialLatest,
  current,
  dateLabel,
  expiryStatus,
  go,
  now,
  groups,
  type Kind,
} from "../model";
import {
  AssetImage,
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Note,
  PageHeader,
  Pagination,
  SearchBox,
} from "../components/ui";
import { ExportDialog } from "../export";
type Filters = {
  q: string;
  kind: string;
  source: string;
  process: string;
  approval: string;
  expiry: string;
  lifecycle: string;
  tagStatus: string;
  owner: string;
  tags: string[];
};
const defaults: Filters = {
  q: "",
  kind: "",
  source: "",
  process: "",
  approval: "",
  expiry: "",
  lifecycle: "正常",
  tagStatus: "",
  owner: "",
  tags: [],
};
const cacheKey = "hengrui-cms-library-view";
export default function ContentLibrary() {
  const { assets, state, can, update, toast, reprocess } = useCMS();
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return {
        ...defaults,
        ...JSON.parse(
          sessionStorage.getItem(cacheKey + "-" + state.userId) || "{}",
        ),
      };
    } catch {
      return defaults;
    }
  });
  const [view, setView] = useState("list");
  const [page, setPage] = useState(
    Number(
      sessionStorage.getItem("hengrui-cms-library-page-" + state.userId),
    ) || 1,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [action, setAction] = useState("");
  const [quick, setQuick] = useState<string>();
  const [exportOpen, setExportOpen] = useState(false);
  const [tagId, setTagId] = useState("");
  const [tagMode, setTagMode] = useState("追加");
  const [credentialId, setCredentialId] = useState("");
  const [reason, setReason] = useState("");
  const [protect, setProtect] = useState(true);
  const query = location.hash.split("?")[1] || "";
  useEffect(() => {
    if (query) {
      const params = new URLSearchParams(query);
      const patch: Partial<Filters> = {};
      for (const key of [
        "q",
        "process",
        "approval",
        "expiry",
        "tagStatus",
      ] as const)
        if (params.has(key)) patch[key] = params.get(key)!;
      setFilters({ ...defaults, ...patch });
      setPage(1);
    }
  }, [query]);
  useEffect(() => {
    sessionStorage.setItem(
      cacheKey + "-" + state.userId,
      JSON.stringify(filters),
    );
  }, [filters]);
  useEffect(() => {
    sessionStorage.setItem(
      "hengrui-cms-library-page-" + state.userId,
      String(page),
    );
  }, [page]);
  const change = (key: keyof Filters, value: string | string[]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelected([]);
  };
  const rows = useMemo(
    () =>
      assets.filter((a) => {
        const v = current(a);
        const search = [
          v.title,
          a.code,
          v.approval.snapshot?.number,
          state.users.find((u) => u.id === a.ownerId)?.name,
          ...v.tags.map((t) => state.tags.find((s) => s.id === t.tagId)?.name),
        ]
          .join(" ")
          .toLowerCase();
        const selectedGroups = groups
          .map((g) =>
            filters.tags.filter(
              (id) => state.tags.find((t) => t.id === id)?.group === g,
            ),
          )
          .filter((g) => g.length);
        return (
          (!filters.q || search.includes(filters.q.toLowerCase())) &&
          (!filters.kind || v.kind === filters.kind) &&
          (!filters.source || v.source === filters.source) &&
          (!filters.process ||
            (filters.process === "异常"
              ? ["失败", "部分失败"].includes(v.process)
              : v.process === filters.process)) &&
          (!filters.approval || v.approval.mode === filters.approval) &&
          (!filters.expiry || expiryStatus(v) === filters.expiry) &&
          (!filters.lifecycle || a.lifecycle === filters.lifecycle) &&
          (!filters.tagStatus || v.tagStatus === filters.tagStatus) &&
          (!filters.owner || a.ownerId === filters.owner) &&
          selectedGroups.every((g) => v.tags.some((t) => g.includes(t.tagId)))
        );
      }),
    [assets, state.tags, state.users, filters],
  );
  const activePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const visible = rows.slice((activePage - 1) * 8, activePage * 8);
  const chosen = assets.filter((a) => selected.includes(a.id));
  const currentPage = visible.map((a) => a.id);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((i) => i !== id) : [...s, id],
    );
  const allPage =
    currentPage.length > 0 && currentPage.every((id) => selected.includes(id));
  const chips = Object.entries(filters).filter(
    ([k, v]) => k !== "lifecycle" && (Array.isArray(v) ? v.length : v),
  );
  function apply() {
    if (!chosen.length) return;
    if (action === "tags") {
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) return toast("请先选择标准标签。");
      update(
        (s) => {
          for (const a of s.assets.filter((a) => selected.includes(a.id))) {
            const v = current(a);
            if (tagMode === "移除")
              v.tags = v.tags.filter((t) => t.tagId !== tagId);
            else {
              if (tagMode === "替换维度")
                v.tags = v.tags.filter(
                  (t) =>
                    s.tags.find((p) => p.id === t.tagId)?.group !== tag.group ||
                    t.page,
                );
              if (!v.tags.some((t) => t.tagId === tagId && !t.page))
                v.tags.push({ tagId, origin: "人工" });
            }
            a.updatedAt = now();
          }
        },
        {
          action: `批量${tagMode}标签`,
          object: `${chosen.length} 份内容`,
          detail: tag.name,
          category: "标签",
        },
        "tags",
      );
    }
    if (action === "approval") {
      const c = state.credentials.find((c) => c.id === credentialId);
      if (!c) return toast("请选择审批凭证。");
      const snapshot = credentialLatest(c);
      update(
        (s) => {
          for (const a of s.assets.filter((a) => selected.includes(a.id))) {
            current(a).approval = {
              mode: "registered",
              credentialId: c.id,
              snapshot: structuredClone(snapshot),
            };
            a.updatedAt = now();
          }
        },
        {
          action: "关联审批凭证",
          object: `${chosen.length} 份内容`,
          detail: snapshot.number,
        },
        "edit",
      );
    }
    if (action === "rerun") reprocess(selected, protect);
    if (action === "void") {
      if (!reason.trim()) return toast("请填写作废原因。");
      update(
        (s) => {
          for (const a of s.assets.filter((a) => selected.includes(a.id))) {
            a.lifecycle = "已作废";
            a.voidReason = reason;
            a.updatedAt = now();
          }
        },
        {
          action: "作废内容",
          object: `${chosen.length} 份内容`,
          detail: reason,
        },
        "void",
      );
    }
    toast(
      action === "rerun"
        ? "重跑任务已开始。"
        : `已完成 ${chosen.length} 份内容的操作。`,
    );
    setAction("");
    setSelected([]);
    setReason("");
  }
  const quickAsset = assets.find((a) => a.id === quick);
  return (
    <>
      <PageHeader
        eyebrow="内容管理 / CONTENT LIBRARY"
        title="内容库"
        description="统一管理内容、版本与审批依据，让资料始终清晰可查。"
        action={
          can("upload") ? (
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() => go("upload")}
            >
              新增内容
            </Button>
          ) : null
        }
      />
      <div className="library-overline">
        <span>
          <strong>{assets.length}</strong> 份内容资产
        </span>
        <span>文件、网页与公众号内容统一归档</span>
        <div className="view-toggle">
          <button
            aria-label="表格视图"
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            <List size={17} />
          </button>
          <button
            aria-label="卡片视图"
            className={view === "grid" ? "active" : ""}
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={17} />
          </button>
        </div>
      </div>
      <section className="panel library-panel">
        <div className="library-toolbar">
          <SearchBox
            placeholder="搜索内容名称、CMS 编号或审批编号"
            value={filters.q}
            onChange={(v) => change("q", v)}
          />
          <Button
            icon={<SlidersHorizontal size={16} />}
            onClick={() => setAdvanced(true)}
          >
            高级筛选{filters.tags.length ? ` (${filters.tags.length})` : ""}
          </Button>
        </div>
        <div className="filter-row">
          <select
            aria-label="内容类型"
            value={filters.kind}
            onChange={(e) => change("kind", e.target.value)}
          >
            <option value="">所有类型</option>
            {["PDF", "PPT", "Word", "图片", "视频", "网页"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="处理状态"
            value={filters.process}
            onChange={(e) => change("process", e.target.value)}
          >
            <option value="">处理状态</option>
            {["排队中", "处理中", "完成", "部分失败", "失败"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="审批登记"
            value={filters.approval}
            onChange={(e) => change("approval", e.target.value)}
          >
            <option value="">审批登记</option>
            <option value="pending">待补充</option>
            <option value="registered">已登记</option>
            <option value="exempt">免登记</option>
          </select>
          <select
            aria-label="有效期状态"
            value={filters.expiry}
            onChange={(e) => change("expiry", e.target.value)}
          >
            <option value="">有效期状态</option>
            {["生效中", "即将过期", "已过期", "未设置"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="生命周期"
            value={filters.lifecycle}
            onChange={(e) => change("lifecycle", e.target.value)}
          >
            <option>正常</option>
            <option>已作废</option>
            <option value="">全部生命周期</option>
          </select>
          {chips.length ? (
            <button
              className="text-link"
              onClick={() => {
                setFilters(defaults);
                setPage(1);
                setSelected([]);
              }}
            >
              清空筛选
            </button>
          ) : null}
        </div>
        {chips.length ? (
          <div className="filter-chips">
            {chips.map(([key, value]) => (
              <button
                key={key}
                onClick={() =>
                  change(key as keyof Filters, Array.isArray(value) ? [] : "")
                }
              >
                {key === "tags"
                  ? `标签 ${filters.tags.length} 个`
                  : key === "approval"
                    ? value === "registered"
                      ? "已登记"
                      : value === "pending"
                        ? "待补充"
                        : "免登记"
                    : key === "owner"
                      ? state.users.find((u) => u.id === value)?.name
                      : String(value)}
                <X size={12} />
              </button>
            ))}
          </div>
        ) : null}
        {selected.length ? (
          <div className="batch-bar">
            <strong>已选择 {chosen.length} 条</strong>
            <button onClick={() => setSelected(rows.map((a) => a.id))}>
              选择筛选结果中的全部 {rows.length} 条
            </button>
            <div />
            <Button
              disabled={!can("tags")}
              icon={<Tag size={14} />}
              onClick={() => setAction("tags")}
            >
              改标签
            </Button>
            <Button
              disabled={!can("rerun")}
              icon={<RotateCw size={14} />}
              onClick={() => setAction("rerun")}
            >
              重跑
            </Button>
            <Button
              disabled={!can("edit")}
              icon={<ShieldCheck size={14} />}
              onClick={() => setAction("approval")}
            >
              关联凭证
            </Button>
            <Button
              disabled={!can("export")}
              icon={<Download size={14} />}
              onClick={() => setExportOpen(true)}
            >
              导出
            </Button>
            <Button
              variant="danger"
              disabled={!can("void")}
              icon={<ArchiveX size={14} />}
              onClick={() => setAction("void")}
            >
              作废
            </Button>
            <button aria-label="取消选择" onClick={() => setSelected([])}>
              <X size={17} />
            </button>
          </div>
        ) : null}
        {!rows.length ? (
          <Empty
            action={
              <Button onClick={() => setFilters(defaults)}>清空筛选</Button>
            }
          />
        ) : view === "list" ? (
          <div className="table-wrap">
            <table className="data-table content-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="选择本页内容"
                      checked={allPage}
                      onChange={() =>
                        setSelected(
                          allPage
                            ? selected.filter((id) => !currentPage.includes(id))
                            : [...new Set([...selected, ...currentPage])],
                        )
                      }
                    />
                  </th>
                  <th>内容名称</th>
                  <th>类型 / 版本</th>
                  <th>审批信息</th>
                  <th>有效期</th>
                  <th>处理状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const v = current(a);
                  return (
                    <tr
                      key={a.id}
                      className={selected.includes(a.id) ? "selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择${v.title}`}
                          checked={selected.includes(a.id)}
                          onChange={() => toggle(a.id)}
                        />
                      </td>
                      <td>
                        <div className="content-title-cell">
                          <span
                            className={`file-icon type-${v.kind === "PDF" ? "pdf" : v.kind === "PPT" ? "ppt" : "other"}`}
                          >
                            {v.kind === "网页"
                              ? "WEB"
                              : v.kind === "视频"
                                ? "MP4"
                                : v.kind === "Word"
                                  ? "DOC"
                                  : v.kind}
                          </span>
                          <div>
                            <button
                              className="title-link"
                              onClick={() => go("content/" + a.id)}
                            >
                              {v.title}
                            </button>
                            <small>
                              {a.code}
                              <span> · {v.source}</span>
                            </small>
                            <div className="mini-tags">
                              {v.tags
                                .filter((t) => !t.page)
                                .slice(0, 2)
                                .map((t, i) => (
                                  <span key={i}>
                                    {
                                      state.tags.find((s) => s.id === t.tagId)
                                        ?.name
                                    }
                                  </span>
                                ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span>{v.kind}</span>
                        <small className="cell-sub">V{a.current}.0</small>
                      </td>
                      <td>
                        {v.approval.mode === "registered" ? (
                          <button
                            className="credential-link"
                            onClick={() =>
                              go("credentials?open=" + v.approval.credentialId)
                            }
                          >
                            {v.approval.snapshot?.number}
                          </button>
                        ) : (
                          <Badge>{approvalLabel(v.approval)}</Badge>
                        )}
                      </td>
                      <td>
                        <Badge>{expiryStatus(v)}</Badge>
                      </td>
                      <td>
                        <button
                          className="status-button"
                          onClick={() =>
                            go(
                              v.process === "失败" || v.process === "部分失败"
                                ? "tasks"
                                : `content/${a.id}?tab=tags`,
                            )
                          }
                        >
                          <Badge>
                            {v.process !== "完成" ? v.process : v.tagStatus}
                          </Badge>
                        </button>
                      </td>
                      <td>
                        <span className="date-cell">
                          {dateLabel(a.updatedAt)}
                        </span>
                        <small className="cell-sub">
                          {state.users.find((u) => u.id === a.ownerId)?.name}
                        </small>
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          aria-label={`快速查看${v.title}`}
                          onClick={() => setQuick(a.id)}
                        >
                          <Eye size={17} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`查看${v.title}`}
                          onClick={() => go("content/" + a.id)}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="library-card-grid">
            {visible.map((a) => {
              const v = current(a);
              return (
                <article className="library-content-card" key={a.id}>
                  <div className="card-cover">
                    <AssetImage
                      src={v.cover || "/samples/cover-1.svg"}
                      alt="内容封面"
                    />
                    <input
                      type="checkbox"
                      aria-label={`选择${v.title}`}
                      checked={selected.includes(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span>{v.kind}</span>
                  </div>
                  <div className="card-content">
                    <button
                      className="title-link"
                      onClick={() => go("content/" + a.id)}
                    >
                      {v.title}
                    </button>
                    <p>
                      {a.code} · V{a.current}.0
                    </p>
                    <div className="card-status">
                      <Badge>{expiryStatus(v)}</Badge>
                      <Badge>{v.tagStatus}</Badge>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <Pagination total={rows.length} page={activePage} onChange={setPage} />
      </section>
      {advanced ? (
        <Dialog
          title="高级筛选"
          wide
          onClose={() => setAdvanced(false)}
          footer={
            <>
              <Button
                onClick={() => {
                  setFilters(defaults);
                  setPage(1);
                }}
              >
                清空条件
              </Button>
              <Button variant="primary" onClick={() => setAdvanced(false)}>
                查看 {rows.length} 条结果
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="内容来源">
              <select
                value={filters.source}
                onChange={(e) => change("source", e.target.value)}
              >
                <option value="">全部来源</option>
                {[...new Set(assets.map((a) => current(a).source))].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="上传人 / 维护人">
              <select
                value={filters.owner}
                onChange={(e) => change("owner", e.target.value)}
              >
                <option value="">全部人员</option>
                {state.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Note>不同标签维度取交集，同一维度的多个标签取并集。</Note>
          {groups.map((g) => (
            <div className="tag-filter-group" key={g}>
              <h4>{g}</h4>
              <div>
                {state.tags
                  .filter((t) => t.group === g && t.enabled)
                  .map((t) => (
                    <label key={t.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={filters.tags.includes(t.id)}
                        onChange={() =>
                          change(
                            "tags",
                            filters.tags.includes(t.id)
                              ? filters.tags.filter((id) => id !== t.id)
                              : [...filters.tags, t.id],
                          )
                        }
                      />
                      {t.name}
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </Dialog>
      ) : null}
      {action ? (
        <Dialog
          title={
            action === "tags"
              ? "批量修改标签"
              : action === "approval"
                ? "批量关联审批凭证"
                : action === "rerun"
                  ? "重新识别标签"
                  : "作废内容"
          }
          onClose={() => setAction("")}
          footer={
            <>
              <Button onClick={() => setAction("")}>取消</Button>
              <Button
                variant={action === "void" ? "danger" : "primary"}
                onClick={apply}
              >
                {action === "rerun" && !protect
                  ? "确认覆盖并重跑"
                  : `确认操作 ${chosen.length} 份内容`}
              </Button>
            </>
          }
        >
          <Note tone={action === "void" ? "amber" : "blue"}>
            本次操作影响已选 {chosen.length}{" "}
            份内容的当前版本，历史版本保持不变。
          </Note>
          {action === "tags" ? (
            <>
              <Field label="操作方式">
                <select
                  value={tagMode}
                  onChange={(e) => setTagMode(e.target.value)}
                >
                  {["追加", "移除", "替换维度"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="标准标签">
                <select
                  value={tagId}
                  onChange={(e) => setTagId(e.target.value)}
                >
                  <option value="">选择标签</option>
                  {state.tags
                    .filter((t) => t.enabled)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.group} / {t.name}
                      </option>
                    ))}
                </select>
              </Field>
              <small className="muted">
                {tagMode === "替换维度"
                  ? "将覆盖所选标签维度的材料级标签，其他维度及页面标签保留。"
                  : "仅影响指定标签，其他标签保留。"}
              </small>
            </>
          ) : action === "approval" ? (
            <Field label={`将凭证关联到已选 ${chosen.length} 份内容`}>
              <select
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
              >
                <option value="">选择已有审批凭证</option>
                {state.credentials
                  .filter(
                    (c) =>
                      can("admin") ||
                      c.createdBy === state.userId ||
                      assets.some((a) =>
                        a.versions.some(
                          (v) => v.approval.credentialId === c.id,
                        ),
                      ),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {credentialLatest(c).number} · 有效至{" "}
                      {credentialLatest(c).expiry}
                    </option>
                  ))}
              </select>
            </Field>
          ) : action === "rerun" ? (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={protect}
                  onChange={(e) => setProtect(e.target.checked)}
                />
                保留人工校正结果
              </label>
              <Note tone="amber">
                默认保护人工标签，冲突会进入待核对列表。取消勾选将覆盖所选内容的人工标签。
              </Note>
            </>
          ) : (
            <Field label="作废原因" required>
              <textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="说明为什么不再使用这些内容"
              />
            </Field>
          )}
        </Dialog>
      ) : null}
      {quickAsset ? (
        <Dialog
          title="内容快速查看"
          wide
          onClose={() => setQuick(undefined)}
          footer={
            <Button
              variant="primary"
              onClick={() => go("content/" + quickAsset.id)}
            >
              打开内容详情
            </Button>
          }
        >
          <AssetImage
            className="quick-cover"
            src={current(quickAsset).cover}
            alt="封面"
          />
          <h2>{current(quickAsset).title}</h2>
          <p className="muted">
            {quickAsset.code} · V{quickAsset.current}.0 ·{" "}
            {current(quickAsset).source}
          </p>
          <p>{current(quickAsset).summary}</p>
          <div className="actions">
            <Badge>{approvalLabel(current(quickAsset).approval)}</Badge>
            <Badge>{expiryStatus(current(quickAsset))}</Badge>
            <Badge>{current(quickAsset).process}</Badge>
          </div>
        </Dialog>
      ) : null}
      {exportOpen ? (
        <ExportDialog assets={chosen} onClose={() => setExportOpen(false)} />
      ) : null}
    </>
  );
}
