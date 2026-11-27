import { current, now, type Rule, type State, type Tag, type Version } from "./model";
import { applyRules, ruleMatches } from "./tagResults";

/** 规则命中的内容（按当前版本判断），用于"影响 N 份"提示。 */
export function ruleImpact(state: State, rule: Rule) {
  return state.assets
    .filter((asset) => ruleMatches(rule, current(asset)))
    .map((asset) => asset.id);
}
const ruleSignature = (version: Version) =>
  JSON.stringify({
    tags: version.tags
      .filter((binding) => binding.origin === "规则")
      .map((binding) => [binding.tagId, binding.ruleId, binding.page])
      .sort(),
    fields: Object.entries(version.fields || {})
      .map(([dimension, values]) => [dimension, [...values].sort()])
      .sort(),
  });
/** 同一目标维度下优先级必须唯一：返回冲突的另一条规则。 */
export function priorityConflict(rules: Rule[], draft: Rule) {
  return rules.find(
    (rule) =>
      rule.id !== draft.id &&
      rule.action.dimensionId === draft.action.dimensionId &&
      rule.priority === draft.priority,
  );
}
/** 规则保存前校验：防自派生、禁仅规则产生取值作触发、单值目标单结果、同目标优先级唯一。 */
export function validateRuleDraft(
  tags: Tag[],
  rules: Rule[],
  draft: Rule,
): string {
  if (!draft.name.trim()) return "请输入规则名称";
  const triggerDim = tags.find(
    (t) => t.id === draft.trigger.dimensionId && t.parentId === null,
  );
  const actionDim = tags.find(
    (t) => t.id === draft.action.dimensionId && t.parentId === null,
  );
  if (!triggerDim) return "请选择触发维度";
  if (!actionDim) return "请选择目标维度";
  if (triggerDim.id === actionDim.id) return "触发维度与目标维度不能相同";
  if (!draft.trigger.valueIds.length) return "请至少选择一个触发取值";
  if (!draft.action.valueIds.length) return "请至少选择一个结果取值";
  if (
    draft.trigger.valueIds.some(
      (id) => tags.find((t) => t.id === id)?.derivedOnly,
    )
  )
    return "仅规则产生的取值不能作为规则触发条件";
  if (actionDim.cardinality === "single" && draft.action.valueIds.length > 1)
    return "单值目标维度每条规则仅能选择一个结果取值";
  if (!Number.isInteger(draft.priority)) return "请填写有效整数优先级";
  const clash = priorityConflict(rules, draft);
  if (clash)
    return `同一目标维度的优先级不能重复：${draft.priority}（${clash.name}）`;
  return "";
}
/** 按当前规则重算规则产物；人工改过的字段与绑定不会被覆盖。 */
export function recalcRules(state: State, assetIds?: string[]) {
  const scope = assetIds ? new Set(assetIds) : undefined;
  let changed = 0;
  for (const asset of state.assets) {
    if (scope && !scope.has(asset.id)) continue;
    const version = current(asset);
    const before = ruleSignature(version);
    applyRules(version, state.tags, state.rules);
    if (ruleSignature(version) !== before) {
      asset.updatedAt = now();
      changed++;
    }
  }
  return changed;
}
