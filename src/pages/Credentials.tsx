import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileCheck2,
  Plus,
  List,
  LayoutGrid,
  ImagePlus,
  Pencil,
  ShieldCheck,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { useCMS } from "../store";
import {
  credentialLatest,
  credentialErrors,
  current,
  dateLabel,
  go,
  now,
  ocrWarnings,
  today,
  uid,
  type CredentialRevision,
  type Evidence,
} from "../model";
import { demoCredential, makeDemoVersion } from "../seed";
import { loadBlob, putFiles } from "../storage";
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
import "./operations.css";

function EvidenceImage({ evidence }: { evidence: Evidence }) {
  const { can } = useCMS();
  const allowed = can("evidence");
  const identity = `${evidence.fileKey || ""}:${evidence.url || ""}`;
  const [image, setImage] = useState<{ identity: string; url: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    let objectUrl: string | undefined;
    setError("");
    loadBlob(evidence.fileKey, evidence.url)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ identity, url: objectUrl });
      })
      .catch(() => {
        if (active) setError("截图文件不可用，请核对本地存储或重新上传。");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [allowed, identity, evidence.fileKey, evidence.url]);
  if (!allowed)
    return (
      <div className="ops-image-locked">
        <LockKeyhole size={22} />
        <span>当前角色无审批截图查看权限</span>
      </div>
    );
  if (error)
    return (
      <div className="ops-image-locked" role="status">
        {error}
      </div>
    );
  return image?.identity === identity ? (
    <a
      className="ops-evidence-image"
      href={image.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`查看原始截图：${evidence.name}`}
    >
      <img src={image.url} alt={evidence.name} />
    </a>
  ) : (
    <div className="ops-image-locked" role="status">
      正在读取截图…
    </div>
  );
}

