import { availableTag } from "../taxonomy";
import { bindingName } from "../tagResults";
import { ContentMedia, VideoListEditor } from "../components/ContentMedia";
import { PhaseTwoNote } from "../components/PhaseTwoNote";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Send,
  Info,
  ShieldCheck,
  Tags,
  Download,
  Upload,
  History,
  RotateCw,
} from "lucide-react";
import { useCMS } from "../store";
import {
  current,
  dateLabel,
  expiryStatus,
  approvalLabel,
  ocrWarnings,
  now,
  go,
  VISIBILITY_FIELD,
  audienceLabel,
  type SupplementaryVideo,
} from "../model";
import { applyRules, audiencesOf, fieldValuesOf } from "../tagResults";
import { loadBlob, download } from "../storage";
import {
  AssetImage,
  CoverPicker,
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Note,
  PageHeader,
} from "../components/ui";
import { TagPanel } from "../components/TagPanel";
import { ApprovalEditor } from "../components/ApprovalEditor";
import { ExportDialog } from "../export";
import { DocumentReader, PageCanvas } from "../components/DocumentReader";
import { paginated } from "../workflow";
import { fileParsingFailed, reparseFile } from "../fileProcessing";
export default function ContentDetail({ id }: { id: string }) {
  const { state, assets, can, update, toast } = useCMS();
  const asset = assets.find((a) => a.id === id);
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const [number, setNumber] = useState(
    Number(params.get("version")) || asset?.current || 1,
  );
  const [page, setPage] = useState(
    Math.max(1, Number(params.get("page")) || 1),
  );
  const [pageCount, setPageCount] = useState(0);
  const [modal, setModal] = useState(
    params.get("tab") === "approval" ? "approval-info" : "",
  );
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [cover, setCover] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [videos, setVideos] = useState<SupplementaryVideo[]>();
  const [mediaBusy, setMediaBusy] = useState(false);
  const [expiry, setExpiry] = useState("");
  const v =
    asset?.versions.find((v) => v.number === number) ||
    (asset ? current(asset) : undefined);
  useEffect(() => {
    setNumber(
      Number(new URLSearchParams(location.hash.split("?")[1]).get("version")) ||
        asset?.current ||
        1,
    );
    setPage(
      Math.max(
        1,
        Number(new URLSearchParams(location.hash.split("?")[1]).get("page")) ||
          1,
      ),
    );
  }, [id]);
  if (!asset || !v)
    return (
      <Empty
        title="无法访问内容"
        description="内容不存在，或当前账号没有查看权限。"
        action={<Button onClick={() => go("library")}>返回内容库</Button>}
      />
    );
  const historical = v.number !== asset.current;
  const editable = can("edit") && !historical && asset.lifecycle === "正常";
  const shot = v.approval.snapshot?.evidence[0];
  function reparse() {
    try {
      if (
        update(
          (draft) => reparseFile(draft, id, number),
          { action: "重试文件解析", object: asset!.code, module: "内容库" },
          "edit",
        )
      )
        toast("正在重新解析整份文件。");
    } catch (e) {
      toast(e instanceof Error ? e.message : "重新解析失败");
    }
  }
  async function original() {
    if (!can("export")) return toast("没有下载权限");
    try {
      const blob = await loadBlob(v!.fileKey, v!.fileUrl);
      download(blob, v!.fileName);
    } catch (e) {
      toast(e instanceof Error ? e.message : "原文件暂不可用");
    }
  }
  // 人工调整受众集合；传 undefined 表示恢复"按规则"。
  function setAudiences(next?: string[]) {
    const saved = update(
      (s) => {
        const a = s.assets.find((a) => a.id === id)!;
        const target = a.versions.find((x) => x.number === v!.number)!;
        if (next) {
          target.fields ||= {};
          target.fields[VISIBILITY_FIELD] = next
            .map(
              (name) =>
                s.tags.find(
                  (t) => t.parentId === VISIBILITY_FIELD && t.name === name,
                )?.id,
            )
            .filter((id): id is string => !!id);
          target.fieldsManual = [
            ...new Set([...(target.fieldsManual || []), VISIBILITY_FIELD]),
          ];
        } else {
          target.fieldsManual = target.fieldsManual?.filter(
            (dim) => dim !== VISIBILITY_FIELD,
          );
          applyRules(target, s.tags, s.rules);
        }
        a.updatedAt = now();
      },
      {
        action: "修改内容标签",
        object: asset!.code,
        category: "标签",
        detail: `用户可见范围 → ${
          next
            ? audienceLabel(
                next,
                state.tags.filter(
                  (t) => t.parentId === VISIBILITY_FIELD && t.enabled,
                ).length,
              )
            : "按规则"
        }`,
      },
      "tags",
    );
    if (saved) toast("可见范围已更新。");
  }
  function openEdit() {
    setTitle(v!.title);
    setSummary(v!.summary);
    setCover(v!.cover || "");
    setThumbnail(v!.thumbnail || "");
    setVideos(v!.videos ? structuredClone(v!.videos) : undefined);
    setExpiry(v!.expiry || "");
    setModal("edit");
  }
  function saveMeta() {
    if (!title.trim()) return toast("请输入内容标题");
    const saved = update(
      (s) => {
        const a = s.assets.find((a) => a.id === id)!;
        const target = a.versions.find((v) => v.number === number)!;
        target.title = title.trim();
        target.summary = summary;
        target.cover = cover;
        target.thumbnail = thumbnail;
        target.videos = videos;
        if (target.approval.mode === "exempt") target.expiry = expiry;
        a.updatedAt = now();
      },
      {
        action: "修改内容信息",
        object: asset!.code,
        detail: "更新标题、摘要与封面，保留文件版本。",
      },
      "edit",
    );
    if (saved) {
      setModal("");
      toast("内容信息已保存");
    }
  }
  return (
    <div className="content-detail-v3">
      <button className="back-link" onClick={() => go("library")}>
        <ArrowLeft size={16} />
        返回内容库
      </button>
      <PageHeader
        title={v.title}
        description={`${asset.code} · ${v.source} · ${dateLabel(v.createdAt)}归档`}
        action={
          <>
            <Button
              icon={<Info size={16} />}
              onClick={() => setModal("basic-info")}
            >
              内容信息
            </Button>
            <Button
              icon={<ShieldCheck size={16} />}
              onClick={() => setModal("approval-info")}
            >
              审批信息
            </Button>
            <Button
              icon={<Download size={17} />}
              disabled={!can("export")}
              onClick={original}
            >
              下载原文件
            </Button>
            <Button
              icon={<Upload size={17} />}
              disabled={!can("upload") || asset.lifecycle === "已作废"}
              onClick={() => go("upload?asset=" + id)}
            >
              上传新版本
            </Button>
            <Button
              variant="primary"
              icon={<Send size={16} />}
              disabled={
                !can("publish") || historical || asset.lifecycle !== "正常"
              }
              onClick={() => go(`publishing?asset=${id}&create=1`)}
            >
              提交发布
              <PhaseTwoNote />
            </Button>
          </>
        }
      />
      <div className="detail-status-line">
        <div>
          <select
            aria-label="查看版本"
            value={number}
            onChange={(e) => {
              setNumber(Number(e.target.value));
              setPage(1);
              setPageCount(0);
            }}
          >
            {[...asset.versions].reverse().map((v) => (
              <option key={v.number} value={v.number}>
                V{v.number}.0 ·{" "}
                {v.number === asset.current ? "当前版本" : "历史版本"}
              </option>
            ))}
          </select>
          <Badge>{expiryStatus(v)}</Badge>
          <Badge>{fileParsingFailed(v) ? "解析失败" : v.process}</Badge>
          {historical ? <span className="muted">历史版本只读</span> : null}
          {asset.lifecycle === "已作废" ? (
            <Badge tone="red">已作废</Badge>
          ) : null}
        </div>
        <div className="actions">
          {can("audit") ? (
            <Button
              variant="ghost"
              onClick={() =>
                go(`audit?object=${encodeURIComponent(asset.code)}`)
              }
            >
              操作审计
            </Button>
          ) : null}
          <Button
            variant="ghost"
            icon={<History size={16} />}
            onClick={() => setModal("history")}
          >
            版本历史
          </Button>
          <Button variant="ghost" onClick={() => go(`publishing?asset=${id}`)}>
            发布记录
            <PhaseTwoNote />（
            {(state.publications || []).filter((p) => p.assetId === id).length}
            ）
          </Button>
          <Button
            variant="ghost"
            icon={<Download size={16} />}
            disabled={!can("export")}
            onClick={() => setModal("export")}
          >
            导出内容包
          </Button>
        </div>
      </div>
      {fileParsingFailed(v) ? (
        <Note tone="amber">
          <Button
            variant="ghost"
            icon={<RotateCw size={15} />}
            disabled={!editable}
            onClick={reparse}
          >
            重新解析
          </Button>
        </Note>
      ) : null}
      {["排队中", "处理中"].includes(v.process) ||
      ["待打标", "打标中"].includes(v.tagStatus) ? (
        <div className="note" role="status">
          文件解析：{v.process} · 标签识别：{v.tagStatus}
        </div>
      ) : null}
      <div className="detail-material-tags panel">
        <div>
          <Tags size={17} />
          <strong>材料标签</strong>
        </div>
        <div className="tag-chips">
          {v.tags
            .filter((b) => !b.page)
            .map((b) => (
              <span className="tag-chip" key={b.tagId}>
                {bindingName(b, state.tags)}
                {state.tags.some(
                  (t) => t.id === b.tagId && !availableTag(state.tags, t),
                )
                  ? "（已停用）"
                  : ""}
              </span>
            ))}
          {!v.tags.some((b) => !b.page) ? (
            <span className="muted">尚未添加材料标签</span>
          ) : null}
        </div>
        <div className="tag-chips">
          <span className="muted">用户可见范围：</span>
          <Badge tone="blue">
            {audienceLabel(
              audiencesOf(v, state.tags),
              state.tags.filter(
                (t) => t.parentId === VISIBILITY_FIELD && t.enabled,
              ).length,
            )}
          </Badge>
          {v.fieldsManual?.includes(VISIBILITY_FIELD) ? (
            <small className="muted">人工设置</small>
          ) : (
            <small className="muted">按派生规则</small>
          )}
        </div>
        <Button
          variant="ghost"
          disabled={!can("tags") || historical || asset.lifecycle !== "正常"}
          onClick={() => setModal("material-tags")}
        >
          编辑标签
        </Button>
      </div>
      <div className={`reading-workspace ${paginated(v) ? "" : "is-single"}`}>
        {paginated(v) ? (
          <nav className="page-rail" aria-label="文档页面导航">
            {Array.from({ length: pageCount || v.pages }, (_, i) => i + 1).map(
              (n) => (
                <button
                  key={n}
                  className={`page-rail-item ${page === n ? "active" : ""}`}
                  aria-label={`查看第 ${n} 页`}
                  aria-current={page === n ? "page" : undefined}
                  onClick={() => setPage(n)}
                >
                  <PageCanvas version={v} page={n} thumbnail />
                  <div className="page-rail-tags">
                    {v.tags
                      .filter((b) => b.page === n)
                      .slice(0, 2)
                      .map((b) => (
                        <small key={b.tagId}>
                          {bindingName(b, state.tags)}
                        </small>
                      ))}
                  </div>
                  <span>第 {n} 页</span>
                </button>
              ),
            )}
          </nav>
        ) : null}
        <DocumentReader
          key={`${id}-${v.number}`}
          version={v}
          page={page}
          onPage={setPage}
          onCount={setPageCount}
        />
        {paginated(v) ? (
          <aside className="page-tags-panel panel">
            <div className="page-tag-heading">
              <div>
                <h2>{paginated(v) ? `第 ${page} 页标签` : "内容标签"}</h2>
              </div>
            </div>
            <TagPanel
              key={`page-tags-${v.number}-${page}`}
              assetId={id}
              versionNumber={v.number}
              page={paginated(v) ? page : undefined}
            />
          </aside>
        ) : null}
      </div>
      {modal === "material-tags" ? (
        <Dialog drawer title="材料标签" onClose={() => setModal("")}>
          <p className="muted">作用于整份内容，不影响各页标签。</p>
          <Field label="用户可见范围（字段，取值可多选，规则可推导默认值）">
            <div className="audience-options">
              {state.tags
                .filter(
                  (t) => t.parentId === VISIBILITY_FIELD && t.enabled,
                )
                .sort((a, b) => (a.order || 0) - (b.order || 0))
                .map((option) => {
                  const current = audiencesOf(v, state.tags);
                  const checked = current.includes(option.name);
                  return (
                    <label
                      key={option.id}
                      className={`audience-option ${checked ? "on" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={
                          !can("tags") ||
                          historical ||
                          asset.lifecycle !== "正常"
                        }
                        onChange={(event) =>
                          setAudiences(
                            event.target.checked
                              ? [...current, option.name]
                              : current.filter((a) => a !== option.name),
                          )
                        }
                      />
                      {option.name}
                    </label>
                  );
                })}
            </div>
            <p className="audience-hint">
              {v.fieldsManual?.includes(VISIBILITY_FIELD) ? "人工设置" : "按规则推导"}
              ，规则建议：
              {audienceLabel(
                (() => {
                  const probe = structuredClone(v);
                  probe.fieldsManual = undefined;
                  applyRules(probe, state.tags, state.rules);
                  return audiencesOf(probe, state.tags);
                })(),
                state.tags.filter(
                  (t) => t.parentId === VISIBILITY_FIELD && t.enabled,
                ).length,
              )}
              {v.fieldsManual?.includes(VISIBILITY_FIELD) ? (
                <Button variant="ghost" onClick={() => setAudiences(undefined)}>
                  恢复按规则
                </Button>
              ) : null}
            </p>
          </Field>
          <TagPanel assetId={id} versionNumber={v.number} />
        </Dialog>
      ) : null}
      {modal === "basic-info" ? (
        <Dialog drawer title="内容信息" onClose={() => setModal("")}>
          <dl className="detail-meta">
            <dt>内容编号</dt>
            <dd>{asset.code}</dd>
            <dt>当前查看</dt>
            <dd>V{v.number}.0</dd>
            <dt>内容类型</dt>
            <dd>{v.kind}</dd>
            <dt>来源</dt>
            <dd>{v.source}</dd>
            <dt>上传时间</dt>
            <dd>
              {v.uploadedAt ? dateLabel(v.uploadedAt) : "历史内容，未单独记录"}
            </dd>
            <dt>结果确认</dt>
            <dd>
              {v.confirmedAt
                ? `${state.users.find((u) => u.id === v.confirmedBy)?.name || "已失效账号"} · ${dateLabel(v.confirmedAt)}`
                : "历史内容，未记录人工确认"}
            </dd>
            <dt>归档时间</dt>
            <dd>{dateLabel(v.archivedAt || v.createdAt)}</dd>
            <dt>有效期</dt>
            <dd>{v.approval.snapshot?.expiry || v.expiry || "未设置"}</dd>
            <dt>用户可见范围</dt>
            <dd>
              {audienceLabel(
              audiencesOf(v, state.tags),
              state.tags.filter(
                (t) => t.parentId === VISIBILITY_FIELD && t.enabled,
              ).length,
            )}
              {v.fieldsManual?.includes(VISIBILITY_FIELD) ? " · 人工设置" : ""}
            </dd>
          </dl>
          <h3>摘要</h3>
          <p className="summary-text">{v.summary || "未填写"}</p>
          <h3>展示素材</h3>
          <ContentMedia value={v} />
          {v.sourceUrl ? (
            <a href={v.sourceUrl} target="_blank" rel="noreferrer">
              查看来源原文
            </a>
          ) : null}
          <div className="actions">
            {editable ? <Button onClick={openEdit}>编辑内容信息</Button> : null}
            {can("void") && asset.lifecycle === "正常" ? (
              <Button variant="danger" onClick={() => setModal("void")}>
                作废内容
              </Button>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      {modal === "approval-info" ? (
        <Dialog drawer title="审批信息" onClose={() => setModal("")}>
          <Badge>{approvalLabel(v.approval)}</Badge>
          {v.approval.snapshot ? (
            <>
              <dl className="detail-meta">
                <dt>审批编号</dt>
                <dd>{v.approval.snapshot.number}</dd>
                <dt>有效期</dt>
                <dd>{v.approval.snapshot.expiry}</dd>
                <dt>OCR 核对</dt>
                <dd>
                  {ocrWarnings(v.approval.snapshot).length
                    ? v.approval.snapshot.confirmed
                      ? "存在差异 · 已人工确认"
                      : "存在差异"
                    : "一致"}
                </dd>
              </dl>
              {can("evidence") && shot ? (
                <button
                  className="approval-shot-button"
                  onClick={() => setModal("evidence")}
                >
                  <AssetImage
                    src={shot.fileKey ? "local:" + shot.fileKey : shot.url}
                    alt="审批截图"
                    className="approval-read-image"
                  />
                </button>
              ) : null}
              {v.approval.snapshot.confirmation ? (
                <p className="inline-warning">
                  {v.approval.snapshot.confirmation}
                </p>
              ) : null}
            </>
          ) : (
            <p className="summary-text">
              {v.approval.mode === "exempt"
                ? "此内容无需登记审批信息。"
                : "请补充审批信息，或按权限选择无需登记。"}
            </p>
          )}
          {editable ? (
            <Button onClick={() => setModal("approval")}>
              {v.approval.mode === "registered"
                ? "修改审批信息"
                : "设置审批信息"}
            </Button>
          ) : null}
        </Dialog>
      ) : null}
      {modal === "approval" ? (
        <ApprovalEditor assetIds={[id]} onClose={() => setModal("")} />
      ) : null}
      {modal === "export" ? (
        <ExportDialog
          assets={[asset]}
          versions={{ [id]: v.number }}
          onClose={() => setModal("")}
        />
      ) : null}
      {modal === "history" ? (
        <Dialog drawer title="版本历史" onClose={() => setModal("")}>
          <div className="version-timeline">
            {[...asset.versions].reverse().map((version) => (
              <div key={version.number}>
                <span className="version-marker">V{version.number}.0</span>
                <section>
                  <h3>{version.title}</h3>
                  <p>{version.changeNote || "归档内容"}</p>
                  <small>{dateLabel(version.createdAt)}</small>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNumber(version.number);
                      setPage(1);
                      setPageCount(0);
                      setModal("");
                    }}
                  >
                    查看此版本
                  </Button>
                </section>
              </div>
            ))}
          </div>
        </Dialog>
      ) : null}
      {modal === "edit" ? (
        <Dialog
          drawer
          title="编辑内容信息"
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button
                variant="primary"
                disabled={mediaBusy}
                onClick={saveMeta}
              >
                {mediaBusy ? "素材保存中…" : "保存信息"}
              </Button>
            </>
          }
        >
          <Field label="内容标题" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="摘要">
            <textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
          {v.approval.mode === "exempt" ? (
            <Field label="内容有效期（选填）">
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="封面（选填）">
            <CoverPicker value={cover} onChange={setCover} label="上传封面" />
          </Field>
          <Field label="缩略图（选填）">
            <CoverPicker
              value={thumbnail}
              onChange={setThumbnail}
              label="上传缩略图"
            />
          </Field>
          <VideoListEditor
            videos={videos}
            onChange={setVideos}
            compact
            onBusyChange={setMediaBusy}
          />
        </Dialog>
      ) : null}
      {modal === "evidence" && can("evidence") && shot ? (
        <Dialog title="审批截图与识别结果" wide onClose={() => setModal("")}>
          <AssetImage
            src={shot.fileKey ? "local:" + shot.fileKey : shot.url}
            className="approval-full-image"
            alt="审批截图"
          />
          <dl className="detail-meta">
            <dt>识别编号</dt>
            <dd>{shot.number || "无法识别"}</dd>
            <dt>识别有效期</dt>
            <dd>{shot.expiry || "无法识别"}</dd>
            <dt>识别标题</dt>
            <dd>{shot.title || "无法识别"}</dd>
          </dl>
        </Dialog>
      ) : null}
      {modal === "void" ? (
        <Dialog
          title="作废内容"
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button
                variant="danger"
                onClick={() => {
                  update(
                    (s) => {
                      const a = s.assets.find((a) => a.id === id)!;
                      a.lifecycle = "已作废";
                      a.updatedAt = now();
                    },
                    { action: "作废内容", object: asset.code },
                    "void",
                  );
                  setModal("");
                }}
              >
                确认作废
              </Button>
            </>
          }
        >
          <p className="dialog-intro">
            内容作废后将不再出现在正常列表中，历史版本仍可查看，作废后不可恢复。
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
