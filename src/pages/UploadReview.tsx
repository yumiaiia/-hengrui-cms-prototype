import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Image as ImageIcon,
  Film,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Tags,
  X,
} from "lucide-react";
import { CancelBatch } from "../components/CancelBatch";
import { bindingName, boundDefinitions } from "../tagResults";
import { useCMS } from "../store";
import {
  archiveStaged,
  activeItem,
  confirmStaged,
  patchStaged,
  rebaseStaged,
  retryStaged,
  reviewProblems,
  visibleBatches,
  resolveStagedRecommendation,
  restoreStagedRecommendation,
} from "../uploadReview";
import { availableTag, tagLabel, validateTag } from "../taxonomy";
import { requireTagCheck } from "../tagSimilarity";
import {
  dateLabel,
  go,
  uid,
  canRole,
  type State,
  type StagedUploadItem,
} from "../model";
import { DocumentReader } from "../components/DocumentReader";
import {
  Button,
  Badge,
  Dialog,
  Empty,
  Field,
  PageHeader,
  SearchBox,
  Tabs,
} from "../components/ui";
import {
  ContentMedia,
  ContentMetadataForm,
  type ContentMetadata,
} from "../components/ContentMedia";
import { useTagCheck } from "../components/TagSimilarity";
import { loadBlob } from "../storage";
import { paginated } from "../workflow";

type Filter = "all" | "pending" | "processing" | "confirmed" | "cancelled";
const processing = (i: StagedUploadItem) =>
  ["排队中", "处理中"].includes(i.v.process);
const confirmed = (i: StagedUploadItem, state: State) =>
  activeItem(i) &&
  i.confirmedRevision === i.revision &&
  (!i.confirmedTags || i.confirmedTags === boundDefinitions(i.v, state.tags));
