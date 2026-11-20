import {
  canRole,
  current,
  now,
  uid,
  visibleFor,
  type Publication,
  type State,
} from "./model";
import { publicationProblems } from "./workflow";
export interface ReleaseInput {
  assetId: string;
  version: number;
  title: string;
  summary: string;
  cover: string;
  thumbnail: string;
}
export function releaseInput(asset: State["assets"][number]): ReleaseInput {
  const v = current(asset);
  return {
    assetId: asset.id,
    version: v.number,
    title: v.title,
    summary: v.summary,
    cover: v.cover || v.thumbnail || "",
    thumbnail: v.thumbnail || v.cover || "",
  };
}
export function publicationVersionNotice(
  p: Publication,
  currentVersion: number,
) {
  if (p.version === currentVersion) return "";
  return p.status === "草稿"
    ? `内容已更新至 V${currentVersion}.0，请同步后核对发布信息。`
    : `本记录对应 V${p.version}.0，当前内容为 V${currentVersion}.0。原发布状态与预览保留；如需发布新版本，请另建发布记录。`;
}
// Validate the whole selection before writing any record: no partial batch submission.
export function saveReleaseBatch(
  state: State,
  inputs: ReleaseInput[],
  plannedAt: string,
  submit: boolean,
  draftId?: string,
  replacesId?: string,
) {
  const actor = state.users.find((u) => u.id === state.userId);
  const role = state.roles.find((r) => r.id === actor?.roleId);
  if (!canRole(role, "publish")) throw new Error("当前账号不能提交发布。");
  const allowed = visibleFor(state, actor, role);
  if (!inputs.length) throw new Error("请至少选择一份内容。");
  if (new Set(inputs.map((i) => i.assetId)).size !== inputs.length)
    throw new Error("不能重复选择同一份内容。");
  const old = state.publications?.find((p) => p.id === draftId);
  if (
    draftId &&
    (!old ||
      old.status !== "草稿" ||
      !allowed.some((a) => a.id === old.assetId))
  )
    throw new Error("仅可编辑当前可访问的草稿；已提交记录需另建发布。");
  if (draftId && (inputs.length !== 1 || inputs[0].assetId !== old?.assetId))
    throw new Error("草稿只能编辑原关联内容。");
  if (plannedAt && Number.isNaN(Date.parse(plannedAt)))
    throw new Error("请填写有效的拟发布时间。");
  if (submit && (!plannedAt || Date.parse(plannedAt) <= Date.now()))
    throw new Error("请选择未来的拟发布时间（北京时间）。");
  const checked = inputs.map((input) => {
    const a = allowed.find((a) => a.id === input.assetId);
    if (!a || a.lifecycle !== "正常")
      throw new Error("所选内容已作废或不可访问，请重新选择。");
    const v = current(a);
    if (v.number !== input.version)
      throw new Error(`《${input.title}》已有新版本，请重新选择并核对。`);
    if (!input.title.trim()) throw new Error(`《${v.title}》缺少发布标题。`);
    if (submit) {
      const problems = publicationProblems(a, v);
      if (!input.cover) problems.push("请上传封面或选择默认图片");
      if (!input.thumbnail) problems.push("请上传缩略图或使用封面");
      const expiry = v.approval.snapshot?.expiry || v.expiry;
      const plannedDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(plannedAt));
      if (expiry && plannedDay > expiry)
        problems.push("拟发布时间超过内容有效期");
      if (problems.length)
        throw new Error(`《${input.title}》：${problems.join("；")}`);
    }
    return { input, v };
  });
  const records: Publication[] = checked.map(({ input, v }) => ({
    id: old?.id || uid("publication"),
    assetId: input.assetId,
    version: input.version,
    title: input.title.trim(),
    summary: input.summary,
    cover: input.cover,
    thumbnail: input.thumbnail,
    snapshot: submit ? structuredClone(v) : undefined,
    submittedBy: actor!.id,
    plannedAt,
    status: submit ? "待发布" : "草稿",
    submittedAt: submit ? now() : undefined,
    createdAt: old?.createdAt || now(),
    updatedAt: now(),
    revision: (old?.revision || 0) + 1,
    replacesId,
    previews: [],
  }));
  state.publications ||= [];
  if (old) Object.assign(old, records[0]);
  else state.publications.unshift(...records);
  return records.map((p) => p.id);
}
