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
  | "admin";
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
}
export interface Approval {
  mode: "pending" | "registered" | "exempt";
  credentialId?: string;
  snapshot?: CredentialRevision;
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
  summary: string;
  author?: string;
  content: string[];
  pages: number;
  createdAt: string;
  process: Process;
  tagStatus: "待打标" | "打标中" | "已完成" | "未匹配" | "失败";
  tags: Binding[];
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
}
export interface Suggestion {
  id: string;
  name: string;
  parentId: string;
  mentions: number;
  assetIds: string[];
  contexts?: { assetId: string; version: number; page?: number }[];
  accepted?: { assetId: string; version: number; page?: number }[];
  status: "待处理" | "已采纳" | "已忽略";
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
  account: string;
  roleId: string;
  createdAt: string;
}
export interface Audit {
  id: string;
  at: string;
  user: string;
  action: string;
  object: string;
  detail: string;
  category: "内容" | "审批校验" | "标签" | "系统";
}
export interface Notice {
  id: string;
  title: string;
  detail: string;
  route: string;
  read: boolean;
  at: string;
  adminOnly?: boolean;
}
export interface State {
  schema: 2;
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
  simplificationRevision?: number;
  collectionRevision?: number;
  fileProcessingRevision?: number;
}
export const now = () => new Date().toISOString();
export const uid = (prefix = "id") => `${prefix}-${crypto.randomUUID()}`;
export const current = (asset: Asset) =>
  asset.versions.find((v) => v.number === asset.current)!;
export const dateLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
export function credentialErrors(revision: CredentialRevision) {
  return [
    !revision.number.trim() && "审批编号必填",
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
