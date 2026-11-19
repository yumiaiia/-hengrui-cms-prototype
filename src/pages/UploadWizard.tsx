import { useEffect, useState } from "react";
import {
  UploadCloud,
  FilePlus2,
  Link2,
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  ShieldCheck,
  Plus,
  ImagePlus,
  AlertTriangle,
  Files,
  Loader2,
} from "lucide-react";
import { useCMS } from "../store";
import {
  current,
  credentialLatest,
  credentialErrors,
  ocrWarnings,
  go,
  kindOf,
  now,
  uid,
  safePublicUrl,
  type Version,
  type Credential,
  type CredentialRevision,
  type Evidence,
} from "../model";
import { demoCredential, makeDemoVersion } from "../seed";
import { loadBlob, putFiles } from "../storage";
import {
  CoverPicker,
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Note,
  PageHeader,
} from "../components/ui";
interface Item {
  id: string;
  v: Version;
  blob?: Blob;
  error?: string;
  duplicate?: string;
  acknowledged?: boolean;
  size: string;
  demo?: boolean;
}
const blankCredential = (): CredentialRevision => ({
  revision: 1,
  number: "",
  title: "",
  expiry: "",
  evidence: [],
  confirmed: false,
  updatedAt: now(),
});
async function demoVideo() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d")!;
  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  return new Promise<Blob>((resolve) => {
    let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = "#102c46";
      context.fillRect(0, 0, 640, 360);
      context.fillStyle = "#ffffff";
      context.font = "24px sans-serif";
      context.fillText("CMS 演示视频", 220, 150);
      context.font = "14px sans-serif";
      context.fillText("本地生成的示例素材，不包含真实医学内容", 160, 190);
      context.fillStyle = "#19afc0";
      context.fillRect(120, 240, ++frame * 25, 4);
    }, 80);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: "video/webm" }));
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 1200);
  });
}
export default function UploadWizard() {
  const cms = useCMS();
  const { assets, state, user, can, update, toast, notify } = cms;
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const assetId = params.get("asset");
  const existing = assets.find((a) => a.id === assetId);
  const baseNumber = existing?.current;
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState("files");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<"new" | "reuse" | null>(null);
  const [draft, setDraft] = useState<CredentialRevision>(blankCredential);
  const [newCredentials, setNewCredentials] = useState<Credential[]>([]);
  const [extras, setExtras] = useState<{ key: string; blob: Blob }[]>([]);
  const [reuseId, setReuseId] = useState("");
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [approvalChoice, setApprovalChoice] = useState("");
  const [scenario, setScenario] = useState("一致");
  const [summaryOpen, setSummaryOpen] = useState(false);
  useEffect(() => {
    if (!items.length) return;
    const guard = () =>
      confirm("本批次尚未归档，离开后需要重新添加。确定离开吗？");
    window.cmsLeaveGuard = guard;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      if (window.cmsLeaveGuard === guard) window.cmsLeaveGuard = undefined;
      window.removeEventListener("beforeunload", unload);
    };
  }, [items.length]);
  if (
    !can("upload") ||
    (assetId && (!existing || existing.lifecycle === "已作废"))
  )
    return (
      <Empty
        title="无法添加内容"
        description="当前角色没有上传权限，或无权访问这份内容。"
      />
    );
  const selectedItems = items.filter((i) => selected.includes(i.id));
  const allCredentials = [
    ...state.credentials.filter(
      (c) =>
        can("admin") ||
        c.createdBy === user?.id ||
        assets.some((a) =>
          a.versions.some((v) => v.approval.credentialId === c.id),
        ),
    ),
    ...newCredentials,
  ];
  const patch = (id: string, changes: Partial<Version>) =>
    setItems((list) =>
      list.map((i) => (i.id === id ? { ...i, v: { ...i.v, ...changes } } : i)),
    );
  function itemErrors(item: Item) {
    const e: string[] = [];
    if (item.error) e.push(item.error);
    if (!item.v.title.trim()) e.push("内容标题必填");
    if (!item.blob && !item.v.sourceUrl) e.push("请添加文件或公开链接");
    if (item.v.approval.mode === "pending") e.push("请选择审批登记方式");
    if (item.v.approval.mode === "exempt" && !can("exempt"))
      e.push("当前角色不能免登记审批");
    if (item.v.approval.mode === "registered") {
      if (!item.v.approval.snapshot) e.push("请关联审批凭证");
      else e.push(...credentialErrors(item.v.approval.snapshot));
    }
    if (item.duplicate && !item.acknowledged) e.push("请处理重复文件提示");
    return e;
  }
  async function addFiles(files: File[]) {
    setBusy(true);
    setError("");
    const next: Item[] = [];
    for (const file of files) {
      const kind = kindOf(file.name, file.type);
      const id = uid("upload");
      const v: Version = {
        number: 1,
        title: file.name.replace(/\.[^.]+$/, ""),
        kind: kind || "PDF",
        fileName: file.name,
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
      const item: Item = {
        id,
        v,
        blob: file,
        size:
          file.size < 1024 * 1024
            ? `${Math.ceil(file.size / 1024)} KB`
            : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        error: !kind ? "不支持该格式，请移除此项或重新选择文件。" : undefined,
      };
      if (kind) {
        try {
          const bytes = await file.arrayBuffer();
          if (kind === "PDF") {
            const { PDFDocument } = await import("pdf-lib");
            v.pages = (await PDFDocument.load(bytes)).getPageCount();
          }
          v.fileHash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          )
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const duplicate = assets.find((a) =>
            a.versions.some((v2) => v2.fileHash === v.fileHash),
          );
          const batchDuplicate = [...items, ...next].find(
            (i) => i.v.fileHash === v.fileHash,
          );
          if (duplicate || batchDuplicate)
            item.duplicate = duplicate
              ? `${duplicate.code} · ${current(duplicate).title}`
              : `本次上传：${batchDuplicate!.v.title}`;
          if (kind === "网页") {
            const dom = new DOMParser().parseFromString(
              await file.text(),
              "text/html",
            );
            dom.querySelectorAll("script,style").forEach((n) => n.remove());
            v.content = [
              dom.body.textContent?.trim() || "该 HTML 文件没有可提取的正文。",
            ];
            v.summary = v.content[0].slice(0, 100);
          }
        } catch {
          item.error = "文件读取失败，请重新添加。";
        }
      }
      next.push(item);
    }
    setItems((list) =>
      existing ? [...list, ...next].slice(-1) : [...list, ...next],
    );
    setBusy(false);
  }
  async function addDemo() {
    setBusy(true);
    setError("");
    try {
      const indices = existing ? [0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const next = await Promise.all(
        indices.map(async (index) => {
          const v = makeDemoVersion(index);
          v.approval = { mode: "pending" };
          v.tags = [];
          v.process = "排队中";
          v.tagStatus = "待打标";
          v.unmatched = undefined;
          v.fileHash = undefined;
          let blob: Blob;
          if (v.fileUrl) blob = await loadBlob(undefined, v.fileUrl);
          else if (v.kind === "视频") {
            blob = await demoVideo();
            v.fileName = "学术交流培训视频.webm";
          } else
            blob = new Blob(
              [
                `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><h1>${v.title}</h1><p>虚构 CMS 内容管理演示资料。</p></html>`,
              ],
              { type: "text/html" },
            );
          v.fileUrl = undefined;
          return {
            id: uid("upload"),
            v,
            blob,
            demo: true,
            size: `${Math.ceil(blob.size / 1024)} KB`,
          };
        }),
      );
      setItems((list) => (existing ? next : [...list, ...next]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "示例资料加载失败");
    } finally {
      setBusy(false);
    }
  }
  function addLinks() {
    const values = links
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!values.length || values.some((v) => !safePublicUrl(v)))
      return setError("请逐行填写无需登录的 HTTP / HTTPS 公开链接。");
    const next: Item[] = values.map((url) => ({
      id: uid("upload"),
      size: "公开链接",
      v: {
        number: 1,
        title: "公开链接内容",
        kind: "网页",
        fileName: "公开链接内容.html",
        source: "公开链接",
        sourceUrl: url,
        summary: "",
        content: [
          "当前原型仅登记来源链接，未实际获取原站正文、图片和排版。可上传 HTML 原文件进行预览。",
        ],
        pages: 1,
        createdAt: now(),
        process: "排队中",
        tagStatus: "待打标",
        tags: [],
        approval: { mode: "pending" },
      },
    }));
    setItems((list) => (existing ? next.slice(0, 1) : [...list, ...next]));
    setLinks("");
    setError("");
  }
  function applyExempt() {
    if (!selected.length) return toast("请先选择需要设置的内容。");
    if (!can("exempt")) return toast("当前角色没有免登记权限。");
    setItems((list) =>
      list.map((i) =>
        selected.includes(i.id)
          ? { ...i, v: { ...i.v, approval: { mode: "exempt" } } }
          : i,
      ),
    );
    setSelected([]);
  }
  function saveCredential() {
    let revision: CredentialRevision;
    let id: string;
    if (editing === "reuse") {
      const credential = allCredentials.find((c) => c.id === reuseId);
      if (!credential) return setDraftErrors(["请选择审批凭证"]);
      revision = credentialLatest(credential);
      id = credential.id;
    } else {
      const errors = credentialErrors(draft);
      if (
        ocrWarnings(draft).length &&
        draft.confirmed &&
        !draft.confirmation?.trim()
      )
        errors.push("请填写人工核对说明");
      if (errors.length) return setDraftErrors(errors);
      revision = { ...draft, updatedAt: now() };
      id = uid("credential");
      setNewCredentials((list) => [
        ...list,
        {
          id,
          revisions: [structuredClone(revision)],
          createdAt: now(),
          createdBy: user?.id,
        },
      ]);
    }
    setItems((list) =>
      list.map((i) =>
        selected.includes(i.id)
          ? {
              ...i,
              v: {
                ...i.v,
                approval: {
                  mode: "registered",
                  credentialId: id,
                  snapshot: structuredClone(revision),
                },
              },
            }
          : i,
      ),
    );
    setEditing(null);
    setSelected([]);
    setDraftErrors([]);
  }
  async function addEvidence(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length !== files.length) toast("审批截图仅支持图片文件。");
    const newEvidence = images.map((file) => {
      const key = uid("evidence-file");
      setExtras((list) => [...list, { key, blob: file }]);
      return {
        id: uid("evidence"),
        name: file.name,
        fileKey: key,
        number: "",
        title: "",
        expiry: "",
        status: "无法识别" as const,
      };
    });
    setDraft((d) => ({
      ...d,
      evidence: [...d.evidence, ...newEvidence],
      confirmed: false,
    }));
  }
  function addSampleEvidence() {
    const index = draft.evidence.filter((e) => e.url).length % 2;
    const image = { ...demoCredential.evidence[index], id: uid("evidence") };
    if (scenario === "编号差异" || scenario === "多图冲突")
      image.number =
        scenario === "多图冲突" && draft.evidence.length === 0
          ? "APP-DEMO-001"
          : "APP-DEMO-099";
    if (scenario === "无法识别") {
      image.status = "无法识别";
      image.number = "";
      image.expiry = "";
    }
    setDraft((d) => ({
      ...d,
      number: d.number || demoCredential.number,
      title: d.title || demoCredential.title,
      expiry: d.expiry || demoCredential.expiry,
      evidence: [...d.evidence, image],
      confirmed: false,
    }));
  }
  async function archive() {
    const invalid = items.flatMap((i) =>
      itemErrors(i).map((e) => `${i.v.title || i.v.fileName}：${e}`),
    );
    if (invalid.length) {
      setError(invalid.join("；"));
      return;
    }
    if (!items.length) return;
    setBusy(true);
    setError("");
    try {
      const files = items
        .filter((i) => i.blob)
        .map((i) => ({ key: uid("file"), blob: i.blob!, id: i.id }));
      await putFiles([...files, ...extras]);
      const ids: string[] = [];
      const success = update(
        (s) => {
          if (
            existing &&
            s.assets.find((a) => a.id === existing.id)?.current !== baseNumber
          )
            throw new Error(
              "内容版本已被其他操作更新，请返回详情核对后重新上传。",
            );
          for (const credential of newCredentials)
            if (items.some((i) => i.v.approval.credentialId === credential.id))
              s.credentials.push(credential);
          for (const item of items) {
            const v = structuredClone(item.v);
            v.fileKey = files.find((f) => f.id === item.id)?.key;
            v.createdAt = now();
            v.process = "处理中";
            v.tagStatus = "打标中";
            v.changeNote = existing
              ? "上传新版本，重新确认审批适用范围。"
              : "首次归档";
            if (existing) {
              const a = s.assets.find((a) => a.id === existing.id)!;
              v.number = Math.max(...a.versions.map((v) => v.number)) + 1;
              a.versions.push(v);
              a.current = v.number;
              a.updatedAt = now();
              ids.push(a.id);
            } else {
              const id = uid("asset");
              const numeric =
                Math.max(
                  0,
                  ...s.assets.map(
                    (a) => Number(a.code.replace("CMS-", "")) || 0,
                  ),
                ) + 1;
              s.assets.unshift({
                id,
                code: `CMS-${String(numeric).padStart(5, "0")}`,
                current: 1,
                ownerId: user!.id,
                versions: [v],
                lifecycle: "正常",
                updatedAt: now(),
              });
              ids.push(id);
            }
            if (v.approval.snapshot && ocrWarnings(v.approval.snapshot).length)
              s.audits.unshift({
                id: uid("ocr-log"),
                at: now(),
                user: user!.name,
                action: "人工确认 OCR 异常",
                object: v.approval.snapshot.number,
                detail: JSON.stringify({
                  warnings: ocrWarnings(v.approval.snapshot),
                  evidence: v.approval.snapshot.evidence.map((e) => ({
                    name: e.name,
                    number: e.number,
                    title: e.title,
                    expiry: e.expiry,
                  })),
                  confirmation: v.approval.snapshot.confirmation,
                }),
                category: "审批校验",
              });
          }
          s.tasks.unshift({
            id: uid("task"),
            name: `${items.length} 份内容 · 解析与自动打标`,
            type: "解析与打标",
            status: "处理中",
            items: ids.map((id) => {
              const a = s.assets.find((a) => a.id === id)!;
              return {
                assetId: id,
                version: a.current,
                label: current(a).title,
                status: "处理中" as const,
              };
            }),
            createdAt: now(),
            attempts: 1,
            finishAt: Date.now() + 3500,
          });
        },
        {
          action: existing ? "上传新版本" : "批量归档内容",
          object: existing?.code || `${items.length} 份内容`,
          detail: `${new Set(items.map((i) => i.v.approval.credentialId).filter(Boolean)).size} 条凭证；${items.filter((i) => i.v.approval.mode === "exempt").length} 份免登记。`,
        },
        "upload",
      );
      if (!success) return;
      const anomalies = items.filter(
        (i) =>
          i.v.approval.snapshot && ocrWarnings(i.v.approval.snapshot).length,
      );
      if (anomalies.length)
        notify({
          title: "新归档内容有 OCR 人工确认记录",
          detail: `${anomalies.length} 份内容存在识别异常，原始结果与核对说明已保留。`,
          route: "admin?tab=audit",
          adminOnly: true,
        });
      window.cmsLeaveGuard = undefined;
      toast(`已归档 ${items.length} 份内容，后台解析和打标正在进行。`);
      go(existing ? "content/" + existing.id : "library");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "归档失败，文件未提交，请重新尝试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const groupsMap = [
    ...new Set(items.map((i) => i.v.approval.credentialId).filter(Boolean)),
  ];
  return (
    <>
      <button
        className="back-link"
        onClick={() => go(existing ? "content/" + existing.id : "library")}
      >
        <ArrowLeft size={16} />
        返回{existing ? "内容详情" : "内容库"}
      </button>
      <PageHeader
        eyebrow="内容管理 / ADD CONTENT"
        title={existing ? "上传新版本" : "新增内容"}
        description={
          existing
            ? `${existing.code} · 当前 V${existing.current}.0；新版本成功归档后切换，历史记录保留。`
            : "一次添加多份内容，再按实际审批范围分别关联凭证。"
        }
      />
      <div className="wizard-steps">
        {["添加内容", "登记内容与审批信息", "检查并归档"].map((label, i) => (
          <div
            key={label}
            className={`${step === i + 1 ? "active" : ""} ${step > i + 1 ? "done" : ""}`}
          >
            <span>{step > i + 1 ? <Check size={16} /> : i + 1}</span>
            <strong>{label}</strong>
            {i < 2 ? <i /> : null}
          </div>
        ))}
      </div>
      {error ? <Note tone="red">{error}</Note> : null}
      {step === 1 ? (
        <section className="panel upload-panel">
          <div className="upload-modes">
            <button
              className={mode === "files" ? "active" : ""}
              onClick={() => setMode("files")}
            >
              <FilePlus2 size={17} />
              上传文件
            </button>
            <button
              className={mode === "links" ? "active" : ""}
              onClick={() => setMode("links")}
            >
              <Link2 size={17} />
              公开链接
            </button>
          </div>
          {mode === "files" ? (
            <label
              className={`drop-zone ${busy ? "is-loading" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <span className="drop-icon">
                <UploadCloud size={35} strokeWidth={1.5} />
              </span>
              <strong>
                {busy ? "正在读取内容…" : "拖拽文件到这里，或点击选择"}
              </strong>
              <p>PDF、PPT、Word、图片、视频、HTML · 支持批量添加</p>
              <span className="btn btn-primary">选择文件</span>
              <input
                aria-label="上传内容文件"
                type="file"
                multiple={!existing}
                disabled={busy}
                accept=".pdf,.ppt,.pptx,.doc,.docx,.html,.htm,image/*,video/*"
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <div className="link-entry">
              <Field
                label="公开链接"
                hint="每行一条，只支持 HTTP / HTTPS 链接。"
              >
                <textarea
                  aria-label="公开链接"
                  rows={5}
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                  placeholder="粘贴无需登录即可访问的公开链接"
                />
              </Field>
              <Note>
                本地原型仅登记链接，未执行真实网络采集。上传 HTML
                文件可安全预览正文，原文件完整保存。
              </Note>
              <Button icon={<Plus size={16} />} onClick={addLinks}>
                添加链接
              </Button>
            </div>
          )}
          <div className="demo-shortcut">
            <Files size={19} />
            <div>
              <strong>先体验完整流程</strong>
              <p>添加专门制作的示例材料，体验批量审批关联与后台处理。</p>
            </div>
            <Button disabled={busy} onClick={addDemo}>
              {busy
                ? "正在准备…"
                : existing
                  ? "添加示例新版本"
                  : "添加 8 份示例材料"}
            </Button>
          </div>
          {items.length ? (
            <div className="upload-file-list">
              <div className="section-heading">
                <h3>已添加 {items.length} 份内容</h3>
                <small className="muted">文件已读取，尚未归档</small>
              </div>
              {items.map((i) => (
                <div className="upload-file-row" key={i.id}>
                  <span className="file-icon type-other">{i.v.kind}</span>
                  <div>
                    <strong>{i.v.fileName}</strong>
                    <small>
                      {i.size}
                      {i.demo ? " · 演示素材" : ""}
                    </small>
                    {i.error ? (
                      <p className="error-text">{i.error}</p>
                    ) : i.duplicate ? (
                      <p className="warning-text">
                        发现相同文件：{i.duplicate}{" "}
                        <button
                          className="text-link"
                          onClick={() =>
                            setItems((list) =>
                              list.map((x) =>
                                x.id === i.id
                                  ? { ...x, acknowledged: true }
                                  : x,
                              ),
                            )
                          }
                        >
                          {i.acknowledged ? "已确认继续新增" : "确认继续新增"}
                        </button>
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    tone={i.error ? "red" : i.duplicate ? "amber" : "green"}
                  >
                    {i.error ? "需处理" : i.duplicate ? "重复提示" : "已读取"}
                  </Badge>
                  <button
                    className="icon-btn"
                    aria-label={`移除${i.v.fileName}`}
                    onClick={() =>
                      setItems((list) => list.filter((x) => x.id !== i.id))
                    }
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : step === 2 ? (
        <div className="registration-layout">
          <section className="panel registration-list">
            <div className="panel-heading">
              <h2>
                内容清单 <span className="count-pill">{items.length}</span>
              </h2>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  aria-label="选择全部待登记内容"
                  checked={selected.length === items.length && items.length > 0}
                  onChange={() =>
                    setSelected(
                      selected.length === items.length
                        ? []
                        : items.map((i) => i.id),
                    )
                  }
                />
                全选
              </label>
            </div>
            {items.map((i) => (
              <div
                className={`registration-item ${selected.includes(i.id) ? "selected" : ""}`}
                key={i.id}
              >
                <input
                  type="checkbox"
                  aria-label={`关联选择${i.v.title}`}
                  checked={selected.includes(i.id)}
                  onChange={() =>
                    setSelected((list) =>
                      list.includes(i.id)
                        ? list.filter((id) => id !== i.id)
                        : [...list, i.id],
                    )
                  }
                />
                <div>
                  <input
                    className="title-edit"
                    aria-label={`标题：${i.v.fileName}`}
                    value={i.v.title}
                    onChange={(e) => patch(i.id, { title: e.target.value })}
                  />
                  <small>
                    {i.v.kind} · {i.size}
                  </small>
                  <div className="registration-result">
                    {i.v.approval.mode === "registered" ? (
                      <>
                        <ShieldCheck size={14} />
                        <span>{i.v.approval.snapshot?.number}</span>
                      </>
                    ) : (
                      <Badge
                        tone={
                          i.v.approval.mode === "pending" ? "amber" : "gray"
                        }
                      >
                        {i.v.approval.mode === "pending"
                          ? "待选择审批方式"
                          : "免登记"}
                      </Badge>
                    )}
                    {i.v.approval.mode !== "pending" ? (
                      <button
                        onClick={() =>
                          patch(i.id, { approval: { mode: "pending" } })
                        }
                      >
                        解除关联
                      </button>
                    ) : null}
                  </div>
                  {i.v.approval.mode === "exempt" ? (
                    <label className="inline-expiry">
                      内容有效期（选填）
                      <input
                        type="date"
                        value={i.v.expiry || ""}
                        onChange={(e) =>
                          patch(i.id, { expiry: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            ))}
            <div className="optional-toggle">
              <button
                className="text-link"
                onClick={() => setSummaryOpen(!summaryOpen)}
              >
                {summaryOpen ? "收起" : "填写"}摘要、封面和缩略图（选填）
              </button>
            </div>
            {summaryOpen ? (
              <div className="optional-information">
                {items.map((i) => (
                  <div key={i.id}>
                    <h4>{i.v.title}</h4>
                    <Field label="摘要">
                      <textarea
                        rows={2}
                        value={i.v.summary}
                        onChange={(e) =>
                          patch(i.id, { summary: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="封面（选填）">
                      <CoverPicker
                        value={i.v.cover || ""}
                        label="上传封面"
                        onChange={(value) => patch(i.id, { cover: value })}
                      />
                    </Field>
                    <Field label="缩略图（选填）">
                      <CoverPicker
                        value={i.v.thumbnail || ""}
                        label="上传缩略图"
                        onChange={(value) => patch(i.id, { thumbnail: value })}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <aside className="panel approval-workspace">
            <div className="approval-workspace-icon">
              <ShieldCheck size={28} strokeWidth={1.5} />
            </div>
            <h2>审批信息关联</h2>
            <p className="muted">按实际审批范围分组，不自动合并上传批次。</p>
            <div className="selection-summary">
              已选 <strong>{selected.length}</strong> 份内容
            </div>
            <div className="approval-choice">
              <label>
                <input
                  type="radio"
                  name="approval-requirement"
                  value="registered"
                  checked={approvalChoice === "registered"}
                  disabled={!selected.length}
                  onChange={() => setApprovalChoice("registered")}
                />
                <span>
                  需要登记审批信息<small>编号、截图和有效期必填</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="approval-requirement"
                  value="exempt"
                  checked={approvalChoice === "exempt"}
                  disabled={!selected.length || !can("exempt")}
                  onChange={() => setApprovalChoice("exempt")}
                />
                <span>
                  免登记审批信息
                  <small>
                    {can("exempt")
                      ? "免填编号、截图和 OCR"
                      : "当前角色没有免登记权限"}
                  </small>
                </span>
              </label>
            </div>
            <Button
              variant="primary"
              className="full-width"
              disabled={!selected.length || approvalChoice !== "registered"}
              icon={<Plus size={16} />}
              onClick={() => {
                setEditing("new");
                setDraft(blankCredential());
                setDraftErrors([]);
              }}
            >
              登记新凭证并关联
            </Button>
            <Button
              className="full-width"
              disabled={!selected.length || approvalChoice !== "registered"}
              icon={<ShieldCheck size={16} />}
              onClick={() => {
                setEditing("reuse");
                setReuseId("");
                setDraftErrors([]);
              }}
            >
              选择已有审批凭证
            </Button>
            <button
              className="exempt-option"
              disabled={
                !selected.length ||
                !can("exempt") ||
                approvalChoice !== "exempt"
              }
              onClick={applyExempt}
            >
              免登记审批信息
              <small>
                {can("exempt")
                  ? "不填编号、不传截图、不执行 OCR"
                  : "当前角色没有免登记权限"}
              </small>
            </button>
            <div className="group-summary">
              <h4>已建立的关联</h4>
              {groupsMap.map((id) => {
                const related = items.filter(
                  (i) => i.v.approval.credentialId === id,
                );
                return (
                  <div key={id}>
                    <ShieldCheck size={14} />
                    <span>
                      {related[0].v.approval.snapshot?.number}
                      <small>{related.length} 份内容</small>
                    </span>
                  </div>
                );
              })}
              {items.some((i) => i.v.approval.mode === "exempt") ? (
                <div>
                  <Check size={14} />
                  <span>
                    免登记
                    <small>
                      {
                        items.filter((i) => i.v.approval.mode === "exempt")
                          .length
                      }{" "}
                      份内容
                    </small>
                  </span>
                </div>
              ) : null}
              {!groupsMap.length &&
              !items.some((i) => i.v.approval.mode === "exempt") ? (
                <p className="muted">勾选左侧内容后建立关联</p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : (
        <section className="panel review-panel">
          <div className="review-intro">
            <span className="review-icon">
              <ShieldCheck size={30} />
            </span>
            <div>
              <h2>检查后统一归档</h2>
              <p>请确认审批关联和内容信息，后台处理将在归档后开始。</p>
            </div>
          </div>
          <div className="review-counts">
            <div>
              <strong>{items.length}</strong>
              <span>本次内容</span>
            </div>
            <div>
              <strong>{groupsMap.length}</strong>
              <span>关联凭证</span>
            </div>
            <div>
              <strong>
                {items.filter((i) => i.v.approval.mode === "exempt").length}
              </strong>
              <span>免登记</span>
            </div>
            <div>
              <strong>
                {items.filter((i) => itemErrors(i).length).length}
              </strong>
              <span>需修正内容</span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>内容</th>
                <th>审批依据</th>
                <th>检查结果</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.v.title}
                    <small className="cell-sub">{i.v.kind}</small>
                  </td>
                  <td>
                    {i.v.approval.snapshot?.number ||
                      (i.v.approval.mode === "exempt" ? "免登记" : "未选择")}
                  </td>
                  <td>
                    {itemErrors(i).length ? (
                      <button
                        className="text-link error-text"
                        onClick={() => {
                          setSelected([i.id]);
                          setStep(2);
                        }}
                      >
                        {itemErrors(i).join("；")}
                      </button>
                    ) : (
                      <Badge tone="green">信息完整</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            归档后可以离开页面。解析和打标失败不影响已经保存的原文件，也不会回退已归档版本。
          </Note>
        </section>
      )}
      <div className="wizard-footer">
        <span>
          {step > 1
            ? `本次 ${items.length} 份内容 · ${items.filter((i) => i.v.approval.mode !== "pending").length} 份已登记规则`
            : "尚未提交的内容不会自动归档"}
        </span>
        <div>
          {step > 1 ? (
            <Button
              disabled={busy}
              icon={<ArrowLeft size={16} />}
              onClick={() => {
                setError("");
                setStep(step - 1);
              }}
            >
              上一步
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              variant="primary"
              disabled={busy || !items.length || items.some((i) => i.error)}
              onClick={() => {
                setError("");
                setStep(step + 1);
              }}
            >
              下一步
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || items.some((i) => itemErrors(i).length > 0)}
              icon={
                busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )
              }
              onClick={archive}
            >
              {busy ? "正在保存原文件…" : `确认归档 ${items.length} 份内容`}
            </Button>
          )}
        </div>
      </div>
      {editing ? (
        <Dialog
          title={editing === "new" ? "登记审批凭证" : "选择已有审批凭证"}
          wide
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" onClick={saveCredential}>
                关联到已选 {selected.length} 份内容
              </Button>
            </>
          }
        >
          <Note>一条凭证可以关联多份内容；每个内容版本最多关联一条凭证。</Note>
          {draftErrors.length ? (
            <Note tone="red">{draftErrors.join("；")}</Note>
          ) : null}
          {editing === "reuse" ? (
            <div className="credential-choice-list">
              {allCredentials.map((c) => {
                const revision = credentialLatest(c);
                return (
                  <label
                    key={c.id}
                    className={`credential-choice ${reuseId === c.id ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="reuse-credential"
                      value={c.id}
                      checked={reuseId === c.id}
                      onChange={() => setReuseId(c.id)}
                    />
                    <div>
                      <strong>{revision.number}</strong>
                      <p>{revision.title}</p>
                      <small>
                        有效至 {revision.expiry} · {revision.evidence.length}{" "}
                        张截图 · 修订 {revision.revision}
                      </small>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <>
              <div className="form-grid">
                <Field label="审批编号" required>
                  <input
                    aria-label="审批编号"
                    value={draft.number}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        number: e.target.value,
                        confirmed: false,
                      }))
                    }
                    placeholder="填写审批单上的材料编号"
                  />
                </Field>
                <Field label="有效期" required>
                  <input
                    aria-label="审批有效期"
                    type="date"
                    value={draft.expiry}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        expiry: e.target.value,
                        confirmed: false,
                      }))
                    }
                  />
                </Field>
              </div>
              <Field
                label="审批单 / 材料包标题"
                hint="标题用于核对覆盖范围，不要求与每个文件名一致。"
              >
                <input
                  aria-label="审批单标题"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      title: e.target.value,
                      confirmed: false,
                    }))
                  }
                />
              </Field>
              <div className="section-heading">
                <h3>
                  审批截图 <span className="required">*</span>
                </h3>
                <small className="muted">支持同一审批单的多张截图</small>
              </div>
              <div className="evidence-toolbar">
                <label className="btn btn-secondary">
                  <ImagePlus size={16} />
                  上传截图
                  <input
                    type="file"
                    aria-label="上传审批截图"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      void addEvidence(Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                </label>
                <Button icon={<Plus size={16} />} onClick={addSampleEvidence}>
                  添加示例截图
                </Button>
                <select
                  aria-label="OCR 演示场景"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                >
                  {["一致", "编号差异", "无法识别", "多图冲突"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <small className="muted">
                OCR
                为本地演示；真实上传截图标记“无法识别”，可填写信息并人工核对后继续。
              </small>
              <div className="evidence-grid">
                {draft.evidence.map((e, index) => (
                  <article className="evidence-card" key={e.id}>
                    {e.url && can("evidence") ? (
                      <img src={e.url} alt={e.name} />
                    ) : (
                      <div className="evidence-placeholder">
                        <ShieldCheck size={30} />
                        <span>
                          {e.fileKey
                            ? "截图已添加，原文件将随归档保存"
                            : "当前角色无截图查看权限"}
                        </span>
                      </div>
                    )}
                    <div>
                      <strong>{e.name}</strong>
                      <Badge>{e.status}</Badge>
                      <button
                        className="icon-btn"
                        aria-label={`移除截图${index + 1}`}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            evidence: d.evidence.filter((i) => i.id !== e.id),
                            confirmed: false,
                          }))
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {draft.evidence.length ? (
                <>
                  <h3 className="subsection-title">逐字段核对</h3>
                  <div className="table-wrap">
                    <table className="data-table ocr-table">
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>登记值</th>
                          <th>识别值</th>
                          <th>来源截图</th>
                          <th>结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.evidence.flatMap((e) =>
                          [
                            ["审批编号", draft.number, e.number],
                            ["有效期", draft.expiry, e.expiry],
                            ["材料包标题", draft.title, e.title],
                          ].map(([label, entered, value]) => (
                            <tr key={e.id + label}>
                              <td>{label}</td>
                              <td>{entered || "未填写"}</td>
                              <td>{value || "无法识别"}</td>
                              <td>{e.name}</td>
                              <td>
                                <Badge>
                                  {!value
                                    ? "无法识别"
                                    : value === entered
                                      ? "一致"
                                      : label === "材料包标题"
                                        ? "待人工核对"
                                        : "差异"}
                                </Badge>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
              {ocrWarnings(draft).length ? (
                <div className="ocr-warning">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>存在需要核对的识别结果</strong>
                    {ocrWarnings(draft).map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                    <label className="checkbox-label">
                      <input
                        aria-label="人工确认 OCR 异常"
                        type="checkbox"
                        checked={draft.confirmed}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            confirmed: e.target.checked,
                          }))
                        }
                      />
                      我已核对编号、有效期和材料覆盖范围，确认继续
                    </label>
                    {draft.confirmed ? (
                      <Field label="人工核对说明" required>
                        <textarea
                          aria-label="人工核对说明"
                          rows={2}
                          value={draft.confirmation || ""}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              confirmation: e.target.value,
                            }))
                          }
                          placeholder="说明核对依据，原识别结果仍将保留"
                        />
                      </Field>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {allCredentials.some(
                (c) => credentialLatest(c).number === draft.number,
              ) && draft.number ? (
                <Note tone="amber">
                  该编号已有凭证。可取消本次登记并选择已有凭证；编号复用不代表内容重复。
                </Note>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
