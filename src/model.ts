import { moduleForPermission } from "./permissions";
export type Kind = "PDF" | "PPT" | "Word" | "图片" | "视频" | "网页";
export type Process = "排队中" | "处理中" | "完成" | "部分失败" | "失败";
export type Permission =
  | "upload"
  | "edit"
  | "publish"
  | "exempt"
  | "tags"
  | "taxonomy"
  | "void"
  | "export"
  | "evidence"
  | "admin"
  | "audit";
export const permissionNames: Record<Permission, string> = {
  upload: "上传内容",
  edit: "编辑内容与审批",
  publish: "创建与提交发布",
  exempt: "免登记审批",
  tags: "维护内容标签",
  taxonomy: "维护标签库与推荐",
  void: "作废内容",
  export: "下载与导出",
  evidence: "查看与下载审批截图",
  admin: "用户与角色管理",
  audit: "查看操作审计",
};
export const accounts = ["自免医时空", "爱医慢时空", "爱医时空", "爱眼医时空"];
export const primaryTagId = (name: string) =>
  `primary-${encodeURIComponent(name)}`;
export interface Evidence {
  id: string;
  name: string;
  url?: string;
  fileKey?: string;
  number: string;
  title: string;
  expiry: string;
  status: "一致" | "差异" | "无法识别";
}
export interface CredentialRevision {
  revision: number;
  number: string;
  title: string;
  expiry: string;
  evidence: Evidence[];
  confirmed: boolean;
  confirmation?: string;
  updatedAt: string;
}
export interface Credential {
  id: string;
  revisions: CredentialRevision[];
  createdAt: string;
  createdBy?: string;
}
export interface Binding {
  tagId: string;
  origin: "AI" | "人工";
  page?: number;
  name?: string;
  parentId?: string;
}
export interface TagExclusion {
  name: string;
  parentId: string;
  page?: number;
}
export interface Approval {
  mode: "pending" | "registered" | "exempt";
  credentialId?: string;
  snapshot?: CredentialRevision;
}
export interface SupplementaryVideo {
  fileKey: string;
  fileName: string;
  size: number;
  type: string;
}
export interface Version {
  number: number;
  title: string;
  kind: Kind;
  fileName: string;
  fileKey?: string;
  fileHash?: string;
  fileUrl?: string;
  previewUrl?: string;
  source: string;
  sourceUrl?: string;
  sourcePublished?: string;
  cover?: string;
  thumbnail?: string;
  videos?: SupplementaryVideo[];
  summary: string;
  author?: string;
  content: string[];
  pages: number;
  createdAt: string;
  uploadedAt?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  archivedAt?: string;
  process: Process;
  tagStatus: "待打标" | "打标中" | "已完成" | "未匹配" | "失败";
  tags: Binding[];
  tagExclusions?: TagExclusion[];
  approval: Approval;
  expiry?: string;
  unmatched?: string;
  changeNote?: string;
  pageStates?: Record<
    number,
    {
      status: "待打标" | "打标中" | "完成" | "失败" | "人工完成";
      error?: string;
    }
  >;
}
export type PublicationStatus = "草稿" | "待发布" | "已发布" | "发布失败";
export interface Publication {
  id: string;
  assetId: string;
  version: number;
  title: string;
  summary: string;
  cover?: string;
  thumbnail?: string;
  snapshot?: Version;
  submittedBy?: string;
  replacesId?: string;
  plannedAt: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  status: PublicationStatus;
  error?: string;
  revision: number;
  previews: {
    id: string;
    platform: string;
    port: string;
    url: string;
    generatedAt: string;
    version: number;
    revision: number;
    status: PublicationStatus;
    actualAt?: string;
  }[];
}
export interface Asset {
  id: string;
  code: string;
  ownerId: string;
  current: number;
  versions: Version[];
  lifecycle: "正常" | "已作废";
  updatedAt: string;
  voidReason?: string;
}
export interface Tag {
  id: string;
  name: string;
  parentId: string | null;
  enabled: boolean;
  external: boolean;
  /** 预置集合一：字典写死集合，锁定禁改/禁停用，Excel 不导出。 */
  locked?: boolean;
  /** 预置集合二：不参与 AI 匹配集合，仅允许人工添加。 */
  manualOnly?: boolean;
}
export interface Suggestion {
  id: string;
  name: string;
  parentId: string;
  mentions: number;
  assetIds: string[];
  contexts?: { assetId: string; version: number; page?: number }[];
  accepted?: { assetId: string; version: number; page?: number }[];
  cancelled?: { assetId: string; version: number; page?: number }[];
  status: "待处理" | "已采纳" | "已忽略";
  resolutions?: {
    assetId: string;
    version: number;
    page?: number;
    tagId: string;
  }[];
}
export interface TaskItem {
  assetId?: string;
  version?: number;
  label: string;
  status: Process;
  error?: string;
  added?: number;
  skipped?: boolean;
}
export interface Task {
  id: string;
  name: string;
  type: "解析与打标" | "OCR" | "采集" | "导出" | "标签匹配";
  tagIds?: string[];
  batchId?: string;
  actorId?: string;
  result?: { added: number; affected: number; skipped: number };
  status: Process;
  items: TaskItem[];
  createdAt: string;
  attempts: number;
  finishAt?: number;
  artifactKey?: string;
  artifactName?: string;
  // Legacy collection-task metadata is retained for saved-data compatibility.
  collection?: {
    number: string;
    account: string;
    trigger: string;
    startedAt?: string;
    addedArticles: number;
    simulated?: boolean;
  };
}
export interface Article {
  sourceUrl?: string;
  collectedAt?: string;
  id: string;
  title: string;
  account: string;
  publishedAt: string;
  checkedAt: string;
  // Legacy values are read only for migration. New article rows must contain a body.
  status: "成功" | "失败" | "发现更新" | "未变化";
  assetId?: string;
  error?: string;
  previousVersion?: Version;
  collectedVersion?: Version;
  before?: string;
  after?: string;
  handled?: boolean;
}
export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  menus: string[];
}
export interface User {
  enabled?: boolean;
  id: string;
  name: string;
  employeeId?: string;
  /** Legacy account retained only for existing data. */
  account?: string;
  roleId: string;
  createdAt: string;
}
export interface AuditChange {
  object: string;
  objectId: string;
  version?: number;
  page?: number;
  field: string;
  before: string;
  after: string;
  route?: string;
}
export type AuditModule =
  "内容库" | "发布管理" | "标签管理" | "系统管理" | "公众号采集";
