import {
  VISIBILITY_FIELD,
  type Binding,
  type Rule,
  type Tag,
  type TagExclusion,
  type Version,
  type State,
} from "./model";

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
// 快照比对覆盖维度属性：基数 / AI 范围 / 合并策略变了也要提示重新同步。
export function tagDefinitions(tags: Tag[]) {
  return JSON.stringify(
    tags
      .map((t) => ({
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        enabled: t.enabled,
        aliases: [...(t.aliases || [])].sort(),
        derivedOnly: t.derivedOnly,
        kind: t.kind,
        cardinality: t.cardinality,
        scope: t.scope,
        ai: t.ai,
        merge: t.merge,
        fallbackId: t.fallbackId,
        humanEditable: t.humanEditable,
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
interface ExclusionTarget {
  valueId?: string;
  name?: string;
  parentId?: string;
}
export const exclusionMatches = (
  e: TagExclusion,
  target: ExclusionTarget,
  page?: number,
) => {
  const same = e.valueId
    ? e.valueId === target.valueId
    : !!e.name &&
      e.name === target.name &&
      (e.parentId || "") === (target.parentId || "");
  return same && e.page === page;
};
export function excludeTag(
  version: Version,
  target: ExclusionTarget,
  page?: number,
) {
  if (!version.tagExclusions?.some((e) => exclusionMatches(e, target, page)))
    (version.tagExclusions ||= []).push({ ...target, page });
}
export function allowTag(version: Version, tag: Tag, page?: number) {
  if (!tag.parentId) return;
  version.tagExclusions = version.tagExclusions?.filter(
    (e) => !exclusionMatches(e, { valueId: tag.id }, page),
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
    // 人工移除的取值记入排除记忆（含规则派生值），避免被规则重新补回。
    const tag = tags.find((t) => t.id === removed.tagId);
    if (tag)
      excludeTag(
        version,
        {
          valueId: tag.id,
          name: removed.name || tag.name,
          parentId: tag.parentId || undefined,
        },
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
// 打标命中词：标签名 ∪ 别名（如产品通用名），统一 NFKC 归一小写。
export const matchTerms = (tag: Tag) =>
  [tag.name, ...(tag.aliases || [])]
    .map((term) => normalizeName(term))
    .filter(Boolean);
export function tagHitsText(tag: Tag, normalizedText: string) {
  return matchTerms(tag).some((term) => normalizedText.includes(term));
}
export const dimensionOf = (b: Binding, tags: Tag[]) =>
  b.parentId || tags.find((t) => t.id === b.tagId)?.parentId;
// 单值维度：同一位置只保留一个取值。人工 > 规则 > AI；
// 同来源按取值排序 order 升序，order 相同按名称，保证结果确定且可解释。
const originRank = (origin: Binding["origin"]) =>
  origin === "人工" ? 1000 : origin === "规则" ? 500 : 0;
export function enforceSingleValue(bindings: Binding[], tags: Tag[]) {
  const single = new Set(
    tags
      .filter((t) => !t.parentId && t.cardinality === "single")
      .map((t) => t.id),
  );
  if (!single.size) return bindings;
  const orderOf = (b: Binding) => tags.find((t) => t.id === b.tagId);
  const better = (a: Binding, b: Binding) => {
    const rank = originRank(a.origin) - originRank(b.origin);
    if (rank !== 0) return rank > 0;
    const left = orderOf(a),
      right = orderOf(b);
    const leftOrder = left?.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right?.order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder < rightOrder;
    return (left?.name || "").localeCompare(right?.name || "", "zh") < 0;
  };
  const kept: Binding[] = [];
  for (const b of bindings) {
    const dim = dimensionOf(b, tags);
    if (!dim || !single.has(dim)) {
      kept.push(b);
      continue;
    }
    const index = kept.findIndex(
      (x) => x.page === b.page && dimensionOf(x, tags) === dim,
    );
    if (index < 0) {
      kept.push(b);
      continue;
    }
    if (better(b, kept[index])) kept[index] = b;
  }
  return kept;
}
function triggerSet(
  version: Pick<Version, "tags" | "fields" | "fieldsManual">,
) {
  const ids = new Set(
    version.tags.filter((b) => b.origin !== "规则").map((b) => b.tagId),
  );
  for (const [dim, list] of Object.entries(version.fields || {}))
    if ((version.fieldsManual || []).includes(dim))
      for (const id of list) ids.add(id);
  return ids;
}
function triggerHits(rule: Rule, ids: Set<string>) {
  return rule.trigger.match === "all"
    ? rule.trigger.valueIds.every((id) => ids.has(id))
    : rule.trigger.valueIds.some((id) => ids.has(id));
}
export function ruleMatches(
  rule: Rule,
  version: Pick<Version, "tags" | "fields" | "fieldsManual">,
) {
  return triggerHits(rule, triggerSet(version));
}
/** 某个目标维度的规则结果：并集维度取全部命中规则的并集，优先级维度取最高优先级的一条。 */
export function resolveRule(
  version: Pick<Version, "tags" | "fields" | "fieldsManual">,
  dimensionId: string,
  tags: Tag[],
  rules: Rule[],
) {
  const matching = rules
    .filter(
      (r) =>
        r.enabled &&
        r.action.dimensionId === dimensionId &&
        r.trigger.valueIds.length > 0 &&
        ruleMatches(r, version),
    )
    .sort((a, b) => a.priority - b.priority);
  if (!matching.length) return { valueIds: [] as string[], ruleId: undefined };
  const dimension = tags.find((t) => t.id === dimensionId);
  if (dimension?.merge === "priority")
    return {
      valueIds: [...matching[0].action.valueIds],
      ruleId: matching[0].id,
    };
  return {
    valueIds: [...new Set(matching.flatMap((r) => r.action.valueIds))],
    ruleId: matching[0].id,
  };
}
/**
 * 重算规则产物，幂等：
 * 1) 清空上一轮规则绑定与规则字段值；
 * 2) 按维度求值，人工改过的维度不覆盖；
 * 3) 枚举字段落 fields，分类维度落 tags（origin=规则，带 ruleId）；
 * 4) 无规则命中的枚举字段落兜底档；最后收敛单值维度。
 */
export function applyRules(version: Version, tags: Tag[], rules: Rule[]) {
  version.tags = version.tags.filter((b) => b.origin !== "规则");
  const manual = new Set(version.fieldsManual || []);
  const next: Record<string, string[]> = {};
  for (const [dim, list] of Object.entries(version.fields || {}))
    if (manual.has(dim)) next[dim] = [...list];
  for (const dimension of tags.filter((t) => !t.parentId && t.enabled)) {
    const result = resolveRule(version, dimension.id, tags, rules);
    const humanValue =
      manual.has(dimension.id) ||
      version.tags.some(
        (b) =>
          !b.page &&
          b.origin === "人工" &&
          dimensionOf(b, tags) === dimension.id,
      );
    if (!result.valueIds.length) {
      if (
        dimension.kind === "enum" &&
        !humanValue &&
        dimension.fallbackId &&
        tags.some((t) => t.id === dimension.fallbackId && t.enabled)
      )
        next[dimension.id] = [dimension.fallbackId];
      continue;
    }
    if (humanValue && dimension.humanEditable) continue;
    if (dimension.kind === "enum") {
      const values = result.valueIds
        .map((id) => tags.find((t) => t.id === id && t.enabled))
        .filter((t): t is Tag => !!t);
      if (values.length) {
        const sorted =
          dimension.cardinality === "single"
            ? [...values].sort(
                (a, b) =>
                  (a.order ?? Number.MAX_SAFE_INTEGER) -
                    (b.order ?? Number.MAX_SAFE_INTEGER) ||
                  a.name.localeCompare(b.name, "zh"),
              )
            : values;
        next[dimension.id] = [...new Set(sorted.map((t) => t.id))].slice(
          0,
          dimension.cardinality === "single" ? 1 : sorted.length,
        );
      } else if (
        !humanValue &&
        dimension.fallbackId &&
        tags.some((t) => t.id === dimension.fallbackId && t.enabled)
      ) {
        next[dimension.id] = [dimension.fallbackId];
      }
      continue;
    }
    for (const id of result.valueIds) {
      const value = tags.find((t) => t.id === id);
      if (!value?.enabled) continue;
      if (
        version.tagExclusions?.some((e) =>
          exclusionMatches(
            e,
            { valueId: value.id, name: value.name, parentId: value.parentId! },
            undefined,
          ),
        )
      )
        continue;
      if (version.tags.some((b) => b.tagId === id && !b.page)) continue;
      version.tags.push(
        stampBinding(
          { tagId: id, origin: "规则", ruleId: result.ruleId },
          tags,
        ),
      );
    }
  }
  version.fields = Object.keys(next).length ? next : undefined;
  version.tags = enforceSingleValue(version.tags, tags);
}
/** 用户可见范围：按字段取值的配置顺序返回名称，供列表 / 详情 / 导出统一读取。 */
export function audiencesOf(
  version: Pick<Version, "fields">,
  tags: Tag[],
): string[] {
  const ids = version.fields?.[VISIBILITY_FIELD] || [];
  return tags
    .filter((t) => t.parentId === VISIBILITY_FIELD)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .filter((t) => ids.includes(t.id))
    .map((t) => t.name);
}
export function fieldValuesOf(
  version: Pick<Version, "fields">,
  tags: Tag[],
  dimensionId: string,
) {
  return (version.fields?.[dimensionId] || [])
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => !!t);
}
