import { canRole, current, primaryTagId, type State } from "./model";
import { pendingSuggestions, suggestionContexts } from "./taxonomy";

export function ignoreRecommendation(state: State, id: string) {
  const user = state.users.find((u) => u.id === state.userId);
  const role = state.roles.find((r) => r.id === user?.roleId);
  if (!canRole(role, "taxonomy"))
    throw new Error("忽略推荐需要维护标签库权限。");
  const suggestion = state.suggestions.find((s) => s.id === id);
  if (!suggestion) throw new Error("推荐已不存在。");
  suggestion.status = "已忽略";
  const affectedIds = new Set(
    suggestionContexts(suggestion, state.assets).map((c) => c.assetId),
  );
  for (const asset of state.assets.filter((a) => affectedIds.has(a.id))) {
    const v = current(asset);
    if (
      v.tagStatus === "未匹配" &&
      !state.suggestions.some((s) =>
        suggestionContexts(s, state.assets).some(
          (c) =>
            c.assetId === asset.id &&
            c.version === v.number &&
            pendingSuggestions(state, asset, v.number, c.page).some(
              (pending) => pending.id === s.id,
            ),
        ),
      )
    ) {
      v.tagStatus = "已完成";
      v.unmatched = undefined;
    }
  }
}

export function prepareRecommendations(state: State) {
  if (state.recommendationRevision === 1) return state;
  const s = structuredClone(state);
  // Pin legacy sources once; future uploads must never move old recommendations.
  for (const suggestion of s.suggestions)
    suggestion.contexts ||= suggestionContexts(suggestion, s.assets);
  const demo = s.assets.find((a) => a.id === "demo-page-linkage");
  if (
    demo &&
    !s.suggestions.some((r) => r.id === "recommendation-page-example")
  ) {
    s.suggestions.unshift({
      id: "recommendation-page-example",
      name: "免疫治疗长期随访",
      parentId: primaryTagId("内容主题"),
      mentions: 3,
      assetIds: [demo.id],
      contexts: [
        { assetId: demo.id, version: demo.current },
        { assetId: demo.id, version: demo.current, page: 2 },
        { assetId: demo.id, version: demo.current, page: 3 },
      ],
      accepted: [],
      status: "待处理",
    });
    current(demo).tagStatus = "未匹配";
    current(demo).unmatched = "有材料与页级推荐标签待确认。";
  }
  s.recommendationRevision = 1;
  return s;
}