function OcrLedger({
  revision,
  editable = false,
  onRemove,
}: {
  revision: CredentialRevision;
  editable?: boolean;
  onRemove?: (id: string) => void;
}) {
  const { can } = useCMS();
  return (
    <div className="ops-evidence-list">
      {revision.evidence.map((e) => {
        const differs =
          (e.number && e.number !== revision.number) ||
          (e.title && revision.title && e.title !== revision.title) ||
          (e.expiry && e.expiry !== revision.expiry);
        const displayStatus =
          e.status === "无法识别" ? e.status : differs ? "差异" : e.status;
        return (
          <section className="ops-evidence" key={e.id}>
            <div className="ops-row">
              <div>
                <strong>{e.name}</strong>
                <p className="muted ops-caption">
                  {e.fileKey
                    ? "实际上传图片 · 未执行真实 OCR"
                    : "示例截图 · 模拟 OCR 结果"}
                </p>
              </div>
              <div className="actions">
                <Badge>{displayStatus}</Badge>
                {editable && can("edit") ? (
                  <Button
                    variant="ghost"
                    icon={<Trash2 size={15} />}
                    aria-label={`移除 ${e.name}`}
                    onClick={() => onRemove?.(e.id)}
                  >
                    移除
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="ops-evidence-body">
              <EvidenceImage evidence={e} />
              <div className="table-wrap">
                <table className="data-table ops-ledger">
                  <thead>
                    <tr>
                      <th>核对字段</th>
                      <th>登记输入</th>
                      <th>原始识别结果</th>
                      <th>结果来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["number", "title", "expiry"] as const).map((key) => (
                      <tr key={key}>
                        <td>
                          {
                            {
                              number: "审批编号",
                              title: "材料包标题",
                              expiry: "有效期",
                            }[key]
                          }
                        </td>
                        <td className={key === "number" ? "ops-code" : ""}>
                          {revision[key] || "未填写"}
                        </td>
                        <td>
                          <span
                            className={
                              e[key] && e[key] !== revision[key]
                                ? "ops-danger-text"
                                : ""
                            }
                          >
                            {e[key] || "无法识别 · 待人工核对"}
                          </span>
                        </td>
                        <td className="muted">{e.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function expiryLabel(expiry: string) {
  const days = Math.round(
    (Date.parse(expiry + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) /
      86400000,
  );
  return Number.isNaN(days)
    ? "未设置"
    : days < 0
      ? "已过期"
      : days <= 30
        ? "即将过期"
        : "生效中";
}

type Editor = {
  id?: string;
  base: number;
  token: string;
  actor: string;
  revision: CredentialRevision;
};
const emptyRevision = (): CredentialRevision => ({
  revision: 1,
  number: "",
  title: "",
  expiry: "",
  evidence: [],
  confirmed: false,
  updatedAt: now(),
});
const queryOpen = () =>
  new URLSearchParams(
    window.location.hash.split("?")[1] || window.location.search,
  ).get("open");

export default function Credentials() {
  const cms = useCMS();
  const { state, assets, can, update, toast, notify } = cms;
  const latestCMS = useRef(cms);
  latestCMS.current = cms;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState("cards");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(queryOpen);
  const [revisionNumber, setRevisionNumber] = useState<number>();
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [scopeConsent, setScopeConsent] = useState("");
  const [sample, setSample] = useState("1");
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = () => {
      setDetailId(queryOpen());
      setRevisionNumber(undefined);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  const referenced = new Set(
    assets.flatMap((a) =>
      a.versions.flatMap((v) =>
        v.approval.credentialId ? [v.approval.credentialId] : [],
      ),
    ),
  );
  const credentials = state.credentials.filter(
    (c) => can("admin") || referenced.has(c.id) || c.createdBy === cms.user?.id,
  );
  const editorVisible =
    !editor?.id || credentials.some((c) => c.id === editor.id);
  const editAllowed = can("edit");
  useEffect(() => {
    setEditor(undefined);
    setErrors([]);
    setScopeConsent("");
  }, [cms.user?.id, cms.role?.id]);
  useEffect(() => {
    if (!editorVisible || !editAllowed) setEditor(undefined);
  }, [editorVisible, editAllowed]);
  const filtered = credentials.filter((c) => {
    const r = credentialLatest(c);
    return (
      `${r.number} ${r.title}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()) &&
      (status === "all" ||
        (status === "warnings"
          ? ocrWarnings(r).length > 0
          : expiryLabel(r.expiry) === status))
    );
  });
  const actualPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 8)),
  );
  const detail = credentials.find((c) => c.id === detailId);
  const shownRevision = detail
    ? detail.revisions.find((r) => r.revision === revisionNumber) ||
      credentialLatest(detail)
    : undefined;
  const currentBindings = (id?: string) =>
    id
      ? assets.filter(
          (a) =>
            current(a).approval.mode === "registered" &&
            current(a).approval.credentialId === id,
        )
      : [];
  const affected = currentBindings(editor?.id);
  const scopeKey = JSON.stringify(
    affected
      .map((a) => [a.id, a.current])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  const warnings = editor ? ocrWarnings(editor.revision) : [];
  const openEditor = (id?: string) => {
    if (!can("edit")) return toast("当前角色没有登记或编辑凭证的权限。");
    const credential = id ? credentials.find((c) => c.id === id) : undefined;
    if (id && !credential) return toast("该凭证不在当前可见范围内。");
    const revision = credential
      ? structuredClone(credentialLatest(credential))
      : emptyRevision();
    setEditor({
      id,
      base: credential ? revision.revision : 0,
      token: uid("editor"),
      actor: cms.user?.id || "",
      revision,
    });
    setErrors([]);
    setScopeConsent("");
    setDuplicateConfirmed(false);
  };
  const change = (patch: Partial<CredentialRevision>) => {
    setEditor((previous) =>
      previous
        ? {
            ...previous,
            revision: {
              ...previous.revision,
              ...patch,
              confirmed: false,
              confirmation: undefined,
            },
          }
        : previous,
    );
    setErrors([]);
  };
  const addExample = () => {
    if (!can("edit") || !editor) return toast("添加截图需要编辑凭证权限。");
    const source =
      sample === "3"
        ? makeDemoVersion(5).approval.snapshot!.evidence[0]
        : demoCredential.evidence[Number(sample) - 1];
    change({
      evidence: [
        ...editor.revision.evidence,
        { ...structuredClone(source), id: uid("evidence") },
      ],
    });
  };
  const uploadEvidence = async (files: File[]) => {
    if (!editor || !can("edit") || !files.length) return;
    if (
      files.some(
        (f) =>
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            f.type,
          ) || f.size > 20 * 1024 * 1024,
      )
    )
      return toast("请上传 PNG、JPEG、WebP 或 GIF 截图，每张不超过 20 MB。");
    setBusy(true);
    try {
      const entries = files.map((file) => ({
        key: uid("evidence-file"),
        blob: file,
      }));
      // Verify actual image bytes before keeping them as approval evidence.
      await Promise.all(
        files.map(async (file) => {
          const bitmap = await createImageBitmap(file);
          bitmap.close();
        }),
      );
      if (
        !latestCMS.current.can("edit") ||
        latestCMS.current.user?.id !== editor.actor
      )
        return latestCMS.current.toast(
          "权限或登录账号已变化，截图未加入凭证。",
        );
      await putFiles(entries);
      if (
        !latestCMS.current.can("edit") ||
        latestCMS.current.user?.id !== editor.actor
      )
        return;
      setEditor((previous) =>
        previous?.token === editor.token
          ? {
              ...previous,
              revision: {
                ...previous.revision,
                evidence: [
                  ...previous.revision.evidence,
                  ...entries.map((entry, i): Evidence => ({
                    id: uid("evidence"),
                    name: files[i].name,
                    fileKey: entry.key,
                    number: "",
                    title: "",
                    expiry: "",
                    status: "无法识别",
                  })),
                ],
                confirmed: false,
                confirmation: undefined,
              },
            }
          : previous,
      );
      setErrors([]);
      toast(
        "截图已保存到本地。未执行真实 OCR，请查看原图并填写登记值、确认无法识别的原因。",
      );
    } catch {
      toast(
        "截图保存失败：请检查图片是否有效、浏览器是否允许本地文件存储，然后重新上传。",
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const save = () => {
    if (!editor || busy || !can("edit")) return;
    const revision = {
      ...editor.revision,
      number: editor.revision.number.trim(),
      title: editor.revision.title.trim(),
      confirmation: editor.revision.confirmation?.trim(),
    };
    const validation = credentialErrors(revision);
    const parsedExpiry = new Date(revision.expiry + "T00:00:00Z");
    if (
      !Number.isNaN(parsedExpiry.getTime()) &&
      parsedExpiry.toISOString().slice(0, 10) !== revision.expiry
    )
      validation.push("有效期必须为真实有效的日期。");
    if (ocrWarnings(revision).length && !revision.confirmation)
      validation.push("请填写人工核对理由，不能用确认操作隐藏识别差异。");
    if (affected.length && scopeConsent !== scopeKey)
      validation.push("请明确确认将新修订应用到列出的当前版本绑定。");
    const existing = editor.id
      ? credentials.find((c) => c.id === editor.id)
      : undefined;
    if (
      editor.id &&
      (!existing || credentialLatest(existing).revision !== editor.base)
    )
      validation.push("该凭证已变化或不再可见，请关闭窗口并重新编辑。");
    if (
      state.credentials.some(
        (c) =>
          c.id !== editor.id &&
          credentialLatest(c).number.toLocaleLowerCase() ===
            revision.number.toLocaleLowerCase(),
      ) &&
      !duplicateConfirmed
    )
      validation.push(
        "该编号已有凭证，请优先复用；如需继续登记，请确认编号复用提示。",
      );
    if (validation.length) return setErrors(validation);
    const id = editor.id || uid("credential");
    const saved: CredentialRevision = {
      ...revision,
      revision: existing
        ? Math.max(...existing.revisions.map((r) => r.revision)) + 1
        : 1,
      updatedAt: now(),
    };
    const scope = new Set(affected.map((a) => `${a.id}:${a.current}`));
    const anomalies = ocrWarnings(saved);
    const ok = update(
      (s) => {
        if (editor.id)
          s.credentials
            .find((c) => c.id === id)!
            .revisions.push(structuredClone(saved));
        else
          s.credentials.unshift({
            id,
            revisions: [structuredClone(saved)],
            createdAt: now(),
            createdBy: cms.user?.id,
          });
        for (const asset of s.assets)
          if (scope.has(`${asset.id}:${asset.current}`)) {
            const v = current(asset);
            if (
              v.approval.mode === "registered" &&
              v.approval.credentialId === id
            ) {
              v.approval.snapshot = structuredClone(saved);
              asset.updatedAt = now();
            }
          }
      },
      {
        action: editor.id ? "修订审批凭证" : "登记审批凭证",
        object: saved.number,
        detail: `修订 R${saved.revision}；仅更新 ${affected.length} 个可见当前版本绑定：${affected.map((a) => `${a.code}/V${a.current}`).join("、") || "无"}。历史版本快照不变。OCR 原始结果保留；${anomalies.join("；") || "无识别异常"}${saved.confirmation ? `；人工核对理由：${saved.confirmation}` : ""}`,
        category: "审批校验",
      },
      "edit",
    );
    if (!ok) return;
    if (anomalies.length)
      notify({
        title: "审批凭证存在 OCR 异常",
        detail: `${saved.number} · ${anomalies.join("；")}。人工核对：${saved.confirmation}`,
        route: `credentials?open=${id}`,
        adminOnly: true,
      });
    setEditor(undefined);
    setRevisionNumber(undefined);
    toast("凭证已保存。原始识别结果与历史版本快照已保留。");
  };
  const closeDetail = useCallback(() => {
    const hashHasOpen = new URLSearchParams(
      window.location.hash.split("?")[1] || "",
    ).has("open");
    if (new URLSearchParams(window.location.search).has("open")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      window.history.replaceState(null, "", url);
    }
    setDetailId(null);
    setRevisionNumber(undefined);
    if (hashHasOpen) go("credentials");
  }, []);
  const closeEditor = useCallback(() => {
    if (!busy) setEditor(undefined);
  }, [busy]);

  return (
    <div className="ops-page">
      <PageHeader
        eyebrow="APPROVAL EVIDENCE"
        title="审批凭证"
        description="一个编号管理一组审批截图；修订可追溯，内容版本保留独立快照。"
        action={
          can("edit") ? (
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() => openEditor()}
            >
              登记凭证
            </Button>
          ) : (
            <Badge tone="gray">只读权限</Badge>
          )
        }
      />
      <div className="ops-scope-strip">
        <ShieldCheck size={18} />
        <span>
          {can("admin")
            ? "管理员可查看全部凭证。"
            : "仅展示可见内容各版本引用的凭证。"}{" "}
          每个内容版本只关联一个审批凭证；截图仅向有权限的角色开放。
        </span>
      </div>
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="搜索审批编号或材料包标题"
          />
          <select
            className="select"
            aria-label="筛选凭证状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部状态</option>
            <option value="warnings">有 OCR 异常</option>
            <option>生效中</option>
            <option>即将过期</option>
            <option>已过期</option>
          </select>
          <div className="ops-view-toggle">
            <Button
              variant={view === "cards" ? "secondary" : "ghost"}
              icon={<LayoutGrid size={16} />}
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
            >
              卡片
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              icon={<List size={16} />}
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              列表
            </Button>
          </div>
        </div>
        {!filtered.length ? (
          <Empty
            title="没有匹配的凭证"
            description="尝试其他审批编号或清除状态筛选。新登记的凭证需关联可见内容后才进入非管理员的列表。"
          />
        ) : view === "cards" ? (
          <div className="ops-credential-grid">
            {filtered.slice((actualPage - 1) * 8, actualPage * 8).map((c) => {
              const r = credentialLatest(c);
              const w = ocrWarnings(r);
              return (
                <article
                  className="credential-card ops-credential-card"
                  key={c.id}
                >
                  <div className="ops-row">
                    <span className="ops-document-mark">
                      <FileCheck2 size={23} />
                    </span>
                    <Badge>{expiryLabel(r.expiry)}</Badge>
                  </div>
                  <button
                    className="text-link ops-credential-number ops-code"
                    onClick={() => {
                      setDetailId(c.id);
                      setRevisionNumber(undefined);
                    }}
                  >
                    {r.number}
                  </button>
                  <h3>{r.title || "未填写材料包标题"}</h3>
                  <dl className="ops-mini-meta">
                    <div>
                      <dt>有效期</dt>
                      <dd>{r.expiry}</dd>
                    </div>
                    <div>
                      <dt>当前关联</dt>
                      <dd>{currentBindings(c.id).length} 份可见内容</dd>
                    </div>
                    <div>
                      <dt>凭证修订</dt>
                      <dd>
                        R{r.revision} · {r.evidence.length} 张截图
                      </dd>
                    </div>
                  </dl>
                  <div className="ops-row ops-card-footer">
                    <Badge tone={w.length ? "amber" : "green"}>
                      {w.length
                        ? `${w.length} 项 OCR 异常${r.confirmed ? " · 已确认" : ""}`
                        : "无 OCR 异常"}
                    </Badge>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setDetailId(c.id);
                        setRevisionNumber(undefined);
                      }}
                    >
                      查看详情
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>审批编号 / 材料包</th>
                  <th>有效期</th>
                  <th>修订 / 截图</th>
                  <th>可见当前关联</th>
                  <th>OCR 核对</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice((actualPage - 1) * 8, actualPage * 8)
                  .map((c) => {
                    const r = credentialLatest(c);
                    const w = ocrWarnings(r);
                    return (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="text-link ops-code"
                            onClick={() => {
                              setDetailId(c.id);
                              setRevisionNumber(undefined);
                            }}
                          >
                            {r.number}
                          </button>
                          <div className="muted ops-caption">
                            {r.title || "未填写标题"}
                          </div>
                        </td>
                        <td>
                          {r.expiry}
                          <div>
                            <Badge>{expiryLabel(r.expiry)}</Badge>
                          </div>
                        </td>
                        <td>
                          R{r.revision} / {r.evidence.length} 张
                        </td>
                        <td>{currentBindings(c.id).length}</td>
                        <td>
                          <Badge tone={w.length ? "amber" : "green"}>
                            {w.length
                              ? r.confirmed
                                ? "异常已人工确认"
                                : "异常待确认"
                              : "无异常"}
                          </Badge>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setDetailId(c.id);
                              setRevisionNumber(undefined);
                            }}
                          >
                            查看
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          total={filtered.length}
          page={actualPage}
          onChange={setPage}
        />
      </section>
      {detailId && !detail && !editor ? (
        <Dialog title="凭证不可见" onClose={closeDetail}>
          <Empty
            title="无法查看该凭证"
            description="该凭证不存在，或未被当前可见内容引用。请从凭证列表重新选择。"
          />
        </Dialog>
      ) : null}
      {detail && shownRevision && !editor ? (
        <Dialog
          wide
          title={`审批凭证 · ${credentialLatest(detail).number}`}
          onClose={closeDetail}
          footer={
            <>
              <Button onClick={closeDetail}>关闭</Button>
              {can("edit") ? (
                <Button
                  variant="primary"
                  icon={<Pencil size={16} />}
                  onClick={() => openEditor(detail.id)}
                >
                  修订最新凭证
                </Button>
              ) : null}
            </>
          }
        >
          <div className="ops-row">
            <div>
              <h3 className="ops-code">{shownRevision.number}</h3>
              <p className="muted">
                {shownRevision.title || "未填写材料包标题"}
              </p>
            </div>
            <Badge>{expiryLabel(shownRevision.expiry)}</Badge>
          </div>
          <Tabs
            items={[...detail.revisions]
              .reverse()
              .map((r) => ({
                key: String(r.revision),
                label: `R${r.revision}${r.revision === credentialLatest(detail).revision ? " · 最新" : " · 历史"}`,
              }))}
            value={String(shownRevision.revision)}
            onChange={(key) => setRevisionNumber(Number(key))}
          />
          <dl className="ops-mini-meta ops-meta-horizontal">
            <div>
              <dt>有效期</dt>
              <dd>{shownRevision.expiry}</dd>
            </div>
            <div>
              <dt>修订时间</dt>
              <dd>{dateLabel(shownRevision.updatedAt)}</dd>
            </div>
            <div>
              <dt>覆盖范围</dt>
              <dd>{shownRevision.title || "请核对截图中的材料范围"}</dd>
            </div>
          </dl>
          <Note>
            以下为凭证修订记录。内容详情以其版本绑定快照为准，历史内容不会自动使用最新凭证。
          </Note>
          {ocrWarnings(shownRevision).length ? (
            <Note tone="amber">
              <strong>原始 OCR 异常（保留）</strong>
              <ul>
                {ocrWarnings(shownRevision).map((w, index) => (
                  <li key={`${index}:${w}`}>{w}</li>
                ))}
              </ul>
              <p>
                {shownRevision.confirmed
                  ? `已人工确认：${shownRevision.confirmation || "历史记录未填写核对理由"}`
                  : "尚未人工确认。请有编辑权限的人员核对截图后修订。"}
              </p>
            </Note>
          ) : null}
          <h3 className="section-heading">字段核对与截图来源</h3>
          <OcrLedger revision={shownRevision} />
          <h3 className="section-heading">可见内容绑定</h3>
          <div className="ops-binding-list">
            {assets.flatMap((a) =>
              a.versions
                .filter((v) => v.approval.credentialId === detail.id)
                .map((v) => (
                  <div className="ops-row" key={`${a.id}:${v.number}`}>
                    <button
                      className="text-link"
                      onClick={() =>
                        go(`content/${a.id}?version=${v.number}&tab=approval`)
                      }
                    >
                      {v.title}
                    </button>
                    <span className="muted ops-caption">
                      {a.code} · V{v.number}
                      {a.current === v.number ? " 当前" : " 历史"} · 快照 R
                      {v.approval.snapshot?.revision || "—"}
                    </span>
                  </div>
                )),
            )}
            {!assets.some((a) =>
              a.versions.some((v) => v.approval.credentialId === detail.id),
            ) ? (
              <p className="muted">尚无可见内容引用此凭证。</p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      {editor &&
      editorVisible &&
      editAllowed &&
      editor.actor === cms.user?.id ? (
        <Dialog
          wide
          title={editor.id ? `修订凭证 · R${editor.base + 1}` : "登记审批凭证"}
          onClose={closeEditor}
          footer={
            <>
              <Button disabled={busy} onClick={() => setEditor(undefined)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={busy || !can("edit")}
                onClick={save}
              >
                {busy ? "正在保存截图…" : editor.id ? "保存新修订" : "登记凭证"}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="审批编号" required>
              <input
                className="input ops-code"
                disabled={busy}
                value={editor.revision.number}
                onChange={(e) => change({ number: e.target.value })}
                placeholder="按审批单填写，不由截图文件名推测"
              />
            </Field>
            <Field label="有效期至" required>
              <input
                className="input"
                type="date"
                disabled={busy}
                value={editor.revision.expiry}
                onChange={(e) => change({ expiry: e.target.value })}
              />
            </Field>
            <Field
              label="材料包标题 / 覆盖范围"
              hint="用于帮助判断该审批覆盖哪些内容，不代替原审批单。"
            >
              <input
                className="input"
                disabled={busy}
                value={editor.revision.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </Field>
          </div>
          <div className="ops-row section-heading">
            <h3>
              审批截图 <span className="muted">· 至少一张</span>
            </h3>
            {can("edit") ? (
              <div className="actions">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(e) => {
                    void uploadEvidence(Array.from(e.target.files || []));
                  }}
                />
                <Button
                  disabled={busy}
                  icon={<ImagePlus size={16} />}
                  onClick={() => fileInput.current?.click()}
                >
                  上传实际截图
                </Button>
                <select
                  className="select"
                  aria-label="选择示例截图"
                  disabled={busy}
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                >
                  <option value="1">示例 · 基本信息</option>
                  <option value="2">示例 · 附件结论</option>
                  <option value="3">示例 · 编号差异</option>
                </select>
                <Button disabled={busy} onClick={addExample}>
                  添加示例截图
                </Button>
              </div>
            ) : null}
          </div>
          <Note tone="amber">
            本地 OCR 演示：示例截图显示预设识别值；实际上传不调用
            OCR，不猜测编号、标题或有效期，统一标记为无法识别。人工确认只记录核对理由，不把差异改成“一致”。
          </Note>
          {!can("evidence") ? (
            <Note>
              当前角色可以登记或更换截图，但不能读取、预览或打开已保存的截图文件。请根据手头的原审批单填写登记值并人工核对。
            </Note>
          ) : null}
          {editor.revision.evidence.length ? (
            <OcrLedger
              revision={editor.revision}
              editable={!busy && can("edit")}
              onRemove={(id) =>
                change({
                  evidence: editor.revision.evidence.filter((e) => e.id !== id),
                })
              }
            />
          ) : (
            <Empty
              title="尚未添加审批截图"
              description="上传一张或多张实际审批截图，或添加明确标记的示例截图。截图保存后的预览仍受查看权限控制。"
            />
          )}
          {warnings.length ? (
            <div className="ops-confirmation">
              <strong>需要人工核对的异常</strong>
              <ul>
                {warnings.map((w, index) => (
                  <li key={`${index}:${w}`}>{w}</li>
                ))}
              </ul>
              <Field
                label="人工核对理由"
                required
                hint="写明核对了哪张截图、采用哪个登记值及原因。"
              >
                <textarea
                  className="textarea"
                  disabled={busy}
                  rows={3}
                  value={editor.revision.confirmation || ""}
                  onChange={(e) =>
                    setEditor((previous) =>
                      previous
                        ? {
                            ...previous,
                            revision: {
                              ...previous.revision,
                              confirmation: e.target.value,
                              confirmed: false,
                            },
                          }
                        : previous,
                    )
                  }
                />
              </Field>
              <label className="ops-check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={editor.revision.confirmed}
                  onChange={(e) =>
                    setEditor((previous) =>
                      previous
                        ? {
                            ...previous,
                            revision: {
                              ...previous.revision,
                              confirmed: e.target.checked,
                            },
                          }
                        : previous,
                    )
                  }
                />
                已人工核对原图；保留以上识别异常和原始结果
              </label>
            </div>
          ) : null}
          {editor.id ? (
            <div className="ops-confirmation">
              <h3>新修订的应用范围</h3>
              <p>
                将影响 <strong>{affected.length}</strong>{" "}
                份可见内容的当前版本绑定。不可见内容与历史版本快照保持不变，不新增额外凭证绑定。
              </p>
              <div className="ops-binding-list">
                {affected.map((a) => (
                  <div className="ops-row" key={a.id}>
                    <span>{current(a).title}</span>
                    <span className="ops-code">
                      {a.code} / V{a.current}
                    </span>
                  </div>
                ))}
              </div>
              {affected.length ? (
                <label className="ops-check">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={scopeConsent === scopeKey}
                    onChange={(e) =>
                      setScopeConsent(e.target.checked ? scopeKey : "")
                    }
                  />
                  明确确认：仅将新修订应用到上列内容的当前版本
                </label>
              ) : (
                <p className="muted">没有可见当前版本绑定，仅保存凭证修订。</p>
              )}
            </div>
          ) : (
            <Note>
              登记不会自动关联内容。请在内容详情选择凭证；一个内容版本只绑定一个凭证。
            </Note>
          )}
          {editor.revision.number &&
          state.credentials.some(
            (c) =>
              c.id !== editor.id &&
              credentialLatest(c).number === editor.revision.number,
          ) ? (
            <Note tone="amber">
              <p>
                该编号已有凭证，建议直接复用。审批编号重复不会被判定为文件重复。
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={duplicateConfirmed}
                  onChange={(e) => setDuplicateConfirmed(e.target.checked)}
                />
                已核对，确认继续登记同编号凭证
              </label>
            </Note>
          ) : null}
          {errors.length ? (
            <div role="alert">
              <Note tone="red">
                <ul>
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </Note>
            </div>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