function status(i: StagedUploadItem, state: State, tags = false) {
  return i.cancelled
    ? "已取消"
    : i.archived
      ? tags
        ? "已更新"
        : "已归档"
      : processing(i)
        ? tags
          ? "匹配中"
          : "解析打标中"
        : i.archiveError
          ? tags
            ? "更新需处理"
            : "归档需处理"
          : i.v.process === "失败" || i.v.process === "部分失败"
            ? tags
              ? "匹配需重试"
              : "解析失败"
            : confirmed(i, state)
              ? "已确认"
              : "待确认";
}
export default function UploadReview({ id }: { id: string }) {
  const { state, can, update, toast } = useCMS();
  const [cancelling, setCancelling] = useState<string>();
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const batch = visibleBatches(state).find((b) => b.id === id);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [id]);
  if (!batch)
    return (
      <Empty
        title="批次不存在或无权查看"
        action={
          <Button onClick={() => go("library?tab=pending")}>返回待归档</Button>
        }
      />
    );
  const tags = batch.kind === "tags";
  const writable = tags ? can("taxonomy") && can("tags") : can("upload");
  const cancelled = batch.items.filter((i) => i.cancelled);
  const archived = batch.items.filter((i) => i.archived),
    working = batch.items.filter((i) => activeItem(i) && processing(i)),
    checked = batch.items.filter((i) => confirmed(i, state)),
    waiting = batch.items.filter(
      (i) => activeItem(i) && !processing(i) && !confirmed(i, state),
    );
  const shown = batch.items.filter(
    (i) =>
      filter === "all" ||
      (filter === "processing" && activeItem(i) && processing(i)) ||
      (filter === "confirmed" && confirmed(i, state)) ||
      (filter === "cancelled" && !!i.cancelled) ||
      (filter === "pending" &&
        activeItem(i) &&
        !processing(i) &&
        !confirmed(i, state)),
  );
  const item =
    shown.find((i) => i.id === selected) ||
    shown.find((i) => activeItem(i) && !confirmed(i, state)) ||
    shown[0];
  const itemIndex = item ? batch.items.findIndex((i) => i.id === item.id) : -1;
  const nextReady = item
    ? batch.items.find(
        (i) =>
          i.id !== item.id &&
          activeItem(i) &&
          !processing(i) &&
          !confirmed(i, state),
      )
    : undefined;
  const allArchived = !batch.items.some(activeItem);
  function choose(itemId: string) {
    setSelected(itemId);
    setError("");
    requestAnimationFrame(() =>
      document
        .querySelector(".confirmation-workspace")
        ?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  }
  async function archive() {
    if (lock.current || !batch) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const fileErrors: Record<string, string> = {};
      for (const i of tags ? [] : checked) {
        try {
          if (i.v.fileKey || i.v.fileUrl)
            await loadBlob(i.v.fileKey, i.v.fileUrl);
          if (i.v.video) await loadBlob(i.v.video.fileKey);
          for (const e of i.v.approval.snapshot?.evidence || [])
            await loadBlob(e.fileKey, e.url);
        } catch {
          fileErrors[i.id] =
            "文件或上传素材不可用，本份内容暂未归档，请联系管理员核查。";
        }
      }
      let result = { success: 0, failed: 0 };
      const log: import("../audit").AuditInput = {
        action: tags ? "确认并更新内容标签" : "确认结果并归档",
        object: `${checked.length} 份内容`,
        batchId: id,
      };
      const saved = update(
        (s) => {
          if (s.userId !== state.userId)
            throw new Error("操作账号已变化，请重新打开批次。");
          result = archiveStaged(
            s,
            id,
            checked.map((i) => i.id),
            fileErrors,
          );
          log.result = result.failed
            ? result.success
              ? "部分成功"
              : "失败"
            : "成功";
          log.detail = `归档成功 ${result.success} 份，失败 ${result.failed} 份。`;
        },
        log,
        tags ? "taxonomy" : "upload",
      );
      if (!saved) {
        setError("结果未保存，已确认状态仍保留，请重试。");
        return;
      }
      setFilter("all");
      toast(
        `${tags ? "标签更新" : "归档"}成功 ${result.success} 份${result.failed ? "，其余文件请查看提示后重试" : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "归档失败，已确认结果保留。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="confirmation-page">
      <button className="back-link" onClick={() => go("library?tab=pending")}>
        <ArrowLeft size={16} />
        返回待归档
      </button>
      <PageHeader
        title={
          allArchived
            ? "本批次已结束"
            : tags
              ? "标签同步与结果确认"
              : "上传处理与结果确认"
        }
        description={`${batch.items.length} 份文件 · ${dateLabel(batch.createdAt)} ${tags ? "发起" : "上传"} · 批次 ${id.slice(-8)}`}
        action={
          !allArchived && writable ? (
            <Button onClick={() => setCancelling("all")}>
              {tags ? "取消剩余更新" : "取消剩余归档"}
            </Button>
          ) : undefined
        }
      />
      <div className="confirmation-batch-status">
        <div className="confirmation-batch-status-label">
          {working.length ? (
            <Loader2 size={19} className="spin" />
          ) : allArchived ? (
            <CheckCircle2 size={19} />
          ) : (
            <Tags size={19} />
          )}
          <div>
            <strong>
              {allArchived
                ? `本批次已${tags ? "更新" : "归档"} ${archived.length} 份${cancelled.length ? `，已取消 ${cancelled.length} 份` : ""}`
                : working.length
                  ? tags
                    ? "标签同步中，可先确认已完成的文件"
                    : "解析打标仍在进行，可先确认已完成的文件"
                  : tags
                    ? "查看每份文件的完整标签结果，确认后更新"
                    : "解析打标已完成，请逐份核对结果"}
            </strong>
            <p>
              {working.length
                ? "处理可能需要较长时间，可先离开，稍后从“待归档”继续。"
                : tags
                  ? "确认前正式内容继续使用原标签，更新后保持原文件版本。"
                  : "先查看内容信息与展示素材，再核对标签；确认后统一归档。"}
            </p>
          </div>
        </div>
        <div className="confirmation-counts">
          <span>
            <b>{working.length}</b>处理中
          </span>
          <span>
            <b>{waiting.length}</b>待确认
          </span>
          <span>
            <b>{checked.length}</b>已确认
          </span>
          <span>
            <b>{archived.length}</b>已{tags ? "更新" : "归档"}
          </span>
        </div>
      </div>
      {error ? (
        <p className="confirmation-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="confirmation-layout">
        <aside className="confirmation-queue panel">
          <div className="confirmation-queue-title">
            <h2>本批次文件</h2>
            <span>{batch.items.length} 份</span>
          </div>
          <select
            className="confirmation-filter"
            aria-label="筛选文件状态"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">全部文件 ({batch.items.length})</option>
            <option value="pending">待确认 ({waiting.length})</option>
            <option value="processing">处理中 ({working.length})</option>
            <option value="confirmed">已确认 ({checked.length})</option>
            {cancelled.length ? (
              <option value="cancelled">已取消 ({cancelled.length})</option>
            ) : null}
          </select>
          <nav aria-label="本批次文件" className="confirmation-file-list">
            {shown.map((i) => (
              <button
                key={i.id}
                aria-current={item?.id === i.id ? "true" : undefined}
                className={item?.id === i.id ? "selected" : ""}
                onClick={() => choose(i.id)}
              >
                <span className="confirmation-file-kind">{i.v.kind}</span>
                <div>
                  <strong>{i.v.title}</strong>
                  <small>{i.v.fileName}</small>
                  {i.v.cover || i.v.thumbnail || i.v.video ? (
                    <span className="confirmation-file-media">
                      {i.v.cover ? (
                        <span>
                          <ImageIcon size={10} />
                          封面
                        </span>
                      ) : null}
                      {i.v.thumbnail ? (
                        <span>
                          <ImageIcon size={10} />
                          缩略图
                        </span>
                      ) : null}
                      {i.v.video ? (
                        <span>
                          <Film size={10} />
                          视频
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <Badge>{status(i, state, tags)}</Badge>
                </div>
                {i.archived || confirmed(i, state) ? (
                  <Check size={15} className="confirmation-file-check" />
                ) : null}
              </button>
            ))}
            {!shown.length ? (
              <div className="confirmation-queue-empty">
                此状态下暂无文件
                <Button variant="ghost" onClick={() => setFilter("all")}>
                  查看全部文件
                </Button>
              </div>
            ) : null}
          </nav>
        </aside>
        {item ? (
          <ReviewFile
            key={`${id}-${item.id}`}
            batchId={id}
            tagsOnly={tags}
            onCancel={() => setCancelling(item.id)}
            item={item}
            disabled={busy || !writable}
            index={itemIndex + 1}
            total={batch.items.length}
            nextReady={!!nextReady}
            onConfirmed={() => {
              setFilter("all");
              choose(nextReady?.id || item.id);
            }}
            onMutated={() => {
              setFilter("all");
              setSelected(item.id);
            }}
            onNavigate={(offset) => {
              setFilter("all");
              choose(batch.items[itemIndex + offset].id);
            }}
          />
        ) : (
          <section className="panel">
            <Empty
              title="请选择文件"
              description="在左侧选择需要核对的文件。"
            />
          </section>
        )}
      </div>
      <div className="upload-submit-bar confirmation-archive-bar">
        <div>
          <strong>
            本批次已{tags ? "更新" : "归档"} {archived.length} /{" "}
            {batch.items.length} 份
          </strong>
          <small>
            {checked.length
              ? `${checked.length} 份已确认，可${tags ? "更新标签" : "归档"}；其余文件稍后继续处理。`
              : allArchived
                ? "可在内容库查看正式内容。"
                : `逐份确认后，在这里统一${tags ? "更新标签" : "归档"}。`}
          </small>
        </div>
        <Button
          variant="primary"
          disabled={busy || !writable || !checked.length}
          onClick={() => void archive()}
          icon={busy ? <Loader2 size={16} className="spin" /> : undefined}
        >
          {busy
            ? "正在保存…"
            : `${tags ? "更新" : "归档"}已确认的 ${checked.length} 份`}
        </Button>
      </div>
      {cancelling ? (
        <CancelBatch
          batchId={id}
          itemId={cancelling === "all" ? undefined : cancelling}
          onClose={() => setCancelling(undefined)}
        />
      ) : null}
    </div>
  );
}
function ReviewFile({
  batchId,
  tagsOnly,
  onCancel,
  item,
  disabled,
  index,
  total,
  nextReady,
  onConfirmed,
  onNavigate,
  onMutated,
}: {
  batchId: string;
  tagsOnly: boolean;
  onCancel: () => void;
  item: StagedUploadItem;
  disabled: boolean;
  index: number;
  total: number;
  nextReady: boolean;
  onConfirmed: () => void;
  onMutated: () => void;
  onNavigate: (offset: number) => void;
}) {
  const { state, update, toast } = useCMS();
  const [tab, setTab] = useState(tagsOnly ? "tags" : "info"),
    [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [metadata, setMetadata] = useState<ContentMetadata>();
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaBusyRef = useRef(false);
  const pending = activeItem(item) && processing(item),
    archived = !!item.archived,
    isConfirmed = confirmed(item, state),
    locked =
      disabled ||
      pending ||
      archived ||
      !!item.cancelled ||
      item.v.process !== "完成";
  const batch = state.uploadBatches!.find((b) => b.id === batchId)!;
  const problems = reviewProblems(state, item, batch),
    target = state.assets.find((a) => a.id === item.targetId);
  const failed =
    item.v.process === "失败" ||
    item.v.process === "部分失败" ||
    item.v.tagStatus === "失败" ||
    Object.values(item.v.pageStates || {}).some((p) => p.status === "失败");
  function run(recipe: (s: State) => void, action: string, detail = "") {
    setError("");
    try {
      const saved = update(
        recipe,
        { action, object: item.v.title, batchId, detail },
        tagsOnly ? "taxonomy" : "upload",
      );
      if (!saved) setError("修改未保存，请检查权限或浏览器存储后重试。");
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败。");
      return false;
    }
  }
  function patch(
    changes: Parameters<typeof patchStaged>[3],
    flags: Parameters<typeof patchStaged>[4] = {},
  ) {
    return run(
      (s) => patchStaged(s, batchId, item.id, changes, flags),
      "校正确认结果",
    );
  }
  return (
    <section className="confirmation-workspace panel">
      <header className="confirmation-file-header">
        <div>
          <div className="confirmation-file-eyebrow">
            文件 {index} / {total}
            <Badge>{status(item, state, tagsOnly)}</Badge>
          </div>
          <h2>{item.v.title}</h2>
          <p>
            {item.v.fileName} · {item.v.kind}
            {paginated(item.v) ? ` · ${item.v.pages} 页` : ""}
            {item.targetId
              ? ` · 更新 ${target?.code || "已有内容"}`
              : " · 新增内容"}
          </p>
        </div>
        <div className="confirmation-navigation">
          <Button
            aria-label="上一份文件"
            disabled={index === 1 || disabled}
            onClick={() => onNavigate(-1)}
            icon={<ChevronLeft size={16} />}
          />
          <Button
            aria-label="下一份文件"
            disabled={index === total || disabled}
            onClick={() => onNavigate(1)}
            icon={<ChevronRight size={16} />}
          />
        </div>
      </header>
      {item.targetId &&
      activeItem(item) &&
      (target?.current !== item.baseVersion ||
        (tagsOnly && problems.some((p) => /已变化|已更新/.test(p)))) ? (
        <div className="confirmation-alert">
          <strong>
            {tagsOnly
              ? "内容或标签库已变化，请重新同步本文件。"
              : "当前正式版本已变化，请核对本次更新目标。"}
          </strong>
          <Button
            onClick={() =>
              run((s) => rebaseStaged(s, batchId, item.id), "重新核对版本目标")
            }
          >
            {tagsOnly ? "重新同步本文件" : "按最新版本重新核对"}
          </Button>
        </div>
      ) : null}
      {pending ? (
        <div className="confirmation-processing">
          <Clock3 size={18} />
          <div>
            <strong>{tagsOnly ? "正在同步最新标签" : "正在解析打标"}</strong>
            <span>
              {tagsOnly
                ? "原文件与正式标签保持原样，完成后可查看并确认本次标签结果。"
                : "上传信息和素材已保存。完成后可查看并校正标签，无需停留等待。"}
            </span>
          </div>
        </div>
      ) : null}
      <div className="confirmation-tabs">
        <Tabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            requestAnimationFrame(() =>
              document
                .querySelector(".confirmation-tabs")
                ?.scrollIntoView({ block: "start", behavior: "instant" }),
            );
          }}
          items={[
            { key: "info", label: "内容信息与素材" },
            { key: "tags", label: "打标结果", count: item.v.tags.length },
          ]}
        />
      </div>
      {tab === "info" ? (
        <div className="confirmation-info">
          <div className="confirmation-section-title">
            <div>
              <h3>内容信息</h3>
              <p>以下信息与素材仅用于当前文件。</p>
            </div>
            {!locked && !tagsOnly ? (
              <Button
                onClick={() => {
                  setMetadata({
                    title: item.v.title,
                    summary: item.v.summary,
                    cover: item.v.cover,
                    thumbnail: item.v.thumbnail,
                    video: item.v.video,
                  });
                  setError("");
                }}
              >
                编辑内容信息
              </Button>
            ) : null}
          </div>
          <dl className="confirmation-details">
            <dt>内容标题</dt>
            <dd>{item.v.title}</dd>
            <dt>摘要</dt>
            <dd className="confirmation-summary">
              {item.v.summary || "未填写摘要"}
            </dd>
          </dl>
          <div className="confirmation-section-title">
            <div>
              <h3>展示素材</h3>
              <p>封面、缩略图和补充视频独立保存，可分别核对。</p>
            </div>
          </div>
          <ContentMedia value={item.v} />
          <div className="confirmation-locked-info">
            <div className="confirmation-section-title">
              <h3>
                <LockKeyhole size={15} />
                源文件与审批信息
              </h3>
              <span>上传时已固定</span>
            </div>
            <dl className="confirmation-details">
              <dt>源文件</dt>
              <dd>{item.v.fileName}</dd>
              <dt>来源</dt>
              <dd>{item.v.sourceUrl || item.v.source}</dd>
              <dt>审批方式</dt>
              <dd>
                {item.v.approval.mode === "exempt"
                  ? "无需登记审批"
                  : item.v.approval.mode === "registered"
                    ? "已登记"
                    : "未登记"}
              </dd>
              {item.v.approval.snapshot ? (
                <>
                  <dt>审批编号</dt>
                  <dd>{item.v.approval.snapshot.number}</dd>
                  <dt>有效期</dt>
                  <dd>{item.v.approval.snapshot.expiry}</dd>
                  <dt>审批截图</dt>
                  <dd>
                    {item.v.approval.snapshot.evidence
                      .map((e) => e.name)
                      .join("、") || "未记录"}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        </div>
      ) : (
        <div className="confirmation-tag-layout">
          <section className="confirmation-document">
            <div className="confirmation-document-title">
              <FileText size={16} />
              <h3>内容预览</h3>
              <span>
                {paginated(item.v) ? `当前第 ${page} 页` : item.v.kind}
              </span>
            </div>
            {pending ? (
              <div className="confirmation-preview-empty">
                <Loader2 size={28} className="spin" />
                <h3>{tagsOnly ? "标签结果生成中" : "解析结果生成中"}</h3>
                <p>可先查看“内容信息与素材”，稍后回来核对标签。</p>
              </div>
            ) : (
              <DocumentReader
                key={item.v.fileKey || item.id}
                version={item.v}
                page={page}
                onPage={setPage}
              />
            )}
          </section>
          <ReviewTags
            batchId={batchId}
            item={item}
            page={page}
            onPage={setPage}
            disabled={locked}
            patch={patch}
            run={run}
          />
        </div>
      )}
      {error || item.error || item.archiveError ? (
        <p className="confirmation-error" role="alert">
          {error || item.archiveError || item.error}
        </p>
      ) : null}
      {!pending && activeItem(item) && problems.length ? (
        <div className="confirmation-validation">
          <strong>确认前还需处理</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <footer className="confirmation-file-footer">
        <div>
          {item.cancelled ? (
            <span>本文件已取消，正式内容保持原样。</span>
          ) : archived ? (
            <>
              <CheckCircle2 size={18} />
              <span>
                已{tagsOnly ? "更新" : "归档"} · V{item.archived!.version}
              </span>
            </>
          ) : isConfirmed ? (
            <>
              <CheckCircle2 size={18} />
              <span>
                已确认，等待{tagsOnly ? "更新标签" : "归档"}
                。修改结果后需要重新确认。
              </span>
            </>
          ) : pending ? (
            <>
              <Clock3 size={18} />
              <span>处理完成后可确认本文件。</span>
            </>
          ) : (
            <span>
              {tagsOnly
                ? "核对完整标签结果，可直接调整后确认本文件。"
                : "核对内容信息、展示素材和标签后，确认本文件。"}
            </span>
          )}
        </div>
        <div className="actions">
          {failed && !pending && activeItem(item) ? (
            <Button
              disabled={disabled}
              icon={<RefreshCw size={14} />}
              onClick={() =>
                run(
                  (s) => retryStaged(s, batchId, item.id),
                  tagsOnly ? "重试标签匹配" : "重试失败解析",
                )
              }
            >
              重试失败任务
            </Button>
          ) : null}
          {activeItem(item) ? (
            <Button variant="ghost" disabled={disabled} onClick={onCancel}>
              取消{tagsOnly ? "本次更新" : "归档"}
            </Button>
          ) : null}
          {item.cancelled ? null : archived ? (
            <Button
              onClick={() =>
                go(
                  `content/${item.archived!.assetId}?version=${item.archived!.version}`,
                )
              }
            >
              查看正式内容
            </Button>
          ) : isConfirmed ? (
            <Button disabled={!nextReady} onClick={onConfirmed}>
              查看下一份待确认文件
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={locked || !!problems.length}
              onClick={() => {
                if (
                  run(
                    (s) => confirmStaged(s, batchId, item.id),
                    tagsOnly ? "确认标签更新结果" : "确认内容与标签结果",
                  )
                ) {
                  toast("本文件已确认。");
                  onConfirmed();
                }
              }}
            >
              {nextReady ? "确认本文件并查看下一份" : "确认本文件"}
            </Button>
          )}
        </div>
      </footer>
      {metadata ? (
        <Dialog
          wide
          title={`编辑内容信息 · ${item.v.title}`}
          onClose={() => {
            if (!mediaBusyRef.current) setMetadata(undefined);
          }}
          footer={
            <>
              <Button
                disabled={mediaBusy}
                onClick={() => setMetadata(undefined)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                disabled={mediaBusy || disabled || !metadata.title.trim()}
                onClick={() => {
                  if (patch(metadata)) {
                    setMetadata(undefined);
                    toast("内容信息与素材已保存。");
                  }
                }}
              >
                {mediaBusy ? "正在保存素材…" : "保存内容信息"}
              </Button>
            </>
          }
        >
          <p className="metadata-file-context">
            仅修改当前文件的标题、摘要和展示素材。源文件与审批信息保持上传时的记录。
          </p>
          <ContentMetadataForm
            value={metadata}
            onChange={(changes) =>
              setMetadata((v) => (v ? { ...v, ...changes } : v))
            }
            onBusyChange={(value) => {
              mediaBusyRef.current = value;
              setMediaBusy(value);
            }}
          />
        </Dialog>
      ) : null}
    </section>
  );
}
function ReviewTags({
  batchId,
  item,
  page,
  onPage,
  disabled,
  patch,
  run,
}: {
  batchId: string;
  item: StagedUploadItem;
  page: number;
  onPage: (page: number) => void;
  disabled: boolean;
  patch: (
    changes: Parameters<typeof patchStaged>[3],
    flags?: Parameters<typeof patchStaged>[4],
  ) => boolean;
  run: (recipe: (s: State) => void, action: string, detail?: string) => boolean;
}) {
  const { state, can } = useCMS();
  const [scope, setScope] = useState("material");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [creation, setCreation] = useState<{
    name: string;
    parentId: string;
    recommendationId?: string;
    page?: number;
  }>();
  const [recommendation, setRecommendation] = useState<string>();
  const [dialogError, setDialogError] = useState("");
  const { checkTag, similarityDialog } = useTagCheck();
  const currentPage = scope === "page" ? page : undefined;
  const bindings = item.v.tags.filter((b) => b.page === currentPage);
  const activeRecommendation = item.recommendations?.find(
    (r) => r.id === recommendation,
  );
  const candidates = state.tags.filter(
    (t) =>
      t.parentId &&
      availableTag(state.tags, t) &&
      (!activeRecommendation || t.parentId === activeRecommendation.parentId) &&
      t.name.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = state.tags
    .filter((t) => t.parentId === null)
    .map((root) => ({
      root,
      tags: bindings.filter(
        (b) => state.tags.find((t) => t.id === b.tagId)?.parentId === root.id,
      ),
    }))
    .filter((g) => g.tags.length);
  const unknown = bindings.filter(
    (b) => !groups.some((g) => g.tags.includes(b)),
  );
  if (unknown.length)
    groups.push({
      root: {
        id: "unknown",
        name: "其他标签",
        parentId: null,
        enabled: false,
        external: false,
      },
      tags: unknown,
    });
  function addTag(tagId: string) {
    if (recommendation) {
      if (
        run(
          (s) =>
            resolveStagedRecommendation(
              s,
              batchId,
              item.id,
              recommendation,
              tagId,
            ),
          "复用标签并采纳推荐",
        )
      ) {
        setRecommendation(undefined);
        setAdding(false);
      }
    } else {
      if (bindings.some((b) => b.tagId === tagId)) return;
      if (
        patch({
          tags: [...item.v.tags, { tagId, origin: "人工", page: currentPage }],
        })
      )
        setAdding(false);
    }
  }
  function createTag() {
    if (!creation) return;
    setDialogError("");
    try {
      checkTag(
        { name: creation.name, parentId: creation.parentId },
        (choice) => {
          const saved = run(
            (s) => {
              const actor = s.users.find((u) => u.id === s.userId),
                role = s.roles.find((r) => r.id === actor?.roleId);
              if (!canRole(role, "taxonomy"))
                throw new Error("没有新增标签权限。");
              const draft = {
                name: creation.name.trim(),
                parentId: creation.parentId,
              };
              const validation = validateTag(s.tags, draft);
              if (validation) throw new Error(validation);
              requireTagCheck(s.tags, draft, choice.receipt);
              const tag = {
                id: uid("tag"),
                ...draft,
                enabled: true,
                external: false,
              };
              s.tags.push(tag);
              if (creation.recommendationId)
                resolveStagedRecommendation(
                  s,
                  batchId,
                  item.id,
                  creation.recommendationId,
                  tag.id,
                );
              else {
                const actual = s
                  .uploadBatches!.find((b) => b.id === batchId)!
                  .items.find((i) => i.id === item.id)!;
                if (
                  !actual.v.tags.some(
                    (b) => b.tagId === tag!.id && b.page === creation.page,
                  )
                )
                  patchStaged(s, batchId, item.id, {
                    tags: [
                      ...actual.v.tags,
                      { tagId: tag.id, origin: "人工", page: creation.page },
                    ],
                  });
              }
            },
            "创建标签并用于待归档内容",
            choice.receipt ? "已查看相似候选，仍然创建标签。" : "",
          );
          if (saved) {
            setCreation(undefined);
            setAdding(false);
            setRecommendation(undefined);
          }
        },
      );
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : "标签未保存。");
    }
  }
  return (
    <aside className="confirmation-tag-panel">
      <div className="confirmation-tag-panel-title">
        <Tags size={16} />
        <h3>标签核对</h3>
        <span>{item.v.tags.length} 个</span>
      </div>
      <fieldset disabled={disabled}>
        <div
          className="confirmation-scope"
          role="tablist"
          aria-label="标签作用范围"
        >
          <button
            role="tab"
            aria-selected={scope === "material"}
            onClick={() => setScope("material")}
          >
            材料标签
          </button>
          {paginated(item.v) ? (
            <button
              role="tab"
              aria-selected={scope === "page"}
              onClick={() => setScope("page")}
            >
              页级标签
            </button>
          ) : null}
        </div>
        <div className="confirmation-tag-context">
          <strong>
            {scope === "page" ? `第 ${page} 页的标签` : "整份材料的标签"}
          </strong>
          <p>
            {scope === "page"
              ? "切换左侧预览页，查看并校正对应页的标签。"
              : "这些标签适用于整份文件，与各页标签分别维护。"}
          </p>
        </div>
        {scope === "page" ? (
          <div className="confirmation-page-select">
            <label htmlFor={`tag-page-${item.id}`}>选择页码</label>
            <select
              id={`tag-page-${item.id}`}
              value={page}
              onChange={(e) => onPage(Number(e.target.value))}
            >
              {Array.from({ length: item.v.pages }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  第 {i + 1} 页
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="confirmation-bound-tags">
          {groups.map(({ root, tags }) => (
            <section key={root.id}>
              <h4>{root.name}</h4>
              <div>
                {tags.map((b) => {
                  const tag = state.tags.find((t) => t.id === b.tagId);
                  return (
                    <span
                      key={b.tagId}
                      className={`confirmation-tag ${tag && availableTag(state.tags, tag) ? "" : "is-invalid"}`}
                    >
                      <span>
                        {bindingName(b, state.tags)}
                        {tag && !availableTag(state.tags, tag) ? (
                          <small>已停用</small>
                        ) : null}
                        <small>{b.origin === "AI" ? "AI" : "人工"}</small>
                      </span>
                      <button
                        aria-label={`移除${scope === "page" ? `第${page}页` : "材料"}标签 ${bindingName(b, state.tags)}`}
                        onClick={() =>
                          patch({
                            tags: item.v.tags.filter(
                              (t) =>
                                !(
                                  t.tagId === b.tagId && t.page === currentPage
                                ),
                            ),
                          })
                        }
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </section>
          ))}
          {!bindings.length ? (
            <div className="confirmation-no-tags">
              <Tags size={23} />
              <strong>
                {disabled && processing(item) ? "标签生成中" : "此处暂无标签"}
              </strong>
              <span>
                {disabled && processing(item)
                  ? "处理完成后会展示识别结果。"
                  : "可按需添加标签，暂无标签也可确认。"}
              </span>
            </div>
          ) : null}
        </div>
        <Button
          className="confirmation-add-tag"
          icon={<Plus size={14} />}
          onClick={() => {
            setQuery("");
            setRecommendation(undefined);
            setAdding(true);
          }}
        >
          添加{scope === "page" ? "页级" : "材料"}标签
        </Button>
        {item.v.tagStatus === "失败" ? (
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={!!item.manualTagging}
              onChange={(e) => patch({}, { manualTagging: e.target.checked })}
            />
            已人工完成标签核对
          </label>
        ) : null}
        {item.recommendations?.some((r) => !r.resolved) ? (
          <section className="confirmation-recommendations">
            <h4>
              推荐标签 <small>可稍后处理</small>
            </h4>
            {item.recommendations
              .filter((r) => !r.resolved)
              .map((r) => (
                <article key={r.id}>
                  <strong>{r.name}</strong>
                  <small>
                    {r.page ? `来自第 ${r.page} 页` : "来自整份材料"}
                  </small>
                  <div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRecommendation(r.id);
                        setQuery("");
                        setAdding(true);
                        if (r.page) {
                          setScope("page");
                          onPage(r.page);
                        } else setScope("material");
                      }}
                    >
                      选择已有标签
                    </Button>
                    {can("taxonomy") &&
                    state.uploadBatches?.find((b) => b.id === batchId)?.kind !==
                      "tags" ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDialogError("");
                          setCreation({
                            name: r.name,
                            parentId: r.parentId,
                            recommendationId: r.id,
                            page: r.page,
                          });
                        }}
                      >
                        新建并采用
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        run(
                          (s) =>
                            resolveStagedRecommendation(
                              s,
                              batchId,
                              item.id,
                              r.id,
                            ),
                          "取消推荐标签",
                        )
                      }
                    >
                      取消推荐
                    </Button>
                  </div>
                </article>
              ))}
          </section>
        ) : null}
      </fieldset>
      {item.recommendations?.some((r) => r.cancelled) ? (
        <details className="confirmation-recommendations">
          <summary>已取消的推荐</summary>
          {item.recommendations
            .filter((r) => r.cancelled)
            .map((r) => (
              <div className="toolbar" key={r.id}>
                <span>
                  {r.name}
                  {r.page ? ` · 第 ${r.page} 页` : " · 材料"}
                </span>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    run(
                      (s) =>
                        restoreStagedRecommendation(s, batchId, item.id, r.id),
                      "恢复推荐标签",
                    )
                  }
                >
                  恢复推荐
                </Button>
              </div>
            ))}
        </details>
      ) : null}
      {adding ? (
        <Dialog
          title={
            activeRecommendation
              ? `为“${activeRecommendation.name}”选择标签`
              : `添加${scope === "page" ? `第 ${page} 页` : "材料"}标签`
          }
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button onClick={() => setAdding(false)}>完成</Button>
              {can("taxonomy") &&
              state.uploadBatches?.find((b) => b.id === batchId)?.kind !==
                "tags" ? (
                <Button
                  onClick={() => {
                    setDialogError("");
                    setCreation({
                      name: activeRecommendation?.name || query,
                      parentId: activeRecommendation?.parentId || "",
                      recommendationId: recommendation,
                      page: activeRecommendation?.page ?? currentPage,
                    });
                  }}
                >
                  新建标签
                </Button>
              ) : null}
            </>
          }
        >
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="搜索标签名称"
          />
          <div className="confirmation-tag-picker">
            {candidates.map((t) => (
              <button
                key={t.id}
                disabled={
                  disabled ||
                  (!!bindings.find((b) => b.tagId === t.id) && !recommendation)
                }
                onClick={() => addTag(t.id)}
              >
                <span>
                  {t.name}
                  <small>{tagLabel(state.tags, t)}</small>
                </span>
                {bindings.some((b) => b.tagId === t.id) && !recommendation ? (
                  <Check size={16} />
                ) : (
                  <Plus size={16} />
                )}
              </button>
            ))}
            {!candidates.length ? (
              <p>没有匹配的可用标签，请调整关键词。</p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      {creation ? (
        <Dialog
          title="新建标签并添加"
          onClose={() => setCreation(undefined)}
          footer={
            <>
              <Button onClick={() => setCreation(undefined)}>取消</Button>
              <Button
                variant="primary"
                disabled={
                  disabled || !creation.name.trim() || !creation.parentId
                }
                onClick={createTag}
              >
                检查相似并添加
              </Button>
            </>
          }
        >
          <Field label="标签名称" required>
            <input
              className="input"
              value={creation.name}
              onChange={(e) =>
                setCreation({ ...creation, name: e.target.value })
              }
            />
          </Field>
          <Field label="标签分类" required>
            <select
              value={creation.parentId}
              disabled={!!creation.recommendationId}
              onChange={(e) =>
                setCreation({ ...creation, parentId: e.target.value })
              }
            >
              <option value="">请选择分类</option>
              {state.tags
                .filter((t) => !t.parentId && t.enabled)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          {dialogError ? (
            <p className="error-text" role="alert">
              {dialogError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
      {similarityDialog}
    </aside>
  );
}
