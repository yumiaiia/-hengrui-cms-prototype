import {
  canRole,
  current,
  uid,
  now,
  visibleFor,
  type State,
  type Tag,
  type Asset,
  type Suggestion,
} from "./model";
export const primaryTags = (tags: Tag[]) =>
  tags.filter((t) => t.parentId === null);
export const primaryOf = (tags: Tag[], tag: Tag) =>
  tag.parentId ? tags.find((t) => t.id === tag.parentId) : tag;
export const tagLabel = (tags: Tag[], tag: Tag) =>
  tag.parentId
    ? `${primaryOf(tags, tag)?.name || "未分类"} / ${tag.name}`
    : tag.name;
export const availableTag = (tags: Tag[], tag: Tag) =>
  tag.enabled &&
  (!tag.parentId ||
    tags.some(
      (parent) =>
        parent.id === tag.parentId &&
        parent.parentId === null &&
        parent.enabled,
    ));
export function validateTag(
  tags: Tag[],
  draft: Pick<Tag, "name" | "parentId"> & { id?: string },
) {
  if (!draft.name.trim()) return "请输入标签名称";
  if (
    draft.parentId &&
    !tags.some(
      (t) =>
        t.id === draft.parentId && t.parentId === null && t.id !== draft.id,
    )
  )
    return "二级标签只能归属一级标签，不支持第三级";
  if (
    tags.some(
      (t) =>
        t.id !== draft.id &&
        t.parentId === draft.parentId &&
        t.name.trim().toLocaleLowerCase() ===
          draft.name.trim().toLocaleLowerCase(),
    )
  )
    return "该层级下已有同名标签";
  return "";
}
export function suggestionContexts(s: Suggestion, assets: Asset[]) {
  return (
    s.contexts ||
    s.assetIds.flatMap((id) => {
      const asset = assets.find((a) => a.id === id);
      return asset
        ? [{ assetId: id, version: asset.current, page: undefined }]
        : [];
    })
  );
}
export function recommendationSources(
  suggestion: Suggestion,
  assets: Asset[],
  tags: Tag[],
) {
  return suggestionContexts(suggestion, assets)
    .filter(
      (context, index, all) =>
        all.findIndex(
          (other) =>
            other.assetId === context.assetId &&
            other.version === context.version &&
            other.page === context.page,
        ) === index,
    )
    .map((context) => {
      const asset = assets.find((a) => a.id === context.assetId);
      const version = asset?.versions.find((v) => v.number === context.version);
      const accepted =
        !!suggestion.accepted?.some(
          (a) =>
            a.assetId === context.assetId &&
            a.version === context.version &&
            a.page === context.page,
        ) ||
        !!version?.tags.some(
          (b) =>
            b.page === context.page &&
            tags.some(
              (t) =>
                t.id === b.tagId &&
                t.parentId === suggestion.parentId &&
                t.name === suggestion.name,
            ),
        );
      const issue =
        !asset || !version
          ? "来源版本已不可用"
          : context.page !== undefined &&
              (!Number.isInteger(context.page) ||
                context.page < 1 ||
                context.page > version.pages)
            ? "来源页码已不可用"
            : "";
      return {
        ...context,
        versionNumber: context.version,
        asset,
        version,
        accepted,
        issue,
      };
    });
}
export function pendingSuggestions(
  state: State,
  asset: Asset,
  version = asset.current,
  page?: number,
) {
  const v = asset.versions.find((v) => v.number === version);
  if (!v) return [];
  return state.suggestions.filter(
    (s) =>
      s.status !== "已忽略" &&
      suggestionContexts(s, state.assets).some(
        (c) =>
          c.assetId === asset.id && c.version === version && c.page === page,
      ) &&
      !s.accepted?.some(
        (c) =>
          c.assetId === asset.id && c.version === version && c.page === page,
      ) &&
      !v.tags.some(
        (b) =>
          b.page === page &&
          state.tags.some(
            (t) =>
              t.id === b.tagId &&
              t.name === s.name &&
              t.parentId === s.parentId,
          ),
      ),
  );
}
export function pendingRecommendationsForVersion(
  state: State,
  asset: Asset,
  number = asset.current,
) {
  return state.suggestions.filter((s) =>
    suggestionContexts(s, state.assets).some(
      (c) =>
        c.assetId === asset.id &&
        c.version === number &&
        pendingSuggestions(state, asset, number, c.page).some(
          (pending) => pending.id === s.id,
        ),
    ),
  );
}
function editableVersion(state: State, assetId: string, number: number) {
  const user = state.users.find((u) => u.id === state.userId);
  const role = state.roles.find((r) => r.id === user?.roleId);
  const asset = visibleFor(state, user, role).find((a) => a.id === assetId);
  const version = asset?.versions.find((v) => v.number === number);
  if (
    !asset ||
    !version ||
    asset.current !== number ||
    asset.lifecycle !== "正常"
  )
    throw new Error("仅可编辑有权限查看的当前正常版本");
  if (!role || !canRole(role, "tags")) throw new Error("没有内容标签编辑权限");
  return { asset, version, role };
}
export function bindTag(
  state: State,
  assetId: string,
  versionNumber: number,
  tagId: string,
  page?: number,
) {
  const { asset, version } = editableVersion(state, assetId, versionNumber);
  const tag = state.tags.find((t) => t.id === tagId);
  if (!tag?.parentId || !availableTag(state.tags, tag))
    throw new Error("请选择已启用的二级标签");
  if (!version.tags.some((b) => b.tagId === tagId && b.page === page)) {
    version.tags.push({ tagId, origin: "人工", page });
    asset.updatedAt = now();
  }
}
export function acceptSuggestedTag(
  state: State,
  suggestionId: string,
  assetId: string,
  number: number,
  parentId: string,
  page?: number,
) {
  const { role, version, asset } = editableVersion(state, assetId, number);
  const suggestion = state.suggestions.find((s) => s.id === suggestionId);
  if (
    !suggestion ||
    suggestion.status === "已忽略" ||
    !suggestionContexts(suggestion, state.assets).some(
      (c) => c.assetId === assetId && c.version === number && c.page === page,
    )
  )
    throw new Error("推荐不属于当前内容版本");
  if (
    page !== undefined &&
    (!Number.isInteger(page) || page < 1 || page > version.pages)
  )
    throw new Error("推荐来源页码不可用");
  const parent = state.tags.find(
    (t) => t.id === parentId && t.parentId === null && t.enabled,
  );
  if (!parent) throw new Error("请选择已启用的一级标签");
  let tag = state.tags.find(
    (t) =>
      t.parentId === parentId &&
      t.name.trim().toLocaleLowerCase() ===
        suggestion.name.trim().toLocaleLowerCase(),
  );
  if (!tag && !canRole(role, "taxonomy"))
    throw new Error("新增推荐标签需要标签管理权限");
  if (tag && !availableTag(state.tags, tag))
    throw new Error("同名标签已停用，请先在标签管理中启用");
  if (!tag) {
    tag = {
      id: uid("tag"),
      name: suggestion.name.trim(),
      parentId,
      enabled: true,
      external: false,
    };
    state.tags.push(tag);
  }
  bindTag(state, assetId, number, tag.id, page);
  suggestion.accepted ||= [];
  if (
    !suggestion.accepted.some(
      (c) => c.assetId === assetId && c.version === number && c.page === page,
    )
  )
    suggestion.accepted.push({ assetId, version: number, page });
  if (
    suggestionContexts(suggestion, state.assets).every((c) =>
      suggestion.accepted!.some(
        (a) =>
          a.assetId === c.assetId &&
          a.version === c.version &&
          a.page === c.page,
      ),
    )
  )
    suggestion.status = "已采纳";
  if (
    version.tagStatus === "未匹配" &&
    !state.suggestions.some(
      (s) =>
        s.status !== "已忽略" &&
        suggestionContexts(s, state.assets).some(
          (c) =>
            c.assetId === assetId &&
            c.version === number &&
            pendingSuggestions(state, asset, number, c.page).some(
              (pending) => pending.id === s.id,
            ),
        ),
    )
  ) {
    version.tagStatus = "已完成";
    version.unmatched = undefined;
  }
  return tag.id;
}
