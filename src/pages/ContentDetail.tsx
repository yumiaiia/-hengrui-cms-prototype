import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Upload,
  History,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  FileText,
  ShieldCheck,
  ExternalLink,
  Tag as TagIcon,
  RotateCw,
  Edit3,
  ArchiveX,
  AlertCircle,
  Search,
} from "lucide-react";
import { useCMS } from "../store";
import {
  approvalLabel,
  current,
  credentialLatest,
  expiryStatus,
  go,
  dateLabel,
  ocrWarnings,
  now,
} from "../model";
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
  Tabs,
} from "../components/ui";
import { ExportDialog } from "../export";
export default function ContentDetail({ id }: { id: string }) {
  const { assets, state, can, update, toast, retryTask } = useCMS();
  const asset = assets.find((a) => a.id === id);
  const [number, setNumber] = useState(
    Number(new URLSearchParams(location.hash.split("?")[1]).get("version")) ||
      asset?.current ||
      1,
  );
  const [tab, setTab] = useState(
    new URLSearchParams(location.hash.split("?")[1]).get("tab") || "basic",
  );
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [url, setUrl] = useState("");
  const [fileError, setFileError] = useState("");
  const [modal, setModal] = useState("");
  const [tagId, setTagId] = useState("");
  const [scope, setScope] = useState("material");
  const [credentialId, setCredentialId] = useState("");
  const [reason, setReason] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editCover, setEditCover] = useState("");
  const [editThumbnail, setEditThumbnail] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [search, setSearch] = useState("");
  const preview = useRef<HTMLDivElement>(null);
  const v =
    asset?.versions.find((v) => v.number === number) ||
    (asset ? current(asset) : undefined);
  const historical = asset && v ? v.number !== asset.current : false;
  useEffect(() => {
    setNumber(
      Number(new URLSearchParams(location.hash.split("?")[1]).get("version")) ||
        asset?.current ||
        1,
    );
    setPage(1);
  }, [id]);
  useEffect(() => {
    setUrl("");
    setFileError("");
    if (!v) return;
    let active = true;
    let object = "";
    const source = v.previewUrl || v.fileUrl;
    if (v.fileKey && !v.previewUrl) {
      loadBlob(v.fileKey)
        .then((blob) => {
          if (!active) return;
          object = URL.createObjectURL(blob);
          setUrl(object);
        })
        .catch((e) => {
          if (active) setFileError(e.message);
        });
    } else if (source) setUrl(source);
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [v?.fileKey, v?.fileUrl, v?.previewUrl, number, id]);
  if (!asset || !v)
    return (
      <Empty
        title="内容不可访问"
        description="这份内容不存在，或当前角色没有查看权限。"
        action={<Button onClick={() => go("library")}>返回内容库</Button>}
      />
    );
  const editAllowed = can("edit") && !historical;
  const tagAllowed = can("tags") && !historical;
  const tagBindings = v.tags.filter((t) =>
    scope === "material" ? !t.page : t.page === page,
  );
  const affectedTask = state.tasks.find((t) =>
    t.items.some(
      (i) =>
        i.assetId === asset.id && i.version === v.number && i.status === "失败",
    ),
  );
  async function original() {
    if (!can("export")) return toast("当前角色没有下载权限。");
    try {
      download(await loadBlob(v!.fileKey, v!.fileUrl), v!.fileName);
    } catch (e) {
      toast(e instanceof Error ? e.message : "原文件不可用");
    }
  }
  function mutate(
    recipe: (version: typeof v) => void,
    action: string,
    detail = "",
  ) {
    update(
      (s) => {
        const a = s.assets.find((a) => a.id === asset!.id)!;
        const version = a.versions.find((v) => v.number === number)!;
        recipe(version);
        a.updatedAt = now();
      },
      { action, object: asset!.code, detail },
      action.includes("标签") ? "tags" : "edit",
    );
  }
  function addTag() {
    if (!tagId || !tagAllowed) return;
    mutate(
      (version) => {
        if (!version) return;
        if (
          !version.tags.some(
            (t) =>
              t.tagId === tagId &&
              t.page === (scope === "page" ? page : undefined),
          )
        )
          version.tags.push({
            tagId,
            origin: "人工",
            page: scope === "page" ? page : undefined,
          });
        version.unmatched = undefined;
        version.tagStatus = "已完成";
      },
      "人工校正标签",
      state.tags.find((t) => t.id === tagId)?.name,
    );
    setModal("");
    toast("标签已更新，人工校正结果会被保留。");
  }
  function saveBasic() {
    if (!editTitle.trim()) return toast("内容标题不能为空。");
    mutate(
      (version) => {
        if (!version) return;
        version.title = editTitle;
        version.summary = editSummary;
        version.author = editAuthor;
        version.cover = editCover;
        version.thumbnail = editThumbnail;
        if (version.approval.mode === "exempt") version.expiry = editExpiry;
      },
      "修改内容信息",
      "更新标题、摘要及附属信息；文件版本未变化。",
    );
    setModal("");
    toast("内容信息已保存。");
  }
  function associate() {
    const c = state.credentials.find((c) => c.id === credentialId);
    if (!c) return toast("请选择审批凭证。");
    const revision = credentialLatest(c);
    mutate(
      (version) => {
        if (version)
          version.approval = {
            mode: "registered",
            credentialId: c.id,
            snapshot: structuredClone(revision),
          };
      },
      "关联审批凭证",
      `${revision.number} · 修订 ${revision.revision}`,
    );
    setModal("");
    toast("审批凭证已关联。");
  }
  function exempt() {
    if (!can("exempt") || historical) return;
    mutate(
      (version) => {
        if (version) version.approval = { mode: "exempt" };
      },
      "选择免登记审批",
      "审批截图与 OCR 不再要求；原操作记录保留。",
    );
    setModal("");
    toast("已设置免登记审批信息。");
  }
  return (
    <>
      <button className="back-link" onClick={() => go("library")}>
        <ArrowLeft size={16} />
        返回内容库
      </button>
      <PageHeader
        eyebrow={asset.code}
        title={v.title}
        description={`${v.source} · ${dateLabel(v.createdAt)}归档 · ${state.users.find((u) => u.id === asset.ownerId)?.name || "内容维护人"}`}
        action={
          <>
            <Button
              icon={<History size={16} />}
              onClick={() => setModal("history")}
            >
              版本历史
            </Button>
            <Button
              disabled={!can("export")}
              icon={<Download size={16} />}
              onClick={original}
            >
              下载原文件
            </Button>
            {can("upload") ? (
              <Button
                variant="primary"
                disabled={asset.lifecycle === "已作废"}
                title={
                  asset.lifecycle === "已作废"
                    ? "已作废内容只保留历史查询"
                    : undefined
                }
                icon={<Upload size={16} />}
                onClick={() => go("upload?asset=" + asset.id)}
              >
                上传新版本
              </Button>
            ) : null}
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
            }}
          >
            {[...asset.versions].reverse().map((v) => (
              <option key={v.number} value={v.number}>
                V{v.number}.0
                {v.number === asset.current ? " · 当前版本" : " · 历史版本"}
              </option>
            ))}
          </select>
          <Badge>{v.process}</Badge>
          <Badge>{expiryStatus(v)}</Badge>
          {asset.lifecycle === "已作废" ? (
            <Badge tone="red">已作废</Badge>
          ) : null}
          {historical ? (
            <span className="muted">
              历史版本只读 · 当前 V{asset.current}.0
            </span>
          ) : (
            <span className="muted">已归档 · AI 处理独立进行</span>
          )}
        </div>
        <Button
          variant="ghost"
          disabled={!can("export")}
          onClick={() => setModal("export")}
        >
          结构化导出
          <Download size={15} />
        </Button>
      </div>
      {v.process === "失败" || v.process === "部分失败" ? (
        <Note tone="amber">
          <AlertCircle size={17} />
          {affectedTask?.items.find((i) => i.assetId === asset.id)?.error ||
            "后台处理有异常，原文件及历史版本仍可查看。"}
          {affectedTask ? (
            <Button variant="ghost" onClick={() => retryTask(affectedTask.id)}>
              重试失败项
              <RotateCw size={14} />
            </Button>
          ) : null}
        </Note>
      ) : null}
      {asset.voidReason ? (
        <Note tone="amber">
          作废原因：{asset.voidReason}。历史记录保留可查。
        </Note>
      ) : null}
      <div className="detail-workspace">
        <section className="panel document-panel">
          <div className="document-heading">
            <div>
              <FileText size={18} />
              <strong>内容预览</strong>
              <span>{v.kind}</span>
            </div>
            <button
              className="icon-btn"
              aria-label="全屏预览"
              onClick={() => {
                void preview.current?.requestFullscreen();
              }}
            >
              <Maximize size={17} />
            </button>
          </div>
          <div className="document-body">
            <div className="preview-surface" ref={preview}>
              {fileError ? (
                <Empty
                  title="文件暂时无法预览"
                  description={fileError}
                  action={
                    <Button onClick={() => go("upload?asset=" + asset.id)}>
                      重新上传
                    </Button>
                  }
                />
              ) : v.kind === "视频" ? (
                url ? (
                  <video className="video-preview" controls src={url} />
                ) : (
                  <Empty
                    title="示例视频未提供原文件"
                    description="可以上传真实视频，或在新增内容中添加自动生成的演示视频。转码进度为模拟处理。"
                    action={
                      can("upload") ? (
                        <Button onClick={() => go("upload?asset=" + asset.id)}>
                          上传原视频
                        </Button>
                      ) : null
                    }
                  />
                )
              ) : v.kind === "图片" ? (
                url ? (
                  <img className="image-preview" src={url} alt={v.title} />
                ) : (
                  <Empty title="图片暂不可用" />
                )
              ) : v.kind === "网页" ? (
                <article
                  className="article-preview"
                  style={{ fontSize: `${zoom}%` }}
                >
                  <div className="article-eyebrow">{v.source} / 内容转存</div>
                  <h2>{v.title}</h2>
                  {v.cover ? <AssetImage src={v.cover} alt="网页封面" /> : null}
                  {v.sourceUrl ? (
                    <Note tone="amber">
                      本地原型未实际抓取原站内容，以下为已保存的安全文本或登记说明。
                    </Note>
                  ) : v.fileKey ? (
                    <Note>
                      HTML
                      采用安全文本预览，原始文件完整保存；外链图片及脚本不加载。
                    </Note>
                  ) : (
                    <small className="muted">
                      公众号采集演示内容，非真实文章。
                    </small>
                  )}
                  {v.content.map((paragraph, i) => (
                    <p
                      key={i}
                      className={
                        search && paragraph.includes(search)
                          ? "search-highlight"
                          : ""
                      }
                    >
                      {paragraph}
                    </p>
                  ))}
                </article>
              ) : url && (v.kind === "PDF" || v.previewUrl) ? (
                <div className="pdf-frame-wrap">
                  {v.previewUrl ? (
                    <span className="pdf-copy-label">
                      示例 PDF 预览副本 · 原示例 {v.kind} 文件可下载
                    </span>
                  ) : null}
                  <iframe
                    title="文档只读预览"
                    src={`${url}#page=${page}&view=FitH&navpanes=0${zoom === 100 ? "" : `&zoom=${zoom}`}`}
                  />
                </div>
              ) : v.fileKey && (v.kind === "PPT" || v.kind === "Word") ? (
                <Empty
                  title="此格式暂不支持本地在线预览"
                  description="原文件已完整保存，可下载查看。示例 PPT 和 Word 提供独立 PDF 预览副本。"
                  action={<Button onClick={original}>下载原文件</Button>}
                />
              ) : (
                <Empty
                  title="正在准备预览"
                  description="文件加载完成后会显示在这里。"
                />
              )}
            </div>
          </div>
          <div className="preview-controls">
            <button
              className="icon-btn"
              aria-label="前一页"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <input
              aria-label="跳转页码"
              type="number"
              min={1}
              max={v.pages}
              value={page}
              onChange={(e) =>
                setPage(
                  Math.min(v.pages, Math.max(1, Number(e.target.value) || 1)),
                )
              }
            />
            <span>/ {v.pages}</span>
            <button
              className="icon-btn"
              aria-label="后一页"
              disabled={page >= v.pages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
            <i />
            <button
              className="icon-btn"
              aria-label="缩小"
              disabled={zoom <= 50}
              onClick={() => setZoom(zoom - 10)}
            >
              <ZoomOut size={16} />
            </button>
            <span>{zoom === 100 ? "适应宽度" : `${zoom}%`}</span>
            <button
              className="icon-btn"
              aria-label="放大"
              disabled={zoom >= 180}
              onClick={() => setZoom(zoom + 10)}
            >
              <ZoomIn size={16} />
            </button>
            {v.kind === "网页" ? (
              <div className="preview-search">
                <Search size={14} />
                <input
                  aria-label="文内搜索"
                  placeholder="文内搜索"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            ) : (
              <small className="muted">PDF 搜索可使用预览工具栏</small>
            )}
          </div>
        </section>
        <aside className="panel detail-info">
          <Tabs
            items={[
              { key: "basic", label: "信息" },
              { key: "tags", label: "标签" },
              { key: "approval", label: "审批" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="detail-info-body">
            {tab === "basic" ? (
              <>
                <div className="section-heading">
                  <h3>基本信息</h3>
                  {editAllowed ? (
                    <button
                      className="icon-btn"
                      aria-label="编辑内容信息"
                      onClick={() => {
                        setEditTitle(v.title);
                        setEditSummary(v.summary);
                        setEditAuthor(v.author || "");
                        setEditCover(v.cover || "");
                        setEditThumbnail(v.thumbnail || "");
                        setEditExpiry(v.expiry || "");
                        setModal("edit");
                      }}
                    >
                      <Edit3 size={16} />
                    </button>
                  ) : null}
                </div>
                <dl className="detail-meta">
                  <dt>内容编号</dt>
                  <dd className="mono">{asset.code}</dd>
                  <dt>内容类型</dt>
                  <dd>{v.kind}</dd>
                  <dt>当前查看</dt>
                  <dd>
                    V{v.number}.0 {historical ? "（历史）" : "（当前）"}
                  </dd>
                  <dt>内容来源</dt>
                  <dd>{v.source}</dd>
                  <dt>审批登记</dt>
                  <dd>
                    <Badge>{approvalLabel(v.approval)}</Badge>
                  </dd>
                  <dt>有效期</dt>
                  <dd>{v.approval.snapshot?.expiry || v.expiry || "未设置"}</dd>
                  <dt>归档时间</dt>
                  <dd>{dateLabel(v.createdAt)}</dd>
                  {v.sourcePublished ? (
                    <>
                      <dt>原文发布时间</dt>
                      <dd>{v.sourcePublished}</dd>
                    </>
                  ) : null}
                </dl>
                <h3 className="subsection-title">内容摘要</h3>
                <p className="summary-text">{v.summary || "未填写摘要"}</p>
                {v.cover ? (
                  <>
                    <h3 className="subsection-title">封面与缩略图</h3>
                    <AssetImage
                      className="detail-cover"
                      src={v.cover}
                      alt="封面展示"
                    />
                  </>
                ) : null}
                {v.sourceUrl ? (
                  <a
                    className="text-link"
                    href={v.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    查看原文
                    <ExternalLink size={14} />
                  </a>
                ) : null}
                <div className="detail-secondary-actions">
                  <Button variant="ghost" onClick={() => setModal("audit")}>
                    查看操作记录
                  </Button>
                  {can("void") && asset.lifecycle === "正常" ? (
                    <Button variant="danger" onClick={() => setModal("void")}>
                      <ArchiveX size={14} />
                      作废内容
                    </Button>
                  ) : null}
                </div>
              </>
            ) : tab === "tags" ? (
              <>
                <div className="section-heading">
                  <h3>智能标签</h3>
                  <Badge>{v.tagStatus}</Badge>
                </div>
                <div className="segmented">
                  <button
                    className={scope === "material" ? "active" : ""}
                    onClick={() => setScope("material")}
                  >
                    材料级
                  </button>
                  <button
                    className={scope === "page" ? "active" : ""}
                    onClick={() => setScope("page")}
                  >
                    当前页 · {page}
                  </button>
                </div>
                {v.unmatched ? (
                  <Note tone="amber">
                    {v.unmatched}
                    <button
                      className="text-link"
                      onClick={() => go("tags?tab=suggestions")}
                    >
                      查看增补建议
                    </button>
                  </Note>
                ) : null}
                {[
                  "产品 / 品牌",
                  "产品线",
                  "疾病领域",
                  "目标受众",
                  "Key Message",
                  "页面类型",
                  "证据类型",
                ].map((group) => {
                  const bindings = tagBindings.filter(
                    (t) =>
                      state.tags.find((tag) => tag.id === t.tagId)?.group ===
                      group,
                  );
                  return bindings.length ? (
                    <div className="detail-tag-group" key={group}>
                      <h4>{group}</h4>
                      {bindings.map((binding, i) => (
                        <span
                          className={`editable-tag ${binding.origin === "人工" ? "manual" : ""}`}
                          key={binding.tagId + i}
                        >
                          {state.tags.find((t) => t.id === binding.tagId)?.name}
                          <small>{binding.origin}</small>
                          {tagAllowed ? (
                            <button
                              aria-label={`移除标签${state.tags.find((t) => t.id === binding.tagId)?.name}`}
                              onClick={() =>
                                mutate(
                                  (version) => {
                                    if (version)
                                      version.tags = version.tags.filter(
                                        (t) =>
                                          !(
                                            t.tagId === binding.tagId &&
                                            t.page === binding.page
                                          ),
                                      );
                                  },
                                  "移除标签",
                                  binding.tagId,
                                )
                              }
                            >
                              <X size={12} />
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })}
                {!tagBindings.length ? (
                  <p className="muted">
                    此范围暂无标签。AI 正常匹配的标签无需逐条确认。
                  </p>
                ) : null}
                {tagAllowed ? (
                  <Button
                    className="full-width"
                    icon={<Plus size={15} />}
                    onClick={() => {
                      setTagId("");
                      setModal("tag");
                    }}
                  >
                    从标准标签池添加
                  </Button>
                ) : null}
                <div className="tag-legend">
                  <span>AI 自动识别</span>
                  <span>人工校正 · 重跑默认保留</span>
                </div>
              </>
            ) : (
              <>
                <div className="section-heading">
                  <h3>审批信息</h3>
                  <Badge>{approvalLabel(v.approval)}</Badge>
                </div>
                {v.approval.mode === "registered" && v.approval.snapshot ? (
                  <>
                    <div className="credential-stamp">
                      <ShieldCheck size={26} />
                      <small>
                        审批凭证 / 修订 {v.approval.snapshot.revision}
                      </small>
                      <strong>{v.approval.snapshot.number}</strong>
                      <p>{v.approval.snapshot.title || "未登记材料包标题"}</p>
                      <div>
                        <span>有效至 {v.approval.snapshot.expiry}</span>
                        <span>
                          {v.approval.snapshot.evidence.length} 张截图
                        </span>
                      </div>
                    </div>
                    {ocrWarnings(v.approval.snapshot).length ? (
                      <Note tone="amber">
                        原始 OCR 存在异常。
                        {v.approval.snapshot.confirmed
                          ? "已人工确认，识别差异仍保留。"
                          : "请核对原审批单。"}
                        <p>{v.approval.snapshot.confirmation}</p>
                      </Note>
                    ) : (
                      <Badge tone="green">编号与截图识别一致</Badge>
                    )}
                    {can("evidence") ? (
                      <div className="detail-evidence-grid">
                        {v.approval.snapshot.evidence.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => {
                              setModal("evidence");
                            }}
                          >
                            <ShieldCheck size={17} />
                            {e.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">当前角色没有审批截图查看权限。</p>
                    )}
                    <Button
                      className="full-width"
                      onClick={() =>
                        go("credentials?open=" + v.approval.credentialId)
                      }
                    >
                      查看凭证及校验记录
                    </Button>
                  </>
                ) : (
                  <div className="approval-empty">
                    <ShieldCheck size={35} />
                    <h3>
                      {v.approval.mode === "exempt"
                        ? "无需登记审批信息"
                        : "审批信息待补充"}
                    </h3>
                    <p>
                      {v.approval.mode === "exempt"
                        ? "不要求编号、截图和 OCR；有效期可独立设置。"
                        : "内容已经保存，请关联审批凭证或由有权限的人选择免登记。"}
                    </p>
                  </div>
                )}
                {editAllowed ? (
                  <div className="approval-detail-actions">
                    <Button
                      icon={<ShieldCheck size={15} />}
                      onClick={() => {
                        setCredentialId("");
                        setModal("associate");
                      }}
                    >
                      {v.approval.mode === "registered"
                        ? "更换关联凭证"
                        : "关联审批凭证"}
                    </Button>
                    {can("exempt") && v.approval.mode !== "exempt" ? (
                      <Button
                        variant="ghost"
                        onClick={() => setModal("exempt")}
                      >
                        免登记审批信息
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>
      {modal === "export" ? (
        <ExportDialog
          assets={[asset]}
          versions={{ [asset.id]: number }}
          onClose={() => setModal("")}
        />
      ) : modal === "history" ? (
        <Dialog title="版本历史" wide onClose={() => setModal("")}>
          <div className="version-timeline">
            {[...asset.versions].reverse().map((version) => (
              <div key={version.number}>
                <span className="version-marker">V{version.number}.0</span>
                <section>
                  <div>
                    <h3>{version.title}</h3>
                    {version.number === asset.current ? (
                      <Badge tone="blue">当前版本</Badge>
                    ) : null}
                  </div>
                  <p>{version.changeNote || "内容归档"}</p>
                  <small>
                    {dateLabel(version.createdAt)} ·{" "}
                    {version.approval.snapshot?.number ||
                      approvalLabel(version.approval)}
                  </small>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNumber(version.number);
                      setPage(1);
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
      ) : modal === "tag" ? (
        <Dialog
          title={`添加${scope === "page" ? "当前页" : "材料级"}标签`}
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button variant="primary" onClick={addTag}>
                添加标签
              </Button>
            </>
          }
        >
          <Field label="标准标签">
            <select
              aria-label="选择标准标签"
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
            >
              <option value="">搜索并选择正式标签</option>
              {state.tags
                .filter((t) => t.enabled)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.group} / {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <Note>
            添加结果记录为人工校正。标签池之外的建议请在标签管理中审核。
          </Note>
        </Dialog>
      ) : modal === "edit" ? (
        <Dialog
          title="编辑内容信息"
          wide
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button variant="primary" onClick={saveBasic}>
                保存信息
              </Button>
            </>
          }
        >
          <Field label="内容标题" required>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </Field>
          <Field label="摘要（选填）">
            <textarea
              rows={3}
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
            />
          </Field>
          <Field label="作者（选填）">
            <input
              value={editAuthor}
              onChange={(e) => setEditAuthor(e.target.value)}
            />
          </Field>
          {v.approval.mode === "exempt" ? (
            <Field label="内容有效期（选填）">
              <input
                type="date"
                value={editExpiry}
                onChange={(e) => setEditExpiry(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="封面（选填）">
            <CoverPicker
              value={editCover}
              label="上传封面"
              onChange={setEditCover}
            />
          </Field>
          <Field label="缩略图（选填）">
            <CoverPicker
              value={editThumbnail}
              label="上传缩略图"
              onChange={setEditThumbnail}
            />
          </Field>
          <Note>修改信息会记录操作日志，不自动创建新的文件版本。</Note>
        </Dialog>
      ) : modal === "associate" ? (
        <Dialog
          title="关联审批凭证"
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button variant="primary" onClick={associate}>
                确认关联
              </Button>
            </>
          }
        >
          <Note>仅修改当前版本，历史版本的凭证信息保留。</Note>
          <Field label="审批凭证">
            <select
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              <option value="">选择已有凭证</option>
              {state.credentials
                .filter(
                  (c) =>
                    can("admin") ||
                    c.createdBy === state.userId ||
                    assets.some((a) =>
                      a.versions.some((v) => v.approval.credentialId === c.id),
                    ),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {credentialLatest(c).number} · {credentialLatest(c).expiry}
                  </option>
                ))}
            </select>
          </Field>
          <Button variant="ghost" onClick={() => go("credentials")}>
            到审批凭证页登记新凭证
          </Button>
        </Dialog>
      ) : modal === "exempt" ? (
        <Dialog
          title="免登记审批信息"
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button variant="primary" onClick={exempt}>
                确认免登记
              </Button>
            </>
          }
        >
          <Note>
            当前版本不再要求审批编号、截图和
            OCR。已有操作记录仍然保留，内容有效期可单独设置。
          </Note>
        </Dialog>
      ) : modal === "void" ? (
        <Dialog
          title="作废内容"
          onClose={() => setModal("")}
          footer={
            <>
              <Button onClick={() => setModal("")}>取消</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (!reason.trim()) return toast("请填写作废原因。");
                  update(
                    (s) => {
                      const a = s.assets.find((a) => a.id === asset.id)!;
                      a.lifecycle = "已作废";
                      a.voidReason = reason;
                      a.updatedAt = now();
                    },
                    { action: "作废内容", object: asset.code, detail: reason },
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
          <Note tone="amber">
            影响整份内容资产，默认正常列表将不再展示。所有历史版本保留。
          </Note>
          <Field label="作废原因" required>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </Dialog>
      ) : modal === "audit" ? (
        <Dialog title="内容操作记录" wide onClose={() => setModal("")}>
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>人员</th>
                <th>操作</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {state.audits
                .filter((log) => log.object === asset.code)
                .map((log) => (
                  <tr key={log.id}>
                    <td>{dateLabel(log.at)}</td>
                    <td>{log.user}</td>
                    <td>{log.action}</td>
                    <td>{log.detail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!state.audits.some((log) => log.object === asset.code) ? (
            <Empty
              title="暂无独立操作记录"
              description="后续修改和版本操作会记录在这里。"
            />
          ) : null}
        </Dialog>
      ) : modal === "evidence" && can("evidence") ? (
        <Dialog
          title="审批截图与原始识别结果"
          wide
          onClose={() => setModal("")}
        >
          <div className="evidence-grid">
            {v.approval.snapshot?.evidence.map((e) => (
              <article key={e.id} className="evidence-card">
                {e.url ? (
                  <img src={e.url} alt={e.name} />
                ) : (
                  <p>截图保存在浏览器，可在凭证详情中查看。</p>
                )}
                <strong>{e.name}</strong>
                <p>识别编号：{e.number || "无法识别"}</p>
                <p>识别有效期：{e.expiry || "无法识别"}</p>
                <Badge>{e.status}</Badge>
              </article>
            ))}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
