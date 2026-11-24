import { canRole, current, primaryTagId, type State } from "./model";
import {
  pendingSuggestions,
  pendingRecommendationsForVersion,
  suggestionContexts,
  recommendationSources,
} from "./taxonomy";
import { excludeTag, exclusionMatches } from "./tagResults";

export function setRecommendationCancelled(
  state: State,
  id: string,
  cancelled: boolean,
  context?: { assetId: string; version: number; page?: number },
) {
  const user = state.users.find(
    (u) => u.id === state.userId && u.enabled !== false,
  );
  const role = state.roles.find((r) => r.id === user?.roleId);
  if (!user || !canRole(role, context ? "tags" : "taxonomy"))
    throw new Error("没有处理推荐的权限。");
  const suggestion = state.suggestions.find((s) => s.id === id);
  if (!suggestion) throw new Error("推荐已不存在。");
  const sources = recommendationSources(
    suggestion,
    state.assets,
    state.tags,
  ).filter(
    (c) =>
      !context ||
      (c.assetId === context.assetId &&
        c.versionNumber === context.version &&
        c.page === context.page),
  );
  if (context && !sources.length) throw new Error("推荐来源已变化。");
  // Convert legacy global ignores to explicit source decisions before restoring one.
  if (suggestion.status === "已忽略") {
    suggestion.cancelled = suggestionContexts(suggestion, state.assets).filter(
      (c) =>
        !suggestion.accepted?.some(
          (a) =>
            a.assetId === c.assetId &&
            a.version === c.version &&
            a.page === c.page,
        ),
    );
    suggestion.status = "待处理";
  }
  for (const source of sources) {
    if (
      source.accepted ||
      source.issue ||
      source.asset?.lifecycle !== "正常" ||
      source.asset.current !== source.versionNumber
    ) {
      if (context) throw new Error("仅能处理当前正常版本的待处理推荐。");
      continue;
    }
    const c = {
      assetId: source.assetId,
      version: source.versionNumber,
      page: source.page,
    };
    const same = (x: { assetId: string; version: number; page?: number }) =>
      x.assetId === c.assetId && x.version === c.version && x.page === c.page;
    suggestion.cancelled = (suggestion.cancelled || []).filter((x) => !same(x));
    if (cancelled) {
      suggestion.cancelled.push(c);
      excludeTag(source.version!, suggestion, source.page);
    } else {
      source.version!.tagExclusions = source.version!.tagExclusions?.filter(
        (e) => !exclusionMatches(e, suggestion, source.page),
      );
    }
    source.asset.updatedAt = new Date().toISOString();
    if (
      !pendingRecommendationsForVersion(
        state,
        source.asset,
        source.versionNumber,
      ).length &&
      source.version!.tagStatus === "未匹配"
    ) {
      source.version!.tagStatus = "已完成";
      source.version!.unmatched = undefined;
    } else if (!cancelled) {
      source.version!.tagStatus = "未匹配";
      source.version!.unmatched = "有推荐标签待处理。";
    }
  }
}

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
