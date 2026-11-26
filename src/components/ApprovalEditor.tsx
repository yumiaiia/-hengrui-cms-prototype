import { useEffect, useRef, useState } from "react";
import { ImagePlus, Search, Check, ArrowUpRight } from "lucide-react";
import { useCMS } from "../store";
import {
  approvalExpiryFromNumber,
  canRole,
  credentialErrors,
  credentialLatest,
  current,
  now,
  ocrWarnings,
  pushNotice,
  uid,
  visibleFor,
  type Approval,
  type CredentialRevision,
  type State,
  type User,
} from "../model";
import { demoCredential } from "../seed";
import { loadBlob, putFiles } from "../storage";
import { AssetImage, Button, Dialog, Empty, Field } from "./ui";

// Reuse provenance is transient, not part of the persisted revision schema.
const origins = new WeakMap<CredentialRevision, string>();
export function approvalDraft(
  value?: CredentialRevision,
  credentialId?: string,
): CredentialRevision {
  const result = value
    ? structuredClone(value)
    : {
        revision: 1,
        number: "",
        title: "",
        expiry: "",
        evidence: [],
        confirmed: false,
        updatedAt: now(),
      };
  result.confirmed = false;
  result.confirmation = undefined;
  if (credentialId) origins.set(result, credentialId);
  return result;
}
export function approvalFieldErrors(
  value: CredentialRevision,
): Record<string, string> {
  const messages = credentialErrors({ ...value, confirmed: true });
  return Object.fromEntries(
    messages.map((message) => [
      message.includes("编号")
        ? "number"
        : message.includes("有效期")
          ? "expiry"
          : "evidence",
      message,
    ]),
  );
}
export function acceptApproval(value: CredentialRevision): CredentialRevision {
  const result = {
    ...value,
    confirmed: true,
    confirmation:
      "已人工核对截图中的审批编号、有效期和审批单标题，确认按填写信息保存；原始 OCR 结果保留。",
  };
  const origin = origins.get(value);
  if (origin) origins.set(result, origin);
  return result;
}
export function persistApproval(
  state: State,
  value: CredentialRevision | null,
  actor: User,
  assetIds: string[],
  allowedIds: string[],
): Approval {
  if (!value) return { mode: "exempt" };
  if (credentialErrors(value).length)
    throw new Error("请补全审批信息并确认识别结果。");
  const number = value.number.trim();
  const origin = origins.get(value);
  const credential =
    state.credentials.find(
      (c) => allowedIds.includes(c.id) && c.id === origin,
    ) ||
    state.credentials.find(
      (c) =>
        allowedIds.includes(c.id) &&
        credentialLatest(c).number.trim() === number,
    );
  const snapshot = structuredClone(value);
  snapshot.number = number;
  snapshot.title = snapshot.title.trim();
  snapshot.revision = credential
    ? Math.max(...credential.revisions.map((r) => r.revision)) + 1
    : 1;
  snapshot.updatedAt = now();
  const credentialId = credential?.id || uid("credential");
  if (credential) credential.revisions.push(structuredClone(snapshot));
  else
    state.credentials.push({
      id: credentialId,
      revisions: [structuredClone(snapshot)],
      createdAt: now(),
      createdBy: actor.id,
    });
  const warnings = ocrWarnings(snapshot);
  if (warnings.length)
    pushNotice(state, {
      adminOnly: true,
      title: "审批信息存在 OCR 差异已人工核对",
      detail: `审批编号 ${number}，关联 ${assetIds.length} 份内容；已按人工填写值保存，原始识别结果保留。`,
      route: `content/${assetIds[0]}?tab=approval`,
    });
  return { mode: "registered", credentialId, snapshot };
}

