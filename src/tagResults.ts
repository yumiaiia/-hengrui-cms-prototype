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
