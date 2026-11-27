import { now, uid, type Audit, type AuditModule, type State } from "./model";

export const auditModules: AuditModule[] = [
  "内容库",
  "发布管理",
  "标签管理",
  "系统管理",
  "公众号采集",
];
export type AuditInput = Pick<Audit, "action" | "object"> &
  Partial<Omit<Audit, "id" | "at" | "user" | "action" | "object">>;
const readAction =
  /查看|查询|搜索|下载|导出|登录|退出|预览|反馈|后台任务|任务完成|处理完成|匹配结果|解析打标完成/;
const writeAction =
  /新增|创建|上传|提交|保存|修改|编辑|更新|启用|停用|删除|作废|导入|归档|确认|采纳|采用|复用|忽略|取消|恢复|匹配|重试|校正|核对|修订|登记|维护/;
export function isUserWriteAudit(
  audit: Pick<Audit, "action" | "source"> & Partial<Pick<Audit, "user">>,
) {
  return (
    audit.source !== "系统" &&
    audit.user !== "系统" &&
    !readAction.test(audit.action) &&
    writeAction.test(audit.action)
  );
}
export function auditModule(
  audit: Pick<Audit, "action" | "category" | "module">,
): AuditModule {
  if (audit.module) return audit.module;
  if (/发布/.test(audit.action)) return "发布管理";
  if (/用户|账号|角色|权限/.test(audit.action) || audit.category === "系统")
    return "系统管理";
  if (/采集/.test(audit.action)) return "公众号采集";
  if (
    /标签|维度|取值|派生规则|规则/.test(audit.action) &&
    !/内容|暂存|归档|材料|页级/.test(audit.action)
  )
    return "标签管理";
  return "内容库";
}
export function auditSummary(audit: Pick<Audit, "object" | "summary">) {
  const text = (audit.summary || audit.object || "—")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 70 ? `${text.slice(0, 69)}…` : text;
}
export function userWriteAudits(s: State) {
  return s.audits.filter(isUserWriteAudit);
}
export function appendAudit(
  s: State,
  input: AuditInput,
  actorState: State = s,
) {
  if (!isUserWriteAudit(input)) return;
  const person = actorState.users.find(
    (u) => u.id === (input.actorId ?? actorState.userId),
  );
  if (!person || person.enabled === false) return;
  const module = auditModule({ ...input, category: input.category || "内容" });
  const summary = auditSummary(input);
  s.audits.unshift({
    id: uid("audit"),
    at: now(),
    user: person.name,
    employeeId: person.employeeId,
    actorId: person.id,
    module,
    action: input.action,
    object: summary,
    summary,
    detail: "",
    category: input.category || "内容",
    source: "人工",
    result: input.result || "成功",
  });
}
// A submitted user write produces one record; background and view-state updates have no event.
export function mutationAudit(before: State, after: State, input?: AuditInput) {
  if (input) appendAudit(after, input, before);
}
export function prepareReview(s: State) {
  if (s.reviewRevision === 2) return s;
  const next = structuredClone(s);
  next.uploadBatches ||= [];
  next.reviewRevision = 2;
  return next;
}
