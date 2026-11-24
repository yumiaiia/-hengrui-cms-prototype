import type { Tag } from "./model";
export const normalizeTagName = (name: string) =>
  name.normalize("NFKC").trim().toLocaleLowerCase();
export type TagDraft = Pick<Tag, "name" | "parentId"> & { id?: string };
export function nameSimilarity(a: string, b: string) {
  const left = Array.from(normalizeTagName(a)),
    right = Array.from(normalizeTagName(b));
  if (!left.length || !right.length) return 0;
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return 1 - row[right.length] / Math.max(left.length, right.length);
}
export function similarTags(tags: Tag[], draft: TagDraft) {
  return tags
    .filter(
      (t) =>
        t.id !== draft.id &&
        (draft.parentId === null ? t.parentId === null : t.parentId !== null),
    )
    .map((tag) => ({ tag, score: nameSimilarity(tag.name, draft.name) }))
    .filter((x) => x.score >= 0.7)
    .sort(
      (a, b) =>
        Number(b.tag.parentId === draft.parentId) -
          Number(a.tag.parentId === draft.parentId) ||
        b.score - a.score ||
        a.tag.id.localeCompare(b.tag.id),
    )
    .slice(0, 5);
}
export function tagCheckReceipt(tags: Tag[], draft: TagDraft) {
  return JSON.stringify([
    normalizeTagName(draft.name),
    draft.parentId,
    draft.id && tags.some((t) => t.id === draft.id) ? draft.id : null,
    tags.map((t) => [t.id, t.name, t.parentId, t.enabled]),
  ]);
}
export function requireTagCheck(
  tags: Tag[],
  draft: TagDraft,
  receipt?: string,
) {
  if (
    similarTags(tags, draft).length &&
    receipt !== tagCheckReceipt(tags, draft)
  )
    throw new Error(
      "存在相似标签或标签库已变化，请重新检查后确认是否仍然入库。",
    );
}
