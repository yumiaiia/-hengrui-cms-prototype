import { current, now, type Rule, type State, type Version } from "./model";
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
