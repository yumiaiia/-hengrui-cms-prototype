import { articleSource, sampleArticleSource } from "./collectionSources";
import { current, type PublicationStatus, type State } from "./model";

export const publicationStatuses: PublicationStatus[] = [
  "草稿",
  "待发布",
  "已发布",
  "发布失败",
];
export function normalizePublicationStatus(status: string): PublicationStatus {
  if (["处理失败", "发布失败", "需处理"].includes(status)) return "发布失败";
  if (status === "草稿" || status === "已发布") return status;
  return "待发布";
}
export function prepareSimplification(state: State): State {
  if ((state.simplificationRevision || 0) >= 2) return state;
  const s = structuredClone(state);
  if (!s.simplificationRevision) {
    const legacyRoles = new Set(
      s.roles
        .filter((r) => r.id === "medical" || r.name === "医学部高权限用户")
        .map((r) => r.id),
    );
    if (
      s.users.some((u) => legacyRoles.has(u.roleId)) &&
      !s.roles.some((r) => r.id === "operator")
    ) {
      s.roles.push({
        id: "operator",
        name: "普通用户",
        menus: ["workbench", "library", "publishing", "collection", "tags"],
        permissions: ["upload", "edit", "publish", "tags", "export"],
      });
    }
    s.roles = s.roles.filter((r) => !legacyRoles.has(r.id));
    for (const user of s.users)
      if (legacyRoles.has(user.roleId)) user.roleId = "operator";
    for (const role of s.roles)
      role.permissions = role.permissions.filter(
        (p) => String(p) !== "collect",
      );
    for (const p of s.publications || []) {
      if (String(p.status) === "状态待确认") p.error ||= "发布结果待核实";
      p.status = normalizePublicationStatus(p.status);
      for (const preview of p.previews)
        preview.status = normalizePublicationStatus(preview.status);
    }
    for (const article of s.articles) {
      const asset = s.assets.find((a) => a.id === article.assetId);
      article.sourceUrl ||=
        article.collectedVersion?.sourceUrl ||
        (asset && current(asset).sourceUrl);
      if (["发现更新", "未变化"].includes(article.status))
        article.status = "成功";
    }
    for (const notice of s.notices) {
      if (notice.route.startsWith("tasks"))
        notice.route = notice.title.includes("导出")
          ? "library?exports=1"
          : "library";
      if (notice.route.includes("view=pages"))
        notice.route = notice.route.replace(/([?&])view=pages(&?)/, "$1");
    }
  }
  for (const article of s.articles) {
    const asset = s.assets.find((a) => a.id === article.assetId);
    article.sourceUrl ||=
      articleSource(article, asset) || sampleArticleSource(article);
  }
  s.simplificationRevision = 2;
  return s;
}
