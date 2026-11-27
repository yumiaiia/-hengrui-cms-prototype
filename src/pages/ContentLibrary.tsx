import { bindingName } from "../tagResults";
import PendingUploads from "./PendingUploads";
import { fileParsingFailed, reparseFile } from "../fileProcessing";
import { PhaseTwoNote } from "../components/PhaseTwoNote";
import { TagFilter } from "../components/TagFilter";
import { lazy, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Download,
  FileText,
  Filter,
  Plus,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCMS } from "../store";
import {
  approvalLabel,
  current,
  dateLabel,
  expiryStatus,
  go,
  now,
  VISIBILITY_FIELD,
  audienceLabel,
  audienceShort,
} from "../model";
import { audiencesOf } from "../tagResults";
import { pendingRecommendationsForVersion } from "../taxonomy";
import { matchesTags, pageHits } from "../workflow";
import {
  Badge,
  Tabs,
  Button,
  Dialog,
  Empty,
  Field,
  PageHeader,
  Pagination,
  SearchBox,
} from "../components/ui";
import { ExportHistory } from "../components/ExportHistory";
import { ApprovalEditor } from "../components/ApprovalEditor";
import { TagPanel } from "../components/TagPanel";
import { ExportDialog } from "../export";
type Filters = {
  q: string;
  kind: string;
  source: string;
  expiry: string;
  approval: string;
  process: string;
  tagStatus: string;
  lifecycle: string;
  visibility: string;
  tags: string[];
  pageTags: string[];
};
const defaults: Filters = {
  q: "",
  kind: "",
  source: "",
  expiry: "",
  approval: "",
  process: "",
  tagStatus: "",
  lifecycle: "正常",
  visibility: "",
  tags: [],
  pageTags: [],
};
const Publishing = lazy(() => import("./Publishing"));
export default function ContentLibrary() {
  const { state, assets, can, update, toast } = useCMS();
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const cache = `cms-library-v4-${state.userId}`;
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const saved: Filters = {
        ...defaults,
        ...JSON.parse(sessionStorage.getItem(cache) || "{}"),
        ...(params.has("q") ? { q: params.get("q") || "" } : {}),
        ...(params.has("approval")
          ? { approval: params.get("approval") || "" }
          : {}),
        ...(params.has("tagStatus")
          ? { tagStatus: params.get("tagStatus") || "" }
          : {}),
        ...(params.has("process")
          ? { process: params.get("process") || "" }
          : {}),
        ...(params.has("expiry") ? { expiry: params.get("expiry") || "" } : {}),
      };
      if (saved.tagStatus === "失败") {
        saved.tagStatus = "";
        saved.process = "异常";
      }
      return saved;
    } catch {
      return defaults;
    }
  });
  const [libraryTab, setLibraryTab] = useState(
    params.get("tab") === "pending" ? "pending" : "archived",
  );
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [release, setRelease] = useState<{ ids?: string[]; open?: string }>();
  const [tagging, setTagging] = useState("");
  const [approval, setApproval] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportHistory, setExportHistory] = useState(params.has("exports"));
  const [action, setAction] = useState("");
  useEffect(() => {
    sessionStorage.setItem(cache, JSON.stringify(filters));
  }, [cache, filters]);
  useEffect(() => {
    sessionStorage.removeItem("cms-library-view");
  }, []);
  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelected([]);
  }
  const base = useMemo(
    () =>
      assets.filter((a) => {
        const v = current(a);
        const q = [
          v.title,
          a.code,
          v.approval.snapshot?.number,
          state.users.find((u) => u.id === a.ownerId)?.name,
          state.users.find((u) => u.id === a.ownerId)?.employeeId,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (!filters.lifecycle || a.lifecycle === filters.lifecycle) &&
          (!filters.kind || v.kind === filters.kind) &&
          (!filters.source || v.source === filters.source) &&
          (!filters.expiry || expiryStatus(v) === filters.expiry) &&
          (!filters.approval || v.approval.mode === filters.approval) &&
          (!filters.tagStatus || v.tagStatus === filters.tagStatus) &&
          (!filters.visibility ||
            (filters.visibility === "未设置"
              ? !audiencesOf(v, state.tags).length
              : audiencesOf(v, state.tags).includes(filters.visibility))) &&
          (!filters.process ||
            (filters.process === "异常"
              ? fileParsingFailed(v)
              : v.process === filters.process)) &&
          q.includes(filters.q.toLowerCase()) &&
          matchesTags(
            v.tags.filter((b) => !b.page),
            filters.tags,
            state.tags,
          )
        );
      }),
    [assets, filters, state.tags, state.users],
  );
  const hits = useMemo(
    () =>
      pageHits(
        base,
        state.tags,
        filters.tags,
        filters.pageTags,
        "",
        Object.fromEntries(
          state.users.map((u) => [u.id, `${u.name} ${u.employeeId || ""}`]),
        ),
      ),
    [base, state.tags, state.users, filters],
  );
  const rows = filters.pageTags.length
    ? base.filter((a) => hits.some((h) => h.asset.id === a.id))
    : base;
  const total = rows.length;
  const size = 8;
  const active = Math.min(page, Math.max(1, Math.ceil(total / size)));
  const displayed = rows.slice((active - 1) * size, active * size);
  const chosen = assets.filter((a) => selected.includes(a.id));
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
    );
  const picked = assets.find((a) => a.id === tagging);
  const clauses = Object.entries(filters).filter(
    ([key, value]) =>
      key !== "lifecycle" && (Array.isArray(value) ? value.length : !!value),
  );
  function run() {
    if (action === "void") {
      const voidable = chosen.filter((a) => a.lifecycle === "正常");
      if (!voidable.length) return toast("所选内容均已作废。");
      update(
        (s) => {
          s.assets
            .filter((a) => voidable.some((v) => v.id === a.id))
            .forEach((a) => {
              a.lifecycle = "已作废";
              a.updatedAt = now();
            });
        },
        {
          action: "批量作废内容",
          object: `${voidable.length} 份内容`,
        },
        "void",
      );
    }
    setAction("");
    setSelected([]);
  }
  const label = (key: string, value: string) =>
    key === "approval"
      ? { pending: "待补充", registered: "已登记", exempt: "无需登记" }[
          value
        ] || value
      : key === "visibility"
        ? `可见范围 ${value}`
        : value;
  function retryFile(assetId: string, version: number) {
    try {
      const asset = assets.find((a) => a.id === assetId);
      if (
        update(
          (draft) => reparseFile(draft, assetId, version),
          {
            action: "重试解析任务",
            object: asset?.code || "内容文件",
            module: "内容库",
          },
          "edit",
        )
      )
        toast("正在重新解析整份文件。");
    } catch (e) {
      toast(e instanceof Error ? e.message : "重新解析失败");
    }
  }
  return (
    <div className="library-v3">
      <PageHeader
        title="内容库"
        action={
          <Button
            variant="primary"
            icon={<Plus size={17} />}
            disabled={!can("upload")}
            onClick={() => go("upload")}
          >
            上传内容
          </Button>
        }
      />
      <Tabs
        value={libraryTab}
        onChange={setLibraryTab}
        items={[
          { key: "archived", label: "已归档" },
          { key: "pending", label: "待归档" },
        ]}
      />
      {libraryTab === "pending" ? (
        <PendingUploads />
      ) : (
        <>
          <section className="panel content-browser">
            <div className="library-view-tabs">
              <strong>文件列表</strong>
              <div className="actions">
                <span>{rows.length} 份内容</span>
                {can("export") ? (
                  <Button onClick={() => setExportHistory(true)}>
                    导出记录
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="browser-search-row">
              <SearchBox
                value={filters.q}
                onChange={(q) => change("q", q)}
                placeholder="搜索标题、内容编号、审批编号或维护人"
              />
              <select
                aria-label="内容类型"
                value={filters.kind}
                onChange={(e) => change("kind", e.target.value)}
              >
                <option value="">全部类型</option>
                {["PDF", "PPT", "Word", "图片", "视频", "网页"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <select
                aria-label="有效状态"
                value={filters.expiry}
                onChange={(e) => change("expiry", e.target.value)}
              >
                <option value="">全部有效状态</option>
                {["生效中", "即将过期", "已过期", "未设置"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <Button
                variant={more ? "primary" : "secondary"}
                icon={<Filter size={15} />}
                onClick={() => setMore(!more)}
              >
                更多筛选
              </Button>
            </div>
            <div className="browser-tag-filters">
              <TagFilter
                scope="材料标签"
                selected={filters.tags}
                onChange={(ids) => change("tags", ids)}
              />
              <TagFilter
                scope="页级标签"
                selected={filters.pageTags}
                onChange={(ids) => change("pageTags", ids)}
              />
            </div>
            {more ? (
              <div className="inline-filter-panel">
                <Field label="来源">
                  <select
                    value={filters.source}
                    onChange={(e) => change("source", e.target.value)}
                  >
                    <option value="">全部来源</option>
                    {[...new Set(assets.map((a) => current(a).source))].map(
                      (v) => (
                        <option key={v} value={v}>
                          {v === "未匹配" ? "有推荐标签" : v}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="审批登记">
                  <select
                    value={filters.approval}
                    onChange={(e) => change("approval", e.target.value)}
                  >
                    <option value="">全部</option>
                    <option value="registered">已登记</option>
                    <option value="exempt">无需登记</option>
                    <option value="pending">待补充</option>
                  </select>
                </Field>
                <Field label="标签识别">
                  <select
                    value={filters.tagStatus}
                    onChange={(e) => change("tagStatus", e.target.value)}
                  >
                    <option value="">全部</option>
                    {["待打标", "打标中", "已完成", "未匹配"].map((v) => (
                      <option key={v} value={v}>
                        {v === "未匹配" ? "有推荐标签" : v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="文件解析">
                  <select
                    value={filters.process}
                    onChange={(e) => change("process", e.target.value)}
                  >
                    <option value="">全部</option>
                    {["排队中", "处理中", "完成", "失败"].map((v) => (
                      <option key={v} value={v}>
                        {v === "未匹配" ? "有推荐标签" : v}
                      </option>
                    ))}
                    <option value="异常">需要处理</option>
                  </select>
                </Field>
                <Field label="内容状态">
                  <select
                    value={filters.lifecycle}
                    onChange={(e) => change("lifecycle", e.target.value)}
                  >
                    <option>正常</option>
                    <option>已作废</option>
                    <option value="">全部</option>
                  </select>
                </Field>
                <Field label="用户可见范围">
                  <select
                    value={filters.visibility}
                    onChange={(e) => change("visibility", e.target.value)}
                  >
                    <option value="">全部</option>
                    {state.tags
                      .filter(
                        (t) => t.parentId === VISIBILITY_FIELD && t.enabled,
                      )
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    <option value="未设置">未设置</option>
                  </select>
                </Field>
              </div>
            ) : null}
            {clauses.length || filters.lifecycle !== "正常" ? (
              <div className="applied-filters">
                {clauses.flatMap(([key, value]) =>
                  Array.isArray(value) ? (
                    value.map((id) => (
                      <button
                        key={key + id}
                        onClick={() =>
                          change(
                            key as "tags" | "pageTags",
                            (value as string[]).filter((v) => v !== id),
                          )
                        }
                      >
                        {key === "tags" ? "材料" : "页面"} ·{" "}
                        {state.tags.find((t) => t.id === id)?.name}
                        <X size={12} />
                      </button>
                    ))
                  ) : (
                    <button
                      key={key}
                      onClick={() => change(key as keyof Filters, "")}
                    >
                      {label(key, String(value))}
                      <X size={12} />
                    </button>
                  ),
                )}
                {filters.lifecycle !== "正常" ? (
                  <button onClick={() => change("lifecycle", "正常")}>
                    {filters.lifecycle || "全部内容状态"}
                    <X size={12} />
                  </button>
                ) : null}
                <button
                  className="clear-filters"
                  onClick={() => {
                    setFilters(defaults);
                    setPage(1);
                  }}
                >
                  清空条件
                </button>
              </div>
            ) : null}
            {chosen.length ? (
              <div className="batch-bar">
                <strong>已选 {chosen.length} 份</strong>
                <button onClick={() => setSelected(rows.map((a) => a.id))}>
                  选择全部 {rows.length} 份结果
                </button>
                <div />
                <Button
                  disabled={!can("publish")}
                  icon={<Send size={15} />}
                  onClick={() => setRelease({ ids: selected })}
                >
                  批量发布
                  <PhaseTwoNote />
                </Button>
                <Button
                  disabled={!can("edit")}
                  icon={<ShieldCheck size={15} />}
                  onClick={() => setApproval(true)}
                >
                  审批信息
                </Button>

                <Button
                  disabled={!can("export")}
                  icon={<Download size={15} />}
                  onClick={() => setExporting(true)}
                >
                  导出
                </Button>
                <Button
                  disabled={!can("void")}
                  onClick={() => setAction("void")}
                >
                  作废
                </Button>
                <button aria-label="取消选择" onClick={() => setSelected([])}>
                  <X size={16} />
                </button>
              </div>
            ) : null}
            {!total ? (
              <Empty
                title="没有匹配的内容"
                description="试试减少筛选条件，或更换关键词。"
                action={
                  <Button onClick={() => setFilters(defaults)}>清空条件</Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table library-file-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          aria-label="选择本页内容"
                          type="checkbox"
                          checked={
                            !!displayed.length &&
                            displayed.every((a) => selected.includes(a.id))
                          }
                          onChange={() =>
                            setSelected(
                              displayed.every((a) => selected.includes(a.id))
                                ? selected.filter(
                                    (id) => !displayed.some((a) => a.id === id),
                                  )
                                : [
                                    ...new Set([
                                      ...selected,
                                      ...displayed.map((a) => a.id),
                                    ]),
                                  ],
                            )
                          }
                        />
                      </th>
                      <th>文件</th>
                      <th>材料标签</th>
                      <th>审批信息</th>
                      <th>有效状态</th>
                      <th>
                        发布
                        <PhaseTwoNote />
                      </th>
                      <th>最近更新</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((a) => {
                      const v = current(a);
                      const p = state.publications
                        ?.filter((p) => p.assetId === a.id)
                        .sort((a, b) =>
                          b.updatedAt.localeCompare(a.updatedAt),
                        )[0];
                      return (
                        <tr
                          key={a.id}
                          className={selected.includes(a.id) ? "selected" : ""}
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`选择${a.code}`}
                              checked={selected.includes(a.id)}
                              onChange={() => toggle(a.id)}
                            />
                          </td>
                          <td>
                            <div className="file-cell">
                              <span
                                className={`file-icon type-${v.kind === "PDF" ? "pdf" : "other"}`}
                              >
                                <FileText size={19} />
                                <small>{v.kind}</small>
                              </span>
                              <div>
                                <button
                                  className="title-link"
                                  onClick={() => go(`content/${a.id}`)}
                                >
                                  {v.title}
                                </button>
                                <small className="row-secondary">
                                  {a.code} · V{v.number}.0 · {v.source}
                                </small>
                                {fileParsingFailed(v) ? (
                                  <div className="file-processing-actions">
                                    <Badge>解析失败</Badge>
                                    <Button
                                      variant="ghost"
                                      disabled={
                                        !can("edit") ||
                                        a.lifecycle !== "正常" ||
                                        ["处理中", "排队中"].includes(v.process)
                                      }
                                      onClick={() => retryFile(a.id, v.number)}
                                      aria-label={a.code + "重新解析整份文件"}
                                    >
                                      重新解析
                                    </Button>
                                  </div>
                                ) : v.process !== "完成" ? (
                                  <Badge>解析中</Badge>
                                ) : v.tagStatus !== "已完成" &&
                                  v.tagStatus !== "未匹配" ? (
                                  <span className="row-secondary">
                                    {v.tagStatus}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="table-tags">
                              {v.tags
                                .filter((b) => !b.page)
                                .slice(0, 2)
                                .map((b) => (
                                  <button
                                    className="tag-chip"
                                    key={b.tagId}
                                    onClick={() =>
                                      change(
                                        "tags",
                                        filters.tags.includes(b.tagId)
                                          ? filters.tags.filter(
                                              (id) => id !== b.tagId,
                                            )
                                          : [...filters.tags, b.tagId],
                                      )
                                    }
                                  >
                                    {
                                      state.tags.find((t) => t.id === b.tagId)
                                        ?.name
                                    }
                                  </button>
                                ))}
                              <button
                                className="edit-tags-small"
                                aria-label={`编辑${a.code}标签`}
                                onClick={() => setTagging(a.id)}
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                            <small className="row-secondary">
                              可见范围：
                              {audienceShort(
                                audiencesOf(v, state.tags),
                                state.tags.filter(
                                  (t) =>
                                    t.parentId === VISIBILITY_FIELD && t.enabled,
                                ).length,
                              )}
                              {v.fieldsManual?.includes(VISIBILITY_FIELD)
                                ? "（人工）"
                                : ""}
                            </small>
                            {pendingRecommendationsForVersion(state, a)
                              .length ? (
                              <button
                                className="text-link"
                                onClick={() => setTagging(a.id)}
                              >
                                {
                                  pendingRecommendationsForVersion(state, a)
                                    .length
                                }{" "}
                                项推荐标签
                              </button>
                            ) : null}
                          </td>
                          <td>
                            <span>{approvalLabel(v.approval)}</span>
                            {v.approval.snapshot ? (
                              <small className="row-secondary approval-number">
                                {v.approval.snapshot.number}
                              </small>
                            ) : null}
                          </td>
                          <td>
                            <Badge>{expiryStatus(v)}</Badge>
                          </td>
                          <td>
                            {p ? (
                              <button
                                className="text-link"
                                onClick={() => setRelease({ open: p.id })}
                              >
                                {p.status}
                                {p.version !== v.number ? (
                                  <small className="row-secondary">
                                    V{p.version}.0 的记录
                                  </small>
                                ) : null}
                              </button>
                            ) : (
                              <Button
                                variant="ghost"
                                disabled={!can("publish")}
                                onClick={() => setRelease({ ids: [a.id] })}
                              >
                                提交发布
                                <PhaseTwoNote />
                              </Button>
                            )}
                          </td>
                          <td>
                            <small>{dateLabel(a.updatedAt)}</small>
                          </td>
                          <td>
                            <button
                              aria-label={`查看${v.title}`}
                              className="icon-btn"
                              onClick={() => go(`content/${a.id}`)}
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
            )}
            <Pagination
              total={total}
              size={size}
              page={active}
              onChange={setPage}
            />
          </section>
          {exportHistory ? (
            <ExportHistory onClose={() => setExportHistory(false)} />
          ) : null}
          {picked ? (
            <Dialog drawer title="内容标签" onClose={() => setTagging("")}>
              <h3>{current(picked).title}</h3>
              <TagPanel assetId={picked.id} allSuggestions />
            </Dialog>
          ) : null}
          {approval ? (
            <ApprovalEditor
              assetIds={selected}
              onClose={() => setApproval(false)}
            />
          ) : null}
          {release ? (
            <Publishing
              embedded
              initialAssetIds={release.ids}
              initialOpen={release.open}
              onClose={() => setRelease(undefined)}
            />
          ) : null}
          {exporting ? (
            <ExportDialog assets={chosen} onClose={() => setExporting(false)} />
          ) : null}
          {action ? (
            <Dialog
              title="作废所选内容"
              onClose={() => setAction("")}
              footer={
                <>
                  <Button onClick={() => setAction("")}>取消</Button>
                  <Button variant="danger" onClick={run}>
                    确认作废
                  </Button>
                </>
              }
            >
              <p className="dialog-intro">
                将作废所选的 {chosen.filter((a) => a.lifecycle === "正常").length}{" "}
                份内容（已作废项自动跳过），作废后不可恢复。
              </p>
            </Dialog>
          ) : null}
        </>
      )}
    </div>
  );
}
