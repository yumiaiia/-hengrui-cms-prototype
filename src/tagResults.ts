import type { Binding, Tag, TagExclusion, Version, State } from "./model";

export const normalizeName = (name: string) =>
  name.normalize("NFKC").trim().toLocaleLowerCase();
export const samePosition = (
  a: { tagId: string; page?: number },
  b: { tagId: string; page?: number },
) => a.tagId === b.tagId && a.page === b.page;
export const bindingName = (binding: Binding, tags: Tag[]) =>
  binding.name ||
  tags.find((t) => t.id === binding.tagId)?.name ||
  "标签已失效";
export function stampBinding(binding: Binding, tags: Tag[]): Binding {
  const tag = tags.find((t) => t.id === binding.tagId);
  return tag?.parentId
    ? { ...binding, name: tag.name, parentId: tag.parentId }
    : binding;
}
export function captureBindingNames(state: State) {
  for (const asset of state.assets)
    for (const v of asset.versions)
      v.tags = v.tags.map((b) => (b.name ? b : stampBinding(b, state.tags)));
}
export function tagDefinitions(tags: Tag[]) {
  return JSON.stringify(
    tags
      .map(({ id, name, parentId, enabled }) => ({
        id,
        name,
        parentId,
        enabled,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
export function boundDefinitions(version: Version, tags: Tag[]) {
  const ids = new Set(version.tags.map((b) => b.tagId));
  for (const tag of tags)
    if (ids.has(tag.id) && tag.parentId) ids.add(tag.parentId);
  return tagDefinitions(tags.filter((t) => ids.has(t.id)));
}
export const exclusionMatches = (
  e: TagExclusion,
  draft: { name: string; parentId: string },
  page?: number,
) =>
  normalizeName(e.name) === normalizeName(draft.name) &&
  e.parentId === draft.parentId &&
  e.page === page;
export function excludeTag(
  version: Version,
  draft: { name: string; parentId: string },
  page?: number,
) {
  const entry = { name: draft.name, parentId: draft.parentId, page };
  if (!version.tagExclusions?.some((e) => exclusionMatches(e, draft, page)))
    (version.tagExclusions ||= []).push(entry);
}
export function allowTag(version: Version, tag: Tag, page?: number) {
  if (!tag.parentId) return;
  version.tagExclusions = version.tagExclusions?.filter(
    (e) =>
      !exclusionMatches(e, { name: tag.name, parentId: tag.parentId! }, page),
  );
}
export function maintainBindings(
  version: Version,
  next: Binding[],
  tags: Tag[],
) {
  for (const removed of version.tags.filter(
    (old) => !next.some((b) => samePosition(b, old)),
  )) {
    const tag = tags.find((t) => t.id === removed.tagId);
    const parentId = removed.parentId || tag?.parentId;
    if (parentId && (removed.name || tag?.name))
      excludeTag(
        version,
        { name: removed.name || tag!.name, parentId },
        removed.page,
      );
  }
  version.tags = next.map((b) => {
    if (version.tags.some((old) => samePosition(old, b))) return b;
    const tag = tags.find((t) => t.id === b.tagId);
    if (tag) allowTag(version, tag, b.page);
    return stampBinding(b, tags);
  });
}
// 材料级自动派生：整份内容（材料级 ∪ 全部页级）命中触发集合时，在材料级补充派生目标标签。
// 派生目标仅由派生规则或人工产生，AI 直出在落库前被拦截；人工移除后记入排除记忆不再补回。
export const DERIVATION_RULES: {
  triggers: string[];
  derived: string[];
}[] = [
  {
    triggers: ["指南共识", "临床研究", "综述与前沿", "疾病知识与患教"],
    derived: ["All三类用户"],
  },
  {
    triggers: ["治疗方案", "病例分享", "产品准入", "用药安全"],
    derived: ["已注册待认证", "已认证"],
  },
];
const derivedTargetNames = new Set(
  DERIVATION_RULES.flatMap((rule) => rule.derived).map(normalizeName),
);
export function applyDerivedTags(
  bindings: Binding[],
  tagExclusions: TagExclusion[] | undefined,
  tags: Tag[],
) {
  const nameOf = (id: string) =>
    tags.find((t) => t.id === id)?.name || "";
  const present = new Set(bindings.map((b) => normalizeName(nameOf(b.tagId))));
  const result = [...bindings];
  for (const rule of DERIVATION_RULES) {
    if (!rule.triggers.some((t) => present.has(normalizeName(t)))) continue;
    for (const name of rule.derived) {
      const target = tags.find(
        (t) =>
          t.parentId &&
          normalizeName(t.name) === normalizeName(name) &&
          t.enabled,
      );
      if (!target) continue;
      if (
        tagExclusions?.some((e) =>
          exclusionMatches(e, {
            name: target.name,
            parentId: target.parentId!,
          }),
        )
      )
        continue;
      if (!result.some((b) => b.tagId === target.id && !b.page))
        result.push(stampBinding({ tagId: target.id, origin: "人工" }, tags));
    }
  }
  return result;
}