export interface Audit {
  id: string;
  at: string;
  user: string;
  action: string;
  object: string;
  detail: string;
  category: "内容" | "审批校验" | "标签" | "系统";
  module?: AuditModule;
  summary?: string;
  actorId?: string;
  employeeId?: string;
  source?: "人工" | "系统";
  initiator?: string;
  result?: "成功" | "失败" | "部分成功";
  changes?: AuditChange[];
  batchId?: string;
}
export interface Notice {
  id: string;
  title: string;
  detail: string;
  route: string;
  read: boolean;
  at: string;
  adminOnly?: boolean;
  recipientId?: string;
}
export interface StagedUploadItem {
  id: string;
  v: Version;
  targetId?: string;
  baseVersion?: number;
  revision: number;
  confirmedRevision?: number;
  confirmedBy?: string;
  confirmedAt?: string;
  noApplicableTags?: boolean;
  manualTagging?: boolean;
  finishAt?: number;
  error?: string;
  archiveError?: string;
  archived?: { assetId: string; version: number; at: string };
  cancelled?: { at: string; by: string };
  baseline?: string;
  tagSnapshot?: Tag[];
  confirmedTags?: string;
  recommendations?: {
    id: string;
    name: string;
    parentId: string;
    page?: number;
    resolved?: boolean;
    resolvedTagId?: string;
    cancelled?: boolean;
    suggestionId?: string;
  }[];
}
export interface UploadBatch {
  id: string;
  ownerId: string;
  createdAt: string;
  kind?: "tags";
  tagSnapshot?: Tag[];
  items: StagedUploadItem[];
}
export interface State {
  schema: 2;
  reviewRevision?: number;
  uploadBatches?: UploadBatch[];
  recommendationRevision?: number;
  assets: Asset[];
  credentials: Credential[];
  tags: Tag[];
  suggestions: Suggestion[];
  tasks: Task[];
  articles: Article[];
  users: User[];
  roles: Role[];
  audits: Audit[];
  notices: Notice[];
  userId: string | null;
  publications?: Publication[];
  workspaceRevision?: number;
  administrationRevision?: number;
  employeeIdentityRevision?: number;
  simplificationRevision?: number;
  collectionRevision?: number;
  fileProcessingRevision?: number;
}
export const now = () => new Date().toISOString();
export const uid = (prefix = "id") => `${prefix}-${crypto.randomUUID()}`;
export const current = (asset: Asset) =>
  asset.versions.find((v) => v.number === asset.current)!;