export function ApprovalForm({
  value,
  onChange,
  errors = {},
}: {
  value: CredentialRevision;
  onChange: (value: CredentialRevision) => void;
  errors?: Record<string, string>;
}) {
  const { state, can } = useCMS();
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [reuseId, setReuseId] = useState("");
  const [reuseOpen, setReuseOpen] = useState(false);
  const [reuseSearch, setReuseSearch] = useState("");
  const [reuseChoice, setReuseChoice] = useState("");
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const inFlight = useRef(false);
  const active = useRef(true);
  const suppliedHere = useRef(new Set<string>());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const credentials = can("edit") ? state.credentials : [];
  function change(patch: Partial<CredentialRevision>) {
    const before = latest.current.value;
    const applied = { ...patch };
    if (patch.number !== undefined) {
      const derived = approvalExpiryFromNumber(patch.number);
      if (derived) applied.expiry = derived;
    }
    const result = {
      ...before,
      ...applied,
      confirmed: false,
      confirmation: undefined,
      updatedAt: now(),
    };
    const origin = origins.get(before);
    if (origin) origins.set(result, origin);
    latest.current.onChange(result);
  }
  useEffect(() => {
    if (value.evidence.length > 1) {
      change({ evidence: [structuredClone(value.evidence[0])] });
    }
  }, [value.evidence]);
  async function upload(file?: File) {
    if (!file || inFlight.current) return;
    if (!file.type.startsWith("image/"))
      return setFileError("请选择有效的审批截图图片。");
    if (file.size > 20 * 1024 * 1024)
      return setFileError("请上传一张审批截图（不超过 20 MB）。");
    inFlight.current = true;
    setBusy(true);
    setFileError("");
    change({ evidence: [] });
    try {
      const src = URL.createObjectURL(file);
      try {
        const image = new Image();
        image.src = src;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error("图片无效");
      } finally {
        URL.revokeObjectURL(src);
      }
      const fileKey = uid("evidence-file");
      await putFiles([{ key: fileKey, blob: file }]);
      if (active.current) {
        const evidenceId = uid("evidence");
        suppliedHere.current.add(evidenceId);
        change({
          evidence: [
            {
              id: evidenceId,
              name: file.name,
              fileKey,
              number: "",
              title: "",
              expiry: "",
              status: "无法识别",
            },
          ],
        });
      }
    } catch {
      if (active.current) setFileError("图片无法读取或保存，请重新选择。");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  function reuse(id: string) {
    suppliedHere.current.clear();
    setReuseId(id);
    const credential = credentials.find((c) => c.id === id);
    if (!credential) return;
    const result = approvalDraft(credentialLatest(credential), id);
    result.evidence = result.evidence.slice(0, 1);
    setFileError("");
    onChange(result);
  }
  const shot = value.evidence[0];
  async function retryOCR() {
    if (!shot || inFlight.current || !can("edit")) return;
    inFlight.current = true;
    setBusy(true);
    setFileError("");
    try {
      const blob = await loadBlob(shot.fileKey, shot.url);
      if (!blob.size) throw new Error("截图文件为空，请替换截图");
      if (active.current) {
        // Local samples retain their supplied recognition; uploaded images have no OCR service.
        change({ evidence: [{ ...shot }], confirmed: false });
        if (shot.status === "无法识别")
          setFileError("未识别出审批信息，请替换截图或填写后人工核对");
      }
    } catch (error) {
      if (active.current)
        setFileError(
          error instanceof Error ? error.message : "截图读取失败，请替换截图",
        );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  const duplicate = credentials.find(
    (c) => credentialLatest(c).number.trim() === value.number.trim(),
  );
  return (
    <div className="approval-form" data-approval-busy={busy}>
      <fieldset disabled={busy}>
        <div className="approval-entry-actions">
          <Button
            type="button"
            onClick={() => {
              setReuseOpen(true);
              setReuseChoice("");
            }}
          >
            使用已有审批信息 <ArrowUpRight size={14} />
          </Button>
          <details className="approval-demo">
            <summary>演示样例</summary>
            <p>上传截图会保存在本地；可用以下样例体验 OCR 一致与差异结果。</p>
            <button
              type="button"
              onClick={() => {
                setReuseId("");
                onChange(approvalDraft(demoCredential));
              }}
            >
              填入一致结果
            </button>
            <button
              type="button"
              onClick={() => {
                const value = approvalDraft(demoCredential);
                value.evidence[0].number = "APP-DEMO-999";
                onChange(value);
              }}
            >
              填入差异结果
            </button>
          </details>
        </div>
        {reuseOpen ? (
          <Dialog
            wide
            title="选择已有审批信息"
            onClose={() => setReuseOpen(false)}
            footer={
              <>
                <Button onClick={() => setReuseOpen(false)}>取消</Button>
                <Button
                  variant="primary"
                  disabled={!reuseChoice}
                  onClick={() => {
                    reuse(reuseChoice);
                    setReuseOpen(false);
                  }}
                >
                  使用此审批信息
                </Button>
              </>
            }
          >
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="搜索审批信息"
                placeholder="搜索审批编号或审批单名称"
                value={reuseSearch}
                onChange={(e) => setReuseSearch(e.target.value)}
              />
            </div>
            <div className="credential-choice-list">
              {credentials
                .filter((c) => {
                  const r = credentialLatest(c);
                  return [r.number, r.title]
                    .join(" ")
                    .toLowerCase()
                    .includes(reuseSearch.toLowerCase());
                })
                .map((c) => {
                  const r = credentialLatest(c);
                  const e = r.evidence[0];
                  return (
                    <button
                      type="button"
                      className={`credential-choice ${reuseChoice === c.id ? "selected" : ""}`}
                      key={c.id}
                      onClick={() => setReuseChoice(c.id)}
                    >
                      {e && can("evidence") ? (
                        <AssetImage
                          src={e.fileKey ? "local:" + e.fileKey : e.url}
                          alt="审批截图"
                        />
                      ) : (
                        <ImagePlus size={28} />
                      )}
                      <span>
                        <strong>{r.number}</strong>
                        <small>{r.title || "审批信息"}</small>
                        <small>有效期至 {r.expiry}</small>
                      </span>
                      {reuseChoice === c.id ? <Check size={20} /> : null}
                    </button>
                  );
                })}
              {!credentials.filter((c) => {
                const r = credentialLatest(c);
                return [r.number, r.title]
                  .join(" ")
                  .toLowerCase()
                  .includes(reuseSearch.toLowerCase());
              }).length ? (
                <p className="muted">
                  {reuseSearch
                    ? "没有匹配的审批信息，请更换关键词。"
                    : "暂无可复用的审批信息，请先填写。"}
                </p>
              ) : null}
            </div>
          </Dialog>
        ) : null}
        {reuseId ? (
          <p className="reuse-applied">
            <Check size={14} />
            已使用已有审批信息，可修改本次登记值。
          </p>
        ) : null}
        <Field label="审批编号" required error={errors.number}>
          <input
            aria-label="审批编号"
            aria-invalid={!!errors.number}
            value={value.number}
            onChange={(e) => change({ number: e.target.value })}
            placeholder="填写审批单上的编号"
          />
        </Field>
        <Field label="有效期" required error={errors.expiry}>
          <input
            aria-label="审批有效期"
            aria-invalid={!!errors.expiry}
            type="date"
            value={value.expiry}
            onChange={(e) => change({ expiry: e.target.value })}
          />
        </Field>
        {value.expiry && value.expiry === approvalExpiryFromNumber(value.number) ? (
          <small className="muted">
            已按编号末段年月自动填入该月最后一天；末段无法解析时需手动填写。
          </small>
        ) : null}
        <div
          className={`approval-shot ${errors.evidence || fileError ? "field-error" : ""}`}
        >
          <label className="btn btn-secondary">
            <ImagePlus size={15} />
            {busy ? "保存截图…" : shot ? "替换审批截图" : "上传一张审批截图"}
            <input
              aria-label="上传审批截图"
              aria-invalid={!!(errors.evidence || fileError)}
              type="file"
              accept="image/*"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {shot ? (
            <>
              {can("evidence") || suppliedHere.current.has(shot.id) ? (
                <AssetImage
                  src={shot.fileKey ? "local:" + shot.fileKey : shot.url}
                  alt={shot.name}
                />
              ) : (
                <p className="permission-note">
                  截图已关联，当前账号没有查看已保存截图的权限。
                </p>
              )}
              <small>{shot.name}</small>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  change({ evidence: [] });
                }}
              >
                移除截图
              </button>
            </>
          ) : null}
          {errors.evidence || fileError ? (
            <small className="error-text" role="alert">
              {fileError || errors.evidence}
            </small>
          ) : null}
        </div>
        {shot ? (
          <section
            className={`ocr-result ${ocrWarnings(value).length ? "has-warning" : "is-consistent"}`}
          >
            <div className="section-heading">
              <strong>
                {busy
                  ? "正在识别审批截图…"
                  : ocrWarnings(value).length
                    ? "请核对识别结果"
                    : "审批信息一致"}
              </strong>
              <Button
                type="button"
                disabled={busy || !can("edit")}
                onClick={() => void retryOCR()}
              >
                重试识别
              </Button>
            </div>
            <div className="ocr-comparison">
              <div>
                <span>核对项</span>
                <span>填写值</span>
                <span>识别值</span>
              </div>
              {(["number", "expiry"] as const).map((key) => (
                <div key={key}>
                  <span>{key === "number" ? "审批编号" : "有效期"}</span>
                  <strong>{value[key] || "待填写"}</strong>
                  <span
                    className={
                      !shot[key] || shot[key] !== value[key]
                        ? "comparison-warning"
                        : ""
                    }
                  >
                    {shot[key] || "无法识别"}
                  </span>
                </div>
              ))}
            </div>
            {ocrWarnings(value).length ? (
              <ul className="ocr-warnings">
                {ocrWarnings(value).map((w) => (
                  <li key={w}>{w.replace(/^.*?：/, "")}</li>
                ))}
              </ul>
            ) : null}
            {shot.title ? (
              <p className="ocr-title">识别标题：{shot.title}</p>
            ) : null}
            <p>
              {ocrWarnings(value).length
                ? "不影响归档；提交时请再次确认，系统将保留识别结果。"
                : "编号与有效期已完成比对。"}
            </p>
          </section>
        ) : null}
        {duplicate && value.number.trim() ? (
          <small className="muted">
            此编号已有登记；保存将新增审批修订，仅关联本次内容版本。
          </small>
        ) : null}
      </fieldset>
    </div>
  );
}

export function ApprovalEditor({
  assetIds,
  onClose,
}: {
  assetIds: string[];
  onClose: () => void;
}) {
  const cms = useCMS();
  const latest = useRef(cms);
  latest.current = cms;
  const root = useRef<HTMLDivElement>(null);
  const [base] = useState(() =>
    cms.assets
      .filter((a) => assetIds.includes(a.id))
      .map((a) => ({
        id: a.id,
        version: a.current,
        approval: JSON.stringify(current(a).approval),
      })),
  );
  const [actorId] = useState(cms.user?.id);
  const initial = cms.assets.find((a) => a.id === base[0]?.id);
  const initialApproval = initial && current(initial).approval;
  const [mode, setMode] = useState<"registered" | "exempt">(() =>
    base.length &&
    base.every(
      (b) =>
        cms.assets.find((a) => a.id === b.id) &&
        current(cms.assets.find((a) => a.id === b.id)!).approval.mode ===
          "exempt",
    ) &&
    cms.can("exempt")
      ? "exempt"
      : "registered",
  );
  const [draft, setDraft] = useState(() =>
    approvalDraft(initialApproval?.snapshot, initialApproval?.credentialId),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const validScope =
    cms.user?.id === actorId &&
    base.length > 0 &&
    base.length === new Set(assetIds).size &&
    base.every((b) =>
      cms.assets.some((a) => a.id === b.id && a.lifecycle === "正常"),
    );
  function focusError() {
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(
          '.field-error input,.field-error select,[aria-invalid="true"]',
        )
        ?.focus(),
    );
  }
  async function save(accepted?: CredentialRevision) {
    if (saving.current) return;
    const ctx = latest.current;
    if (!ctx.can("edit") || !validScope)
      return setError("没有编辑权限或所选内容已不可编辑。");
    if (mode === "exempt" && !ctx.can("exempt"))
      return setError("当前角色没有免登记权限。");
    if (root.current?.querySelector('[data-approval-busy="true"]'))
      return setError("请等待审批截图保存完成。");
    const value = accepted || draft;
    const fields = mode === "registered" ? approvalFieldErrors(value) : {};
    setErrors(fields);
    if (Object.keys(fields).length) {
      focusError();
      return;
    }
    if (
      mode === "registered" &&
      ocrWarnings(value).length &&
      !value.confirmed
    ) {
      setConfirming(true);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "registered")
        await loadBlob(value.evidence[0].fileKey, value.evidence[0].url);
      const success = ctx.update(
        (s) => {
          const actor = s.users.find((u) => u.id === s.userId);
          const role = s.roles.find((r) => r.id === actor?.roleId);
          if (
            !actor ||
            actor.id !== actorId ||
            !canRole(role, "edit") ||
            (mode === "exempt" && !canRole(role, "exempt"))
          )
            throw new Error("权限已变化，审批信息未保存。");
          const visible = visibleFor(s, actor, role);
          const selected = base.map((b) => {
            const asset = visible.find((a) => a.id === b.id);
            if (
              !asset ||
              asset.lifecycle !== "正常" ||
              asset.current !== b.version ||
              JSON.stringify(current(asset).approval) !== b.approval
            )
              throw new Error("内容或审批信息已更新，请关闭后重新打开。");
            return asset;
          });
          const scope = s.credentials.map((c) => c.id);
          const approval = persistApproval(
            s,
            mode === "registered" ? value : null,
            actor,
            selected.map((a) => a.id),
            scope,
          );
          for (const asset of selected) {
            current(asset).approval = structuredClone(approval);
            asset.updatedAt = now();
          }
        },
        {
          action: "更新当前版本审批信息",
          object: `${base.length} 份内容`,
          detail:
            mode === "exempt"
              ? "统一免登记；历史版本保留。"
              : "统一登记一张截图；仅修改所选当前版本，其他关联及历史记录保留。",
        },
        "edit",
      );
      if (success) {
        ctx.toast("审批信息已保存。");
        onClose();
      } else setError("审批信息未保存，请检查权限和浏览器存储后重试。");
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="编辑审批信息"
      onClose={() => {
        if (!saving.current) onClose();
      }}
      footer={
        validScope && cms.can("edit") ? (
          <>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "保存审批信息"}
            </Button>
          </>
        ) : undefined
      }
    >
      {!validScope || !cms.can("edit") ? (
        <Empty
          title="无法编辑审批信息"
          description="仅可编辑有权限访问的正常内容当前版本。"
        />
      ) : (
        <div ref={root}>
          <p className="muted">
            统一应用于所选 {base.length} 份内容的当前版本。
          </p>
          <fieldset disabled={busy}>
            <div className="batch-mode">
              <label>
                <input
                  type="radio"
                  name="editor-approval-mode"
                  checked={mode === "registered"}
                  onChange={() => {
                    setMode("registered");
                    setConfirming(false);
                  }}
                />
                需登记审批信息
              </label>
              <label>
                <input
                  type="radio"
                  name="editor-approval-mode"
                  checked={mode === "exempt"}
                  disabled={!cms.can("exempt")}
                  onChange={() => {
                    setMode("exempt");
                    setConfirming(false);
                    setErrors({});
                  }}
                />
                无需登记审批信息
                {!cms.can("exempt") ? (
                  <small>当前角色无免登记权限</small>
                ) : null}
              </label>
            </div>
            {mode === "registered" ? (
              <ApprovalForm
                value={draft}
                errors={errors}
                onChange={(value) => {
                  setDraft(value);
                  setErrors({});
                  setConfirming(false);
                }}
              />
            ) : (
              <small>免填审批编号、有效期和截图。</small>
            )}
          </fieldset>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          {confirming && mode === "registered" ? (
            <div className="ocr-inline" role="alert">
              <p>OCR 识别有差异或无法识别。请核对截图，原始结果将保留。</p>
              <Button
                disabled={busy}
                variant="primary"
                onClick={() => {
                  const value = acceptApproval(draft);
                  setDraft(value);
                  setConfirming(false);
                  void save(value);
                }}
              >
                确认按填写信息保存
              </Button>
              <Button
                disabled={busy}
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                返回核对
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
