import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FilePlus2,
  Link2,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { useCMS } from "../store";
import {
  canRole,
  current,
  go,
  kindOf,
  now,
  ocrWarnings,
  safePublicUrl,
  uid,
  visibleFor,
  type CredentialRevision,
  type Version,
} from "../model";
import { makeDemoVersion } from "../seed";
import { appendUploadVersions, planUploadVersions } from "../upload";
import { loadBlob, putFiles } from "../storage";
import {
  acceptApproval,
  approvalDraft,
  approvalFieldErrors,
  ApprovalForm,
  persistApproval,
} from "../components/ApprovalEditor";
import {
  AssetImage,
  Badge,
  Button,
  CoverPicker,
  Dialog,
  Empty,
  Field,
  PageHeader,
  Tabs,
} from "../components/ui";

interface Item {
  id: string;
  v: Version;
  blob?: Blob;
  size: string;
  error?: string;
}
const sizeLabel = (size: number) =>
  size < 1024 * 1024
    ? `${Math.ceil(size / 1024)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
function fileVersion(fileName: string, kind: Version["kind"]): Version {
  return {
    number: 1,
    title: fileName.replace(/\.[^.]+$/, ""),
    kind,
    fileName,
    source: "手动上传",
    summary: "",
    content: [],
    pages: 1,
    createdAt: now(),
    process: "排队中",
    tagStatus: "待打标",
    tags: [],
    approval: { mode: "pending" },
  };
}

export default function UploadWizard() {
  const cms = useCMS();
  const latest = useRef(cms);
  latest.current = cms;
  const assetId = new URLSearchParams(location.hash.split("?")[1]).get("asset");
  const existing = cms.assets.find((a) => a.id === assetId);
  const [baseNumber] = useState(existing?.current);
  const [actorId] = useState(cms.user?.id);
  const [tab, setTab] = useState("files");
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState("");
  const [mode, setMode] = useState<"registered" | "exempt">("registered");
  const [draft, setDraft] = useState<CredentialRevision>(() =>
    approvalDraft(
      existing ? current(existing).approval.snapshot : undefined,
      existing ? current(existing).approval.credentialId : undefined,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [detailId, setDetailId] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const dirty = useRef(false);
  const leaveGuard = useRef<() => boolean>(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const guard = () => {
      if (
        locked.current ||
        root.current?.querySelector('[data-approval-busy="true"]')
      ) {
        latest.current.toast("文件正在保存，请稍候。");
        return false;
      }
      return (
        !dirty.current ||
        window.confirm("本批次尚未归档，离开后需要重新添加。确定离开吗？")
      );
    };
    leaveGuard.current = guard;
    window.cmsLeaveGuard = guard;
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current || locked.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      active.current = false;
      if (window.cmsLeaveGuard === guard) window.cmsLeaveGuard = undefined;
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const allowed =
    cms.user?.id === actorId &&
    cms.can("upload") &&
    (!assetId || (!!existing && existing.lifecycle === "正常"));
  function patch(id: string, changes: Partial<Version>) {
    dirty.current = true;
    setRowErrors({});
    setItems((list) =>
      list.map((item) =>
        item.id === id ? { ...item, v: { ...item.v, ...changes } } : item,
      ),
    );
  }
  function focusError() {
    requestAnimationFrame(() =>
      (
        root.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ||
        root.current?.querySelector<HTMLElement>(
          ".field-error input,.field-error textarea,.field-error select",
        )
      )?.focus(),
    );
  }
  async function readFiles(files: File[]) {
    const next: Item[] = [];
    for (const file of files) {
      const kind = kindOf(file.name, file.type);
      const v = fileVersion(file.name, kind || "PDF");
      const item: Item = {
        id: uid("upload"),
        v,
        blob: file,
        size: sizeLabel(file.size),
        error: kind
          ? undefined
          : "不支持该格式，请移除此项；其他文件可继续归档。",
      };
      if (kind) {
        try {
          if (!file.size) throw new Error("文件为空");
          const bytes = await file.arrayBuffer();
          if (kind === "PDF") {
            const { PDFDocument } = await import("pdf-lib");
            v.pages = (await PDFDocument.load(bytes)).getPageCount();
          }
          v.fileHash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          if (kind === "网页") {
            const dom = new DOMParser().parseFromString(
              await file.text(),
              "text/html",
            );
            dom
              .querySelectorAll(
                "script,style,noscript,iframe,object,embed,template",
              )
              .forEach((node) => node.remove());
            v.content = [
              dom.body.textContent?.trim() || "该 HTML 文件没有可提取的正文。",
            ];
            v.summary = v.content[0].slice(0, 100);
          }
        } catch {
          item.error = "文件无法读取或格式无效，请移除后重新添加。";
        }
      }
      next.push(item);
    }
    return next;
  }
  async function addFiles(files: File[]) {
    if (locked.current || !allowed || !files.length) return;
    if (assetId && files.length !== 1)
      return setError("上传新版本一次只能添加一个文件。");
    locked.current = true;
    dirty.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await readFiles(files);
      if (active.current)
        setItems((list) => (assetId ? next : [...list, ...next]));
    } catch {
      if (active.current) setError("文件读取失败，请重新添加。");
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function addDemo() {
    if (locked.current || !allowed) return;
    locked.current = true;
    dirty.current = true;
    setBusy(true);
    setError("");
    try {
      const files = await Promise.all(
        (assetId ? [0] : [0, 1, 6]).map(async (index) => {
          const v = makeDemoVersion(index);
          const blob = await loadBlob(undefined, v.fileUrl);
          return new File([blob], v.fileName, { type: blob.type });
        }),
      );
      const next = await readFiles(files);
      next.forEach((item) => {
        item.v.source = "示例文件上传";
      });
      if (active.current)
        setItems((list) => (assetId ? next : [...list, ...next]));
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : "示例文件加载失败。");
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function addLinks() {
    if (locked.current || !allowed) return;
    const urls = links
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!urls.length || urls.some((url) => !safePublicUrl(url)))
      return setError("请逐行填写不含账号密码的 HTTP / HTTPS 公开链接。");
    if (assetId && urls.length !== 1)
      return setError("上传新版本一次只能添加一个公开链接。");
    const next: Item[] = urls.map((url) => {
      const v = fileVersion("公开链接内容.html", "网页");
      v.source = "公开链接";
      v.sourceUrl = url;
      v.content = [
        "原型仅模拟采集流程并保存来源链接，未获取原站正文或图片；可上传 HTML 原文件。",
      ];
      return { id: uid("upload"), v, size: "公开链接" };
    });
    dirty.current = true;
    setItems((list) => (assetId ? next : [...list, ...next]));
    setLinks("");
    setError("");
  }
  async function archive(accepted?: CredentialRevision) {
    if (locked.current) return;
    const ctx = latest.current;
    if (!allowed || !ctx.can("upload"))
      return setError("当前角色不能上传，或内容已作废、不可访问。");
    if (mode === "exempt" && !ctx.can("exempt"))
      return setError("当前角色没有免登记权限。");
    if (root.current?.querySelector('[data-approval-busy="true"]'))
      return setError("请等待审批截图保存完成。");
    if (!items.length) {
      setError("请先添加至少一份内容。");
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLInputElement>('input[type="file"]')
          ?.focus(),
      );
      return;
    }
    const invalid: Record<string, string> = {};
    for (const item of items) {
      if (!item.v.title.trim()) invalid[item.id] = "内容标题必填";
      else if (item.error) invalid[item.id] = item.error;
      else if (!item.blob && !item.v.sourceUrl)
        invalid[item.id] = "请添加原文件或公开链接。";
      else if (item.v.sourceUrl && !safePublicUrl(item.v.sourceUrl))
        invalid[item.id] = "公开链接无效，请移除此项。";
    }
    const value = accepted || draft;
    const fields = mode === "registered" ? approvalFieldErrors(value) : {};
    setRowErrors(invalid);
    setErrors(fields);
    setError("");
    if (Object.keys(invalid).length || Object.keys(fields).length) {
      setError("请修正标出的内容或审批信息。");
      focusError();
      return;
    }
    if (
      mode === "registered" &&
      ocrWarnings(value).length > 0 &&
      !value.confirmed
    ) {
      setConfirming(true);
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      if (mode === "registered")
        await loadBlob(value.evidence[0].fileKey, value.evidence[0].url);
      const files = items
        .filter((item) => item.blob)
        .map((item) => ({ id: item.id, key: uid("file"), blob: item.blob! }));
      if (files.length) await putFiles(files);
      let createdCount = 0;
      let updatedCount = 0;
      const success = ctx.update(
        (s) => {
          const actor = s.users.find((user) => user.id === s.userId);
          const role = s.roles.find((role) => role.id === actor?.roleId);
          if (
            !actor ||
            actor.id !== actorId ||
            !canRole(role, "upload") ||
            (mode === "exempt" && !canRole(role, "exempt"))
          )
            throw new Error("权限已变化，本批次未归档。");
          const visible = visibleFor(s, actor, role);
          const target = assetId
            ? visible.find((asset) => asset.id === assetId)
            : undefined;
          if (
            assetId &&
            (!target ||
              target.lifecycle !== "正常" ||
              target.current !== baseNumber ||
              items.length !== 1)
          )
            throw new Error(
              "当前内容版本已变化或不可编辑，请返回详情核对后重新上传。",
            );
          const targets = planUploadVersions(visible, items, assetId);
          createdCount = targets.filter((target) => target.newAsset).length;
          updatedCount = targets.length - createdCount;
          const ids = [...new Set(targets.map((target) => target.assetId))];
          const scope = canRole(role, "edit")
            ? s.credentials.map((c) => c.id)
            : [];
          const approval = persistApproval(
            s,
            mode === "registered" ? value : null,
            actor,
            ids,
            scope,
          );
          const taskItems = appendUploadVersions(
            s,
            items.map((item) => ({
              id: item.id,
              v: {
                ...item.v,
                fileKey: files.find((file) => file.id === item.id)?.key,
                fileUrl: undefined,
              },
            })),
            targets,
            approval,
            actor.id,
          );
          s.tasks.unshift({
            id: uid("task"),
            name: `${items.length} 份内容 · 解析与自动打标`,
            type: "解析与打标",
            status: "处理中",
            items: taskItems,
            createdAt: now(),
            attempts: 1,
            finishAt: Date.now() + 3500,
          });
        },
        {
          action: assetId ? "上传新版本" : "批量归档内容",
          object: existing?.code || `${items.length} 份内容`,
          detail:
            mode === "exempt"
              ? "无需登记审批信息。"
              : `本次内容使用审批编号 ${value.number.trim()}、有效期及一张截图。`,
        },
        "upload",
      );
      if (!success) {
        setError("归档未保存，请检查浏览器存储和权限后重试；历史内容未变更。");
        return;
      }
      dirty.current = false;
      if (window.cmsLeaveGuard === leaveGuard.current)
        window.cmsLeaveGuard = undefined;
      ctx.toast(
        `已新增 ${createdCount} 份内容${updatedCount ? `，创建 ${updatedCount} 个新版本` : ""}，解析与打标在后台继续。`,
      );
      go(assetId ? `content/${assetId}` : "library?q=");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "归档失败，请重试；历史内容未变更。",
      );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const detail = items.find((item) => item.id === detailId);
  const uploadTargets = allowed
    ? planUploadVersions(cms.assets, items, assetId)
    : [];
  const newCount = uploadTargets.filter((target) => target.newAsset).length;
  const versionCount = uploadTargets.length - newCount;
  if (!allowed)
    return (
      <Empty
        title="无法添加内容"
        description="当前角色没有上传权限，或无权访问这份正常内容。"
      />
    );
  return (
    <div ref={root}>
      <button
        className="back-link"
        onClick={() => go(assetId ? `content/${assetId}` : "library")}
      >
        <ArrowLeft size={16} />
        返回{assetId ? "内容详情" : "内容库"}
      </button>
      <PageHeader
        title={assetId ? "上传新版本" : "新增内容"}
        description={
          existing
            ? `${existing.code} · 当前 V${existing.current}；归档成功即切换新版本，历史记录保留。`
            : "添加文件或公开链接，完成审批登记后自动归档。"
        }
      />
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <fieldset disabled={busy}>
        <div className="upload-layout">
          <section className="panel upload-main">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: "files", label: "上传文件" },
                { key: "links", label: "公开链接" },
              ]}
            />
            {tab === "files" ? (
              <label
                className="upload-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void addFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <UploadCloud size={28} />
                <strong>
                  {busy ? "正在读取文件…" : "拖拽文件到这里，或点击选择"}
                </strong>
                <small>
                  PDF、PPT、Word、图片、视频、HTML ·{" "}
                  {assetId ? "仅添加一个文件" : "支持批量添加"}
                </small>
                <input
                  aria-label="上传内容文件"
                  type="file"
                  multiple={!assetId}
                  accept=".pdf,.ppt,.pptx,.doc,.docx,.html,.htm,image/*,video/*"
                  onChange={(event) => {
                    void addFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                />
              </label>
            ) : (
              <div className="link-entry">
                <Field label="公开链接">
                  <textarea
                    aria-label="公开链接"
                    rows={3}
                    value={links}
                    onChange={(event) => {
                      dirty.current = true;
                      setLinks(event.target.value);
                    }}
                    placeholder="每行一条 HTTP / HTTPS 公开链接"
                  />
                </Field>
                <small className="muted">
                  原型仅模拟采集流程并保存来源链接，不获取原站正文或图片。
                </small>
                <Button
                  type="button"
                  icon={<Link2 size={15} />}
                  onClick={addLinks}
                >
                  添加链接
                </Button>
              </div>
            )}
            <div className="upload-toolbar">
              <strong>已添加 {items.length} 份</strong>
              <Button
                type="button"
                icon={<FilePlus2 size={15} />}
                onClick={() => void addDemo()}
              >
                添加示例文件
              </Button>
            </div>
            <div className="upload-file-list">
              {items.map((item, index) => (
                <div
                  className={`file-row ${rowErrors[item.id] ? "field-error" : ""}`}
                  key={item.id}
                >
                  <div className="file-meta">
                    <input
                      aria-label={`标题：${item.v.fileName}`}
                      aria-invalid={
                        !!rowErrors[item.id] && !item.v.title.trim()
                      }
                      value={item.v.title}
                      onChange={(event) =>
                        patch(item.id, { title: event.target.value })
                      }
                      placeholder="内容标题（必填）"
                    />
                    <small>
                      {item.error && !kindOf(item.v.fileName)
                        ? "不支持的格式"
                        : item.v.kind}{" "}
                      · {item.size}
                      {item.v.kind === "PDF" && !item.error
                        ? ` · ${item.v.pages} 页`
                        : ""}
                    </small>
                    {item.v.sourceUrl ? (
                      <small>{item.v.sourceUrl}</small>
                    ) : null}
                    {item.error || rowErrors[item.id] ? (
                      <small className="error-text">
                        {item.error || rowErrors[item.id]}
                      </small>
                    ) : null}
                    {uploadTargets[index] && !uploadTargets[index].newAsset ? (
                      <small className="upload-version-hint">
                        {assetId ? "更新当前内容" : "检测到相同内容"} · 将保存为
                        V{uploadTargets[index].number}
                        <span>
                          {uploadTargets[index].code || "本次上传"} ·{" "}
                          {uploadTargets[index].title}
                        </span>
                      </small>
                    ) : null}
                  </div>
                  {item.v.thumbnail || item.v.cover ? (
                    <AssetImage
                      src={item.v.thumbnail || item.v.cover}
                      alt={item.v.title}
                      className="custom-cover-preview"
                    />
                  ) : null}
                  <button
                    type="button"
                    className="text-link file-info-button"
                    aria-label={`编辑${item.v.fileName}信息`}
                    onClick={() => setDetailId(item.id)}
                  >
                    信息
                  </button>
                  <Badge
                    tone={
                      item.error
                        ? "red"
                        : uploadTargets[index]?.newAsset
                          ? "gray"
                          : "blue"
                    }
                  >
                    {item.error
                      ? "需处理"
                      : uploadTargets[index]?.newAsset
                        ? "新增内容"
                        : "创建新版本"}
                  </Badge>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`移除${item.v.fileName}`}
                    aria-invalid={!!rowErrors[item.id] && !!item.error}
                    onClick={() => {
                      dirty.current = true;
                      setRowErrors({});
                      setItems((list) =>
                        list.filter((other) => other.id !== item.id),
                      );
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </div>
            {!items.length ? (
              <p className="muted">
                添加文件或公开链接后，在这里编辑内容标题。
              </p>
            ) : null}
          </section>
          <aside className="panel batch-approval">
            <h2>审批信息</h2>
            <p className="approval-scope-hint">
              应用于本次上传的 {items.length} 份内容
              {versionCount > 0 ? (
                <span className="upload-approval-version-note">
                  新版本采用本次审批信息；编号与原版本不同时，以本次填写为准。
                </span>
              ) : null}
            </p>
            <div className="batch-mode">
              <label className={mode === "registered" ? "active" : ""}>
                <input
                  type="radio"
                  name="batch-approval-mode"
                  checked={mode === "registered"}
                  onChange={() => {
                    dirty.current = true;
                    setMode("registered");
                    setConfirming(false);
                  }}
                />
                <span>
                  需要登记<small>填写审批编号并上传截图</small>
                </span>
              </label>
              <label className={mode === "exempt" ? "active" : ""}>
                <input
                  type="radio"
                  name="batch-approval-mode"
                  checked={mode === "exempt"}
                  disabled={!cms.can("exempt")}
                  onChange={() => {
                    dirty.current = true;
                    setMode("exempt");
                    setErrors({});
                    setConfirming(false);
                  }}
                />
                <span>
                  不需要登记
                  <small>
                    {cms.can("exempt")
                      ? "免填审批信息，不执行 OCR"
                      : "当前角色没有免登记权限"}
                  </small>
                </span>
              </label>
            </div>
            {mode === "registered" ? (
              <ApprovalForm
                value={draft}
                errors={errors}
                onChange={(value) => {
                  dirty.current = true;
                  setDraft(value);
                  setErrors({});
                  setConfirming(false);
                }}
              />
            ) : (
              <p className="muted">
                无需填写审批编号或上传截图，不执行 OCR 校验。
              </p>
            )}
          </aside>
        </div>
      </fieldset>
      <div className="upload-submit-bar">
        <span>
          新增 {newCount} 份内容
          {versionCount > 0 ? ` · 创建 ${versionCount} 个新版本` : ""}
          <small>
            归档后自动解析并识别标签，历史版本和已提交的发布记录保留。
          </small>
        </span>
        <Button
          variant="primary"
          disabled={busy || !items.length}
          icon={busy ? <Loader2 size={16} className="spin" /> : undefined}
          onClick={() => void archive()}
        >
          {busy ? "正在保存…" : `上传并归档 ${items.length} 份`}
        </Button>
      </div>
      {detail ? (
        <Dialog
          title="补充内容信息（选填）"
          onClose={() => {
            if (!locked.current) setDetailId(undefined);
          }}
          footer={
            <Button disabled={busy} onClick={() => setDetailId(undefined)}>
              完成
            </Button>
          }
        >
          <Field label="摘要">
            <textarea
              aria-label="内容摘要"
              rows={3}
              value={detail.v.summary}
              onChange={(event) =>
                patch(detail.id, { summary: event.target.value })
              }
            />
          </Field>
          <Field label="封面">
            <CoverPicker
              value={detail.v.cover || ""}
              label="上传封面"
              onChange={(value) => patch(detail.id, { cover: value })}
            />
          </Field>
          <Field label="缩略图">
            <CoverPicker
              value={detail.v.thumbnail || ""}
              label="上传缩略图"
              onChange={(value) => patch(detail.id, { thumbnail: value })}
            />
          </Field>
        </Dialog>
      ) : null}
      {confirming ? (
        <Dialog
          title="确认上传信息"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>返回核对</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const value =
                    mode === "registered" && ocrWarnings(draft).length
                      ? acceptApproval(draft)
                      : draft;
                  setDraft(value);
                  setConfirming(false);
                  void archive(value);
                }}
              >
                确认并上传
              </Button>
            </>
          }
        >
          {mode === "registered" && ocrWarnings(draft).length ? (
            <section>
              <h3>核对审批信息</h3>
              <dl className="detail-meta">
                <dt>填写编号</dt>
                <dd>{draft.number}</dd>
                <dt>识别编号</dt>
                <dd>{draft.evidence[0]?.number || "无法识别"}</dd>
                <dt>填写有效期</dt>
                <dd>{draft.expiry}</dd>
                <dt>识别有效期</dt>
                <dd>{draft.evidence[0]?.expiry || "无法识别"}</dd>
              </dl>
              <p className="permission-note">
                确认后按填写值保存，原始识别结果和人工确认记录保留。
              </p>
            </section>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