// 同接收人下同标题、同跳转路由且未读的通知自动覆盖合并说明与时间并置顶。
export function pushNotice(
  s: State,
  notice: {
    title: string;
    detail: string;
    route: string;
    recipientId?: string;
    adminOnly?: boolean;
  },
) {
  const existing = s.notices.find(
    (n) =>
      !n.read &&
      n.title === notice.title &&
      n.route === notice.route &&
      (n.recipientId || "") === (notice.recipientId || "") &&
      (n.adminOnly || false) === (notice.adminOnly || false),
  );
  if (existing) {
    existing.detail = notice.detail;
    existing.at = now();
    s.notices = [existing, ...s.notices.filter((n) => n !== existing)];
    return;
  }
  s.notices.unshift({
    id: uid("notice"),
    at: now(),
    read: false,
    ...notice,
  });
}
export const dateLabel = (value: string) => {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  const sameYear = new Date().getFullYear() === Number(get("year"));
  const core = `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  return sameYear ? core : `${get("year")}-${core}`;
};
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function expiryStatus(version: Version, day = today()) {
  const expiry =
    version.approval.mode === "registered"
      ? version.approval.snapshot?.expiry
      : version.expiry;
  if (!expiry) return "未设置";
  const days = Math.round(
    (Date.parse(expiry + "T00:00:00Z") - Date.parse(day + "T00:00:00Z")) /
      86400000,
  );
  return days < 0 ? "已过期" : days <= 30 ? "即将过期" : "生效中";
}
export const approvalLabel = (approval: Approval) =>
  approval.mode === "exempt"
    ? "免登记"
    : approval.mode === "pending"
      ? "待补充"
      : "已登记";
export const credentialLatest = (credential: Credential) =>
  credential.revisions[credential.revisions.length - 1];
export function ocrWarnings(revision: CredentialRevision) {
  const messages: string[] = [];
  for (const e of revision.evidence) {
    if (e.status === "无法识别" || !e.number)
      messages.push(`${e.name}：无法识别审批编号`);
    else if (e.number !== revision.number)
      messages.push(`${e.name}：识别编号与填写编号不一致`);
    if (e.expiry && e.expiry !== revision.expiry)
      messages.push(`${e.name}：识别有效期与登记值不一致`);
    if (e.title && revision.title && e.title !== revision.title)
      messages.push(`${e.name}：审批单标题需人工核对`);
  }
  if (new Set(revision.evidence.map((e) => e.number).filter(Boolean)).size > 1)
    messages.push("多张截图识别出不同编号，请检查是否混入其他凭证");
  if (new Set(revision.evidence.map((e) => e.expiry).filter(Boolean)).size > 1)
    messages.push("多张截图识别出不同有效期，请核对截图来源");
  return messages;
}
export function normalizeApprovalNumber(value: string) {
  return value.normalize("NFKC").trim();
}
// 双结构编号从右向左解析末段年月：结构 A 末两段 `-YYYY-MM`，结构 B 末段 `-YYMM`。
export function approvalExpiryFromNumber(value: string): string {
  const segments = normalizeApprovalNumber(value)
    .split("-")
    .filter((segment) => segment.length);
  if (segments.length < 2) return "";
  const last = segments[segments.length - 1];
  const second = segments[segments.length - 2];
  let year = 0,
    month = 0;
  if (/^\d{2}$/.test(last) && /^\d{4}$/.test(second)) {
    year = Number(second);
    month = Number(last);
  } else if (/^\d{4}$/.test(last)) {
    year = 2000 + Number(last.slice(0, 2));
    month = Number(last.slice(2));
  } else return "";
  if (month < 1 || month > 12 || year < 2000 || year > 2999) return "";
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function approvalNumberError(value: string): string {
  const normalized = normalizeApprovalNumber(value);
  if (!normalized) return "审批编号必填";
  if (normalized.length < 8 || normalized.length > 64)
    return "请填写 8~64 位有效审批编号";
  if (/[\s/()]/.test(normalized))
    return "审批编号不能包含空格、斜杠或括号";
  return "";
}
export function credentialErrors(revision: CredentialRevision) {
  return [
    approvalNumberError(revision.number),
    revision.evidence.length !== 1 &&
      (revision.evidence.length
        ? "每次只能上传一张审批截图"
        : "请上传一张审批截图"),
    (!revision.expiry ||
      !/^\d{4}-\d{2}-\d{2}$/.test(revision.expiry) ||
      Number.isNaN(Date.parse(revision.expiry))) &&
      "有效期必填",
    ocrWarnings(revision).length > 0 &&
      !revision.confirmed &&
      "请人工确认 OCR 异常",
  ].filter(Boolean) as string[];
}
export function canRole(role: Role | undefined, permission: Permission) {
  const module = moduleForPermission(permission);
  return (
    !!role?.permissions.includes(permission) &&
    !!module &&
    role.menus.includes(module.key)
  );
}
export function visibleFor(
  state: State,
  user: User | undefined,
  role: Role | undefined,
) {
  if (!user || !role) return [];
  return state.assets;
}
declare global {
  interface Window {
    cmsLeaveGuard?: () => boolean;
  }
}
export function go(route: string) {
  if (window.cmsLeaveGuard && !window.cmsLeaveGuard()) return;
  window.location.hash = "#/" + route;
}
export function kindOf(name: string, mime = ""): Kind | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "PDF";
  if (["ppt", "pptx"].includes(ext || "")) return "PPT";
  if (["doc", "docx"].includes(ext || "")) return "Word";
  if (["html", "htm"].includes(ext || "")) return "网页";
  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif"].includes(ext || "")
  )
    return "图片";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm"].includes(ext || ""))
    return "视频";
  return null;
}
export function safePublicUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
