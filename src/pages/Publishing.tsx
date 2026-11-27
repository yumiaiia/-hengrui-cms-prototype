import {
  normalizePublicationStatus,
  publicationStatuses,
} from "../simplification";
import { originClass } from "../tagResults";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Plus,
  Send,
  Smartphone,
  X,
  ChevronRight,
} from "lucide-react";
import { useCMS } from "../store";
import { current, dateLabel, go, now, type Publication } from "../model";
import { matchesTags, publicationProblems } from "../workflow";
import {
  releaseInput,
  saveReleaseBatch,
  publicationVersionNotice,
  type ReleaseInput,
} from "../publication";
import {
  AssetImage,
  Badge,
  Button,
  CoverPicker,
  Dialog,
  Empty,
  Field,
  PageHeader,
  SearchBox,
} from "../components/ui";
import { TagFilter } from "../components/TagFilter";
import { ApprovalEditor } from "../components/ApprovalEditor";
export function localTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replace(" ", "T");
}
interface Props {
  embedded?: boolean;
  initialAssetIds?: string[];
  initialOpen?: string;
  assetFilter?: string;
  onClose?: () => void;
}
export default function Publishing({
  embedded = false,
  initialAssetIds,
  initialOpen,
  assetFilter,
  onClose,
}: Props = {}) {
  const { state, assets, can, update, toast } = useCMS();
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const startingIds =
    initialAssetIds ||
    (!embedded && params.get("asset") && params.has("create")
      ? [params.get("asset")!]
      : []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(
    !embedded && params.get("status")
      ? normalizePublicationStatus(params.get("status")!)
      : "",
  );
  const [selected, setSelected] = useState(
    initialOpen || (!embedded ? params.get("open") || "" : ""),
  );
  const [editing, setEditing] = useState(
    !!initialAssetIds || (!embedded && params.has("create")),
  );
  const [step, setStep] = useState(startingIds.length ? 2 : 1);
  const [inputs, setInputs] = useState<ReleaseInput[]>(() =>
    startingIds.flatMap((id) => {
      const a = assets.find((a) => a.id === id);
      return a ? [releaseInput(a)] : [];
    }),
  );
  const [activeId, setActiveId] = useState(startingIds[0] || "");
  const [editId, setEditId] = useState("");
  const [replacesId, setReplacesId] = useState("");
  const [planned, setPlanned] = useState("");
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerKind, setPickerKind] = useState("");
  const [pickerSource, setPickerSource] = useState("");
  const [pickerTags, setPickerTags] = useState<string[]>([]);
  const [pickerPageTags, setPickerPageTags] = useState<string[]>([]);
  const [onlyReady, setOnlyReady] = useState(false);
  const [approvalId, setApprovalId] = useState("");
  const filterAsset = assetFilter || (!embedded ? params.get("asset") : "");
  const publications = (state.publications || []).filter(
    (p) =>
      assets.some((a) => a.id === p.assetId) &&
      (!filterAsset || p.assetId === filterAsset),
  );
  const detail =
    publications.find((p) => p.id === selected) ||
    (state.publications || []).find(
      (p) => p.id === selected && assets.some((a) => a.id === p.assetId),
    );
  const detailAsset = assets.find((a) => a.id === detail?.assetId);
  const active = inputs.find((i) => i.assetId === activeId) || inputs[0];
  const eligible = assets.filter((a) => {
    const v = current(a);
    return (
      a.lifecycle === "正常" &&
      (!editId || inputs.some((i) => i.assetId === a.id)) &&
      (!pickerKind || v.kind === pickerKind) &&
      (!pickerSource || v.source === pickerSource) &&
      (!onlyReady || !publicationProblems(a, v).length) &&
      [v.title, a.code, state.users.find((u) => u.id === a.ownerId)?.name]
        .join(" ")
        .toLowerCase()
        .includes(pickerQuery.trim().toLowerCase()) &&
      matchesTags(
        v.tags.filter((b) => !b.page),
        pickerTags,
        state.tags,
      ) &&
      (!pickerPageTags.length ||
        Array.from({ length: v.pages }, (_, i) => i + 1).some((page) =>
          matchesTags(
            v.tags.filter((b) => b.page === page),
            pickerPageTags,
            state.tags,
          ),
        ))
    );
  });
  const rows = publications.filter(
    (p) =>
      (!status || p.status === status) &&
      [
        p.title,
        assets.find((a) => a.id === p.assetId)?.code,
        state.users.find((u) => u.id === p.submittedBy)?.name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const counts = ["全部", ...publicationStatuses];
  function closeEditor() {
    setEditing(false);
    if (embedded && !selected) onClose?.();
  }
  function start(record?: Publication) {
    const a = record ? assets.find((a) => a.id === record.assetId) : undefined;
    const draft = record?.status === "草稿";
    setEditId(draft ? record!.id : "");
    setReplacesId(record && !draft ? record.id : "");
    setInputs(
      record && a
        ? [
            {
              ...releaseInput(a),
              ...(draft
                ? {
                    version: record.version,
                    title: record.title,
                    summary: record.summary,
                    cover: record.cover || "",
                    thumbnail: record.thumbnail || record.cover || "",
                  }
                : {}),
            },
          ]
        : [],
    );
    setActiveId(a?.id || "");
    setStep(a ? 2 : 1);
    setPlanned(draft && record?.plannedAt ? localTime(record.plannedAt) : "");
    setError("");
    setEditing(true);
    setPickerQuery("");
    setPickerTags([]);
    setPickerPageTags([]);
    setPickerKind("");
    setPickerSource("");
  }
  function toggle(id: string) {
    if (editId) return;
    const a = assets.find((a) => a.id === id);
    if (!a) return;
    setInputs((old) =>
      old.some((i) => i.assetId === id)
        ? old.filter((i) => i.assetId !== id)
        : [...old, releaseInput(a)],
    );
    setError("");
  }
  function patch(changes: Partial<ReleaseInput>) {
    if (active)
      setInputs((old) =>
        old.map((i) =>
          i.assetId === active.assetId ? { ...i, ...changes } : i,
        ),
      );
    setError("");
  }
  function save(submit: boolean) {
    try {
      let ids: string[] = [];
      const date = planned ? new Date(`${planned}:00+08:00`).toISOString() : "";
      const ok = update(
        (s) => {
          ids = saveReleaseBatch(
            s,
            inputs,
            date,
            submit,
            editId || undefined,
            replacesId || undefined,
          );
        },
        {
          action: submit ? "提交发布" : "保存发布草稿",
          object: `${inputs.length} 份内容`,
          module: "发布管理",
        },
        "publish",
      );
      if (!ok) return;
      setEditing(false);
      setSelected(ids[0]);
      toast(
        submit
          ? `已提交 ${ids.length} 份内容，各自生成发布记录。`
          : `已保存 ${ids.length} 条发布草稿。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
    }
  }
  function feedback(result: "preview" | "published" | "failed") {
    if (!detail || !can("publish") || detail.status === "已发布") return;
    const ok = update((s) => {
      const p = s.publications!.find((p) => p.id === detail.id)!;
      p.updatedAt = now();
      p.error = undefined;
      if (result === "failed") {
        p.status = "发布失败";
        p.error = "发布平台反馈：封面资源获取失败，请核对后重新提交。";
      } else {
        p.status = result === "published" ? "已发布" : "待发布";
        p.previews = ["微网站", "企微端", "微信端"].map((port, i) => ({
          id: `${p.id}-${p.revision}-${i}`,
          platform: "瑞医空间",
          port,
          url: `${location.origin}/#/publication-preview/${p.id}?port=${encodeURIComponent(port)}&revision=${p.revision}`,
          version: p.version,
          revision: p.revision,
          generatedAt: now(),
          status: p.status,
          actualAt: result === "published" ? now() : undefined,
        }));
      }
    });
    if (ok) toast("已更新本次演示的发布反馈。");
  }
  const list = (
    <section className="panel">
      <div className="publish-list-head">
        <div className="status-tabs">
          {counts.map((s) => (
            <button
              key={s}
              className={
                status === s || (!status && s === "全部") ? "active" : ""
              }
              onClick={() => setStatus(s === "全部" ? "" : s)}
            >
              {s}
              <span>
                {s === "全部"
                  ? publications.length
                  : publications.filter((p) => p.status === s).length}
              </span>
            </button>
          ))}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索发布标题、内容编号或发布人"
        />
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>发布内容（二期功能）</th>
                <th>发布状态（二期功能）</th>
                <th>拟发布时间（二期功能）</th>
                <th>发布预览（二期功能）</th>
                <th>最近反馈</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const a = assets.find((a) => a.id === p.assetId)!;
                return (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="title-link"
                        onClick={() => setSelected(p.id)}
                      >
                        {p.title}
                      </button>
                      <small className="row-secondary">
                        {a.code} · V{p.version}.0
                        {p.version !== a.current ? (
                          <span className="version-notice-small">
                            已有 V{a.current}.0
                          </span>
                        ) : null}
                      </small>
                    </td>
                    <td>
                      <Badge>{p.status}</Badge>
                    </td>
                    <td>{p.plannedAt ? dateLabel(p.plannedAt) : "尚未设置"}</td>
                    <td>
                      {p.previews.length ? (
                        <button
                          className="text-link"
                          onClick={() => setSelected(p.id)}
                        >
                          查看发布预览 <ArrowUpRight size={14} />
                        </button>
                      ) : p.status === "草稿" ? (
                        "尚未提交"
                      ) : (
                        "等待回传"
                      )}
                    </td>
                    <td>{dateLabel(p.updatedAt)}</td>
                    <td>
                      <Button variant="ghost" onClick={() => setSelected(p.id)}>
                        查看详情
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
          title="暂无发布记录"
          description="选择内容，填写排期后提交发布。"
          action={<Button onClick={() => start()}>新建发布</Button>}
        />
      )}
    </section>
  );
  return (
    <>
      {!embedded ? (
        <div className="publishing-page">
          <PageHeader
            title="发布管理（二期功能）"
            action={
              <Button
                variant="primary"
                icon={<Plus size={17} />}
                disabled={!can("publish")}
                onClick={() => start()}
              >
                新建发布（二期功能）
              </Button>
            }
          />
          {list}
        </div>
      ) : !detail && !editing ? (
        <Dialog wide title="发布记录（二期功能）" onClose={() => onClose?.()}>
          {list}
        </Dialog>
      ) : null}
      {detail && !editing ? (
        <Dialog
          drawer
          title="发布详情（二期功能）"
          onClose={() => {
            setSelected("");
            if (embedded && !assetFilter) onClose?.();
          }}
          footer={
            <>
              <Button
                onClick={() =>
                  go(`content/${detail.assetId}?version=${detail.version}`)
                }
              >
                查看内容版本
              </Button>
              {can("publish") ? (
                <Button variant="primary" onClick={() => start(detail)}>
                  {detail.status === "草稿"
                    ? "继续填写"
                    : detailAsset?.current !== detail.version
                      ? "使用最新版本新建发布"
                      : "复制并新建发布"}
                </Button>
              ) : null}
            </>
          }
        >
          <div className="publication-detail-heading">
            <Badge>{detail.status}</Badge>
            <h2>{detail.title}</h2>
            <p>
              {detailAsset?.code} · V{detail.version}.0
            </p>
          </div>
          {detailAsset &&
          publicationVersionNotice(detail, detailAsset.current) ? (
            <div className="inline-warning">
              {publicationVersionNotice(detail, detailAsset.current)}
            </div>
          ) : null}
          {detail.replacesId ? (
            <p className="muted">
              由历史记录新建 ·{" "}
              <button
                className="text-link"
                onClick={() => setSelected(detail.replacesId!)}
              >
                查看原发布记录
              </button>
            </p>
          ) : null}
          <div className="release-schedule">
            <CalendarClock size={24} />
            <div>
              <small>拟发布时间 · 北京时间（二期功能）</small>
              <strong>
                {detail.plannedAt
                  ? new Date(detail.plannedAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour12: false,
                    })
                  : "尚未设置"}
              </strong>
            </div>
          </div>
          {detail.error ? (
            <div className="inline-warning">{detail.error}</div>
          ) : null}
          <div className="section-heading">
            <h3>发布预览（二期功能）</h3>
          </div>
          {detail.previews.length ? (
            detail.previews.map((p) => (
              <article className="preview-link-card" key={p.id}>
                <div className="section-heading">
                  <strong>
                    <Smartphone size={16} />
                    {p.platform} · {p.port}
                  </strong>
                  <Badge>{p.status}</Badge>
                </div>
                <small>
                  内容 V{p.version}.0 · {dateLabel(p.generatedAt)} 生成
                </small>
                <div className="preview-link-actions">
                  <a
                    className="btn btn-secondary"
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看发布预览 <ExternalLink size={14} />
                  </a>
                  <Button
                    icon={<Copy size={14} />}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(p.url)
                        .then(() => toast("预览链接已复制"))
                        .catch(() => toast("复制失败，请手动复制链接。"));
                    }}
                  >
                    复制链接
                  </Button>
                  <Button onClick={() => setQr(p.url)}>二维码</Button>
                </div>
                <a
                  className="preview-url"
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.url}
                </a>
                {p.actualAt ? (
                  <small>实际发布时间：{dateLabel(p.actualAt)}</small>
                ) : null}
              </article>
            ))
          ) : (
            <div className="preview-awaiting">
              <ImageIcon size={28} />
              <strong>
                {detail.status === "草稿"
                  ? "提交后生成发布预览"
                  : "等待发布平台返回预览"}
              </strong>
              <p>收到反馈后，可在这里查看预览与发布结果。</p>
            </div>
          )}
          <dl className="detail-meta">
            <dt>提交时间</dt>
            <dd>
              {detail.submittedAt ? dateLabel(detail.submittedAt) : "尚未提交"}
            </dd>
            <dt>发布人（二期功能）</dt>
            <dd>
              {state.users.find((u) => u.id === detail.submittedBy)?.name ||
                "—"}
            </dd>
            <dt>最近反馈</dt>
            <dd>{dateLabel(detail.updatedAt)}</dd>
            <dt>摘要</dt>
            <dd>{detail.summary || "未填写"}</dd>
          </dl>
          {can("publish") &&
          detail.status !== "草稿" &&
          detail.status !== "已发布" ? (
            <details className="prototype-controls">
              <summary>演示发布反馈</summary>
              <p>原型演示，不会向外部平台发送内容。</p>
              <div className="actions">
                <Button onClick={() => feedback("preview")}>
                  返回发布预览
                </Button>
                <Button onClick={() => feedback("published")}>
                  返回已发布
                </Button>
                <Button onClick={() => feedback("failed")}>返回失败</Button>
              </div>
            </details>
          ) : null}
        </Dialog>
      ) : null}
      {editing ? (
        <Dialog
          wide
          title={editId ? "编辑发布草稿（二期功能）" : "新建发布（二期功能）"}
          onClose={closeEditor}
          footer={
            <>
              <span className="composer-footer-count">
                已选择 {inputs.length} 份内容
              </span>
              <Button onClick={closeEditor}>取消</Button>
              {step === 1 ? (
                <Button
                  variant="primary"
                  disabled={!inputs.length}
                  onClick={() => {
                    setStep(2);
                    setActiveId(inputs[0]?.assetId || "");
                    setError("");
                  }}
                >
                  下一步：核对发布信息 <ChevronRight size={15} />
                </Button>
              ) : (
                <>
                  <Button onClick={() => setStep(1)}>返回选择</Button>
                  <Button
                    disabled={!can("publish")}
                    onClick={() => save(false)}
                  >
                    保存草稿
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!can("publish") || !inputs.length}
                    icon={<Send size={15} />}
                    onClick={() => save(true)}
                  >
                    提交发布{inputs.length > 1 ? `（${inputs.length} 份）` : ""}
                  </Button>
                </>
              )}
            </>
          }
        >
          <div className="composer-steps">
            <button
              className={step === 1 ? "active" : ""}
              onClick={() => setStep(1)}
            >
              <b>1</b>选择内容
            </button>
            <ChevronRight size={15} />
            <button
              className={step === 2 ? "active" : ""}
              disabled={!inputs.length}
              onClick={() => setStep(2)}
            >
              <b>2</b>核对信息与排期
            </button>
          </div>
          {replacesId ? (
            <div className="inline-info">
              本次将新建发布记录；原记录的版本、预览和发布状态会保留。
            </div>
          ) : null}
          {step === 1 ? (
            <>
              <div className="release-picker-filters">
                <SearchBox
                  value={pickerQuery}
                  onChange={setPickerQuery}
                  placeholder="搜索标题、内容编号或维护人"
                />
                <select
                  aria-label="发布内容类型"
                  value={pickerKind}
                  onChange={(e) => setPickerKind(e.target.value)}
                >
                  <option value="">全部类型</option>
                  {["PDF", "PPT", "Word", "图片", "视频", "网页"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <select
                  aria-label="发布内容来源"
                  value={pickerSource}
                  onChange={(e) => setPickerSource(e.target.value)}
                >
                  <option value="">全部来源</option>
                  {[...new Set(assets.map((a) => current(a).source))].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </div>
              <div className="release-picker-tags">
                <TagFilter
                  scope="材料标签"
                  selected={pickerTags}
                  onChange={setPickerTags}
                />
                <TagFilter
                  scope="页级标签"
                  selected={pickerPageTags}
                  onChange={setPickerPageTags}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={onlyReady}
                    onChange={(e) => setOnlyReady(e.target.checked)}
                  />
                  仅看可发布内容
                </label>
              </div>
              {pickerTags.length || pickerPageTags.length ? (
                <div className="applied-filters">
                  {[...pickerTags, ...pickerPageTags].map((id) => (
                    <button
                      key={id}
                      onClick={() => {
                        setPickerTags((old) => old.filter((t) => t !== id));
                        setPickerPageTags((old) => old.filter((t) => t !== id));
                      }}
                    >
                      {state.tags.find((t) => t.id === id)?.name}
                      <X size={12} />
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setPickerTags([]);
                      setPickerPageTags([]);
                    }}
                  >
                    清空标签
                  </button>
                </div>
              ) : null}
              <div className="release-picker-layout">
                <div>
                  <div className="release-picker-tools">
                    <span>{eligible.length} 份匹配内容</span>
                    <button
                      className="text-link"
                      disabled={!!editId}
                      onClick={() =>
                        setInputs((old) => [
                          ...old,
                          ...eligible
                            .filter(
                              (a) =>
                                !old.some((i) => i.assetId === a.id) &&
                                !publicationProblems(a, current(a)).length,
                            )
                            .map(releaseInput),
                        ])
                      }
                    >
                      选择全部可发布结果
                    </button>
                  </div>
                  <div className="release-picker-results">
                    {eligible.length ? (
                      eligible.map((a) => {
                        const v = current(a);
                        const problems = publicationProblems(a, v);
                        const checked = inputs.some((i) => i.assetId === a.id);
                        return (
                          <article
                            className={`release-picker-card ${checked ? "selected" : ""}`}
                            key={a.id}
                          >
                            <label className="release-pick-main">
                              <input
                                type="checkbox"
                                aria-label={`选择发布内容${a.code}`}
                                checked={checked}
                                disabled={!!editId || !!problems.length}
                                onChange={() => toggle(a.id)}
                              />
                              <AssetImage
                                src={
                                  v.thumbnail ||
                                  v.cover ||
                                  "/samples/cover-1.svg"
                                }
                                alt={`${v.title}缩略图`}
                              />
                              <span>
                                <strong>{v.title}</strong>
                                <small>
                                  {a.code} · {v.kind} · V{v.number}.0 ·{" "}
                                  {v.source}
                                </small>
                                <span className="tag-chips">
                                  {v.tags
                                    .filter((b) => !b.page)
                                    .slice(0, 3)
                                    .map((b) => (
                                      <span
                                        className={`tag-chip ${originClass(b.origin)}`}
                                        key={b.tagId}
                                      >
                                        {
                                          state.tags.find(
                                            (t) => t.id === b.tagId,
                                          )?.name
                                        }
                                      </span>
                                    ))}
                                </span>
                              </span>
                            </label>
                            <div className="release-pick-actions">
                              <a
                                className="text-link"
                                href={`#/content/${a.id}?version=${v.number}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                查看内容 <ExternalLink size={12} />
                              </a>
                              {problems.length ? (
                                <>
                                  <small className="release-block-reason">
                                    {problems.join("；")}
                                  </small>
                                  {v.approval.mode === "pending" ? (
                                    <button
                                      className="text-link"
                                      disabled={!can("edit")}
                                      onClick={() => setApprovalId(a.id)}
                                    >
                                      补充审批信息
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <small className="release-ready">可发布</small>
                              )}
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <Empty
                        title="没有匹配的内容"
                        description="调整标签、类型或搜索条件。"
                      />
                    )}
                  </div>
                </div>
                <aside className="release-selected">
                  <h3>
                    已选内容 <Badge>{inputs.length}</Badge>
                  </h3>
                  <p className="muted">更换筛选条件会保留已选内容。</p>
                  {inputs.map((i) => (
                    <div className="release-selected-item" key={i.assetId}>
                      <AssetImage
                        src={i.thumbnail || i.cover || "/samples/cover-1.svg"}
                        alt="已选缩略图"
                      />
                      <span>
                        {i.title}
                        <small>V{i.version}.0</small>
                      </span>
                      <button
                        className="icon-btn"
                        disabled={!!editId}
                        aria-label={`移除${i.title}`}
                        onClick={() => toggle(i.assetId)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {!inputs.length ? (
                    <p className="muted">从左侧勾选需要发布的内容</p>
                  ) : null}
                </aside>
              </div>
            </>
          ) : (
            <>
              <div className="release-schedule-field">
                <Field label="拟发布时间（北京时间）（二期功能）" required>
                  <input
                    aria-label="拟发布时间"
                    type="datetime-local"
                    min={localTime(new Date().toISOString())}
                    value={planned}
                    onInput={(e) => {
                      setPlanned(e.currentTarget.value);
                      setError("");
                    }}
                    onChange={(e) => {
                      setPlanned(e.target.value);
                      setError("");
                    }}
                  />
                </Field>
                <div className="schedule-shortcuts">
                  {[
                    { days: 1, label: "明天 10:00" },
                    { days: 3, label: "三天后 10:00" },
                  ].map((item) => (
                    <button
                      key={item.days}
                      onClick={() => {
                        setPlanned(
                          localTime(
                            new Date(
                              Date.now() + item.days * 86400000,
                            ).toISOString(),
                          ).slice(0, 10) + "T10:00",
                        );
                        setError("");
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p>所选内容使用同一排期，每份内容分别生成发布记录。</p>
              </div>
              <div className="release-review-layout">
                <nav
                  className="release-review-nav"
                  aria-label="核对所选发布内容"
                >
                  {inputs.map((i) => {
                    const a = assets.find((a) => a.id === i.assetId);
                    const stale = a?.current !== i.version;
                    return (
                      <button
                        key={i.assetId}
                        className={
                          active?.assetId === i.assetId ? "active" : ""
                        }
                        onClick={() => setActiveId(i.assetId)}
                      >
                        <AssetImage
                          src={i.thumbnail || i.cover || "/samples/cover-1.svg"}
                          alt="内容缩略图"
                        />
                        <span>
                          {i.title}
                          <small>
                            {stale
                              ? "内容已有新版本"
                              : !i.cover || !i.thumbnail
                                ? "待补充图片"
                                : "信息已带入"}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </nav>
                {active ? (
                  <div className="release-review-fields">
                    {assets.find((a) => a.id === active.assetId)?.current !==
                    active.version ? (
                      <div className="inline-warning">
                        内容已更新，请同步最新版本后核对。
                        <Button
                          onClick={() => {
                            const a = assets.find(
                              (a) => a.id === active.assetId,
                            );
                            if (a) patch(releaseInput(a));
                          }}
                        >
                          同步最新内容信息
                        </Button>
                      </div>
                    ) : null}
                    <div className="section-heading">
                      <strong>发布信息 · V{active.version}.0</strong>
                      <button
                        className="text-link"
                        onClick={() => {
                          const a = assets.find((a) => a.id === active.assetId);
                          if (a) patch(releaseInput(a));
                        }}
                      >
                        重新读取内容信息
                      </button>
                    </div>
                    <p className="muted">
                      已带入内容的标题、摘要与图片。此处修改仅用于本次发布。
                    </p>
                    <Field label="发布标题（二期功能）" required>
                      <input
                        aria-label="发布标题"
                        value={active.title}
                        onChange={(e) => patch({ title: e.target.value })}
                      />
                    </Field>
                    <Field label="摘要（选填）（二期功能）">
                      <textarea
                        rows={3}
                        aria-label="发布摘要"
                        value={active.summary}
                        onChange={(e) => patch({ summary: e.target.value })}
                      />
                    </Field>
                    <div className="release-image-fields">
                      <section>
                        <Field label="发布封面（二期功能）" required>
                          <AssetImage
                            className="release-image-preview"
                            src={active.cover}
                            alt="发布封面"
                          />
                          <CoverPicker
                            value={active.cover}
                            onChange={(cover) =>
                              patch({
                                cover,
                                ...(!active.thumbnail
                                  ? { thumbnail: cover }
                                  : {}),
                              })
                            }
                            label="上传发布封面"
                          />
                        </Field>
                        {!active.cover ? (
                          <p className="inline-field-warning">
                            请选择默认图片或上传封面
                          </p>
                        ) : null}
                      </section>
                      <section>
                        <Field label="缩略图（二期功能）" required>
                          <AssetImage
                            className="release-image-preview"
                            src={active.thumbnail}
                            alt="发布缩略图"
                          />
                          <CoverPicker
                            value={active.thumbnail}
                            onChange={(thumbnail) => patch({ thumbnail })}
                            label="上传发布缩略图"
                          />
                        </Field>
                        <button
                          className="text-link"
                          disabled={!active.cover}
                          onClick={() => patch({ thumbnail: active.cover })}
                        >
                          使用封面作为缩略图
                        </button>
                      </section>
                    </div>
                    {inputs.some((i) => !i.cover || !i.thumbnail) ? (
                      <Button
                        onClick={() =>
                          setInputs((old) =>
                            old.map((i) => ({
                              ...i,
                              cover: i.cover || "/samples/cover-1.svg",
                              thumbnail:
                                i.thumbnail ||
                                i.cover ||
                                "/samples/cover-1.svg",
                            })),
                          )
                        }
                      >
                        为缺少图片的内容使用默认图片
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <Empty title="请先选择内容" />
                )}
              </div>
            </>
          )}
          {error ? (
            <div className="inline-warning" role="alert">
              {error}
            </div>
          ) : null}
        </Dialog>
      ) : null}
      {approvalId ? (
        <ApprovalEditor
          assetIds={[approvalId]}
          onClose={() => setApprovalId("")}
        />
      ) : null}
      {qr ? (
        <Dialog title="扫码查看发布预览（二期功能）" onClose={() => setQr("")}>
          <div className="qr-preview">
            <QRCodeSVG value={qr} size={220} />
            <p>使用手机扫描二维码查看预览。</p>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function PublicationPreview({ id }: { id: string }) {
  const { state, assets } = useCMS();
  const p = state.publications?.find(
    (p) => p.id === id && assets.some((a) => a.id === p.assetId),
  );
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const revision = params.get("revision");
  const port = params.get("port") || "微信端";
  if (!p) return <Empty title="预览不存在或无权访问" />;
  if (revision && Number(revision) !== p.revision)
    return (
      <Empty
        title="此预览已更新"
        description="请从发布详情打开最新的预览链接。"
        action={
          <Button onClick={() => go(`publishing?open=${p.id}`)}>
            查看发布详情
          </Button>
        }
      />
    );
  const v =
    p.snapshot ||
    assets
      .find((a) => a.id === p.assetId)
      ?.versions.find((v) => v.number === p.version);
  return (
    <div className="publication-preview-page">
      <button
        className="back-link"
        onClick={() => go(`publishing?open=${p.id}`)}
      >
        <ArrowLeft size={16} />
        返回发布详情
      </button>
      <div className="preview-port-label">
        瑞医空间 · {port} · 原型预览（二期功能）
      </div>
      <article>
        <AssetImage src={p.cover} alt="发布封面" />
        <h1>{p.title}</h1>
        <p className="muted">
          内容 V{p.version}.0 · {p.summary}
        </p>
        {v?.content.map((text, i) => (
          <p key={i}>{text}</p>
        ))}
      </article>
    </div>
  );
}
