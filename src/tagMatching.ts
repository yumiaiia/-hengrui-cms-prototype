import {
  canRole,
  current,
  now,
  uid,
  type State,
  type Tag,
  type Task,
  type Version,
  type Binding,
  visibleFor,
} from "./model";
import {
  availableTag,
  pendingRecommendationsForVersion,
  pendingSuggestions,
  suggestionContexts,
} from "./taxonomy";
import { paginated } from "./workflow";
import { exclusionMatches, stampBinding, tagDefinitions } from "./tagResults";

export function tagUsage(state: State, ids: string[]) {
  const all = new Set(
    ids.flatMap((id) => [
      id,
      ...state.tags.filter((t) => t.parentId === id).map((t) => t.id),
    ]),
  );
  return state.assets.filter((a) =>
    a.versions.some((v) => v.tags.some((b) => all.has(b.tagId))),
  ).length;
}
export function tagImpact(previous: Tag, next: Tag) {
  return [
    previous.name !== next.name &&
      "下次匹配结果使用新名称，确认更新后保存到内容",
    previous.parentId !== next.parentId &&
      "下次标签结果按新分类展示，已有绑定保留",
    previous.enabled !== next.enabled &&
      (next.enabled ? "可用于新增匹配" : "停止新增绑定，已有绑定保留"),
    previous.external !== next.external &&
      (next.external ? "允许对外展示" : "停止对外展示"),
  ].filter(Boolean) as string[];
}
export const matchableAssets = (s: State) => {
  const actor = s.users.find((u) => u.id === s.userId && u.enabled !== false);
  const role = s.roles.find((r) => r.id === actor?.roleId);
  return visibleFor(s, actor, role).filter(
    (a) =>
      a.lifecycle === "正常" &&
      current(a).process === "完成" &&
      !Object.values(current(a).pageStates || {}).some(
        (p) => p.status !== "完成" && p.status !== "人工完成",
      ),
  );
};
function assertMatching(s: State) {
  const actor = s.users.find((u) => u.id === s.userId && u.enabled !== false);
  const role = s.roles.find((r) => r.id === actor?.roleId);
  if (!actor || !canRole(role, "taxonomy") || !canRole(role, "tags"))
    throw new Error("重新匹配需要标签管理与内容标签维护权限");
  return actor;
}
export function matchingResult(v: Version, tags: Tag[]) {
  if (
    v.process !== "完成" ||
    Object.values(v.pageStates || {}).some(
      (p) => !["完成", "人工完成"].includes(p.status),
    )
  )
    throw new Error("请先完成文件解析，再匹配标签。");
  const eligible = tags.filter((t) => t.parentId && availableTag(tags, t));
  // Existing bindings survive; matching only fills unbound positions.
  const result: Binding[] = v.tags.map((b) => {
    const tag = tags.find((t) => t.id === b.tagId);
    return tag ? stampBinding(b, tags) : structuredClone(b);
  });
  const hasBinding = (tag: Tag, page?: number) =>
    result.some((b) => b.tagId === tag.id && b.page === page);
  const add = (tag: Tag, page?: number) => {
    if (
      v.tagExclusions?.some((e) =>
        exclusionMatches(e, { name: tag.name, parentId: tag.parentId! }, page),
      )
    )
      return;
    if (!hasBinding(tag, page))
      result.push(stampBinding({ tagId: tag.id, origin: "AI", page }, tags));
  };
  const text = (value: string) =>
    value.normalize("NFKC").trim().toLocaleLowerCase();
  for (const tag of eligible) {
    const name = text(tag.name);
    if (!name) continue;
    if (
      !hasBinding(tag) &&
      text([v.title, v.summary, ...v.content].join(" ")).includes(name)
    )
      add(tag);
    if (paginated(v))
      v.content.slice(0, v.pages).forEach((body, i) => {
        if (!hasBinding(tag, i + 1) && text(body).includes(name))
          add(tag, i + 1);
      });
  }
  return result;
}
function matchingRecommendations(s: State, asset: State["assets"][number]) {
  return pendingRecommendationsForVersion(s, asset).flatMap((r) =>
    suggestionContexts(r, s.assets)
      .filter(
        (c) =>
          c.assetId === asset.id &&
          c.version === asset.current &&
          pendingSuggestions(s, asset, asset.current, c.page).some(
            (x) => x.id === r.id,
          ),
      )
      .map((c) => ({
        id: uid("rec"),
        suggestionId: r.id,
        name: r.name,
        parentId: r.parentId,
        page: c.page,
      })),
  );
}
export function startTagMatching(s: State, ids?: string[]) {
  const actor = assertMatching(s);
  if (
    (s.uploadBatches || []).some(
      (b) =>
        b.kind === "tags" && b.items.some((i) => !i.archived && !i.cancelled),
    )
  )
    throw new Error("已有标签匹配正在进行或等待确认，请先处理或取消已有批次。");
  const assets = matchableAssets(s).filter((a) => !ids || ids.includes(a.id));
  if (ids && new Set(ids).size !== assets.length)
    throw new Error("所选文件状态已变化，请重新选择后同步。");
  if (!assets.length) throw new Error("没有可处理的文件");
  const batchId = uid("batch-tags");
  const snapshot = structuredClone(s.tags);
  (s.uploadBatches ||= []).unshift({
    id: batchId,
    kind: "tags",
    ownerId: actor.id,
    createdAt: now(),
    tagSnapshot: snapshot,
    items: assets.map((a) => {
      const v = structuredClone(current(a));
      for (const r of s.suggestions) {
        for (const c of suggestionContexts(r, s.assets)) {
          if (c.assetId !== a.id || c.version !== a.current) continue;
          if (
            r.status === "已忽略" ||
            r.cancelled?.some(
              (x) =>
                x.assetId === c.assetId &&
                x.version === c.version &&
                x.page === c.page,
            )
          ) {
            const entry = { name: r.name, parentId: r.parentId, page: c.page };
            if (
              !v.tagExclusions?.some((e) => exclusionMatches(e, entry, c.page))
            )
              (v.tagExclusions ||= []).push(entry);
          }
        }
      }
      return {
        id: uid("match-item"),
        targetId: a.id,
        baseVersion: a.current,
        baseline: JSON.stringify(current(a)),
        revision: 1,
        v: {
          ...v,
          tags: v.tags.map((b) => stampBinding(b, s.tags)),
          process: "处理中",
          tagStatus: "打标中",
        },
        recommendations: matchingRecommendations(s, a),
      };
    }),
  });
  const task: Task = {
    id: uid("match"),
    name: "同步最新标签到文件",
    type: "标签匹配",
    batchId,
    status: "处理中",
    actorId: actor.id,
    tagIds: snapshot
      .filter((t) => t.parentId && availableTag(snapshot, t))
      .map((t) => t.id),
    items: assets.map((a) => ({
      assetId: a.id,
      version: a.current,
      label: current(a).title,
      status: "排队中",
    })),
    createdAt: now(),
    attempts: 1,
    finishAt: Date.now() + 1200,
  };
  s.tasks.unshift(task);
  return task.id;
}
export function advanceTagMatching(s: State, task: Task) {
  const batch = s.uploadBatches?.find((b) => b.id === task.batchId);
  if (!batch) {
    // Legacy jobs cannot resume by overwriting the formal tags after the upgrade.
    task.finishAt = undefined;
    task.status = "完成";
    return;
  }
  const entry = task.items.find(
    (i) => i.status === "排队中" || i.status === "处理中",
  );
  if (entry) {
    const item = batch.items.find((i) => i.targetId === entry.assetId);
    if (!item || item.cancelled || item.archived) entry.status = "完成";
    else
      try {
        const a = s.assets.find((a) => a.id === item.targetId);
        if (
          !a ||
          a.lifecycle !== "正常" ||
          a.current !== item.baseVersion ||
          JSON.stringify(current(a)) !== item.baseline
        )
          throw new Error("正式内容已变化，请重新同步本文件。");
        const tags = item.tagSnapshot || batch.tagSnapshot || [];
        if (tagDefinitions(tags) !== tagDefinitions(s.tags))
          throw new Error("标签库已更新，请重新同步本文件。");
        const source = structuredClone(current(a));
        source.tagExclusions = structuredClone(item.v.tagExclusions);
        const next = matchingResult(source, tags);
        item.v = { ...source, tags: next, tagStatus: "已完成" };
        // Existing known recommendations may be resolved by an actual new match.
        for (const r of item.recommendations || []) {
          if (
            next.some(
              (b) =>
                b.page === r.page &&
                tags.some(
                  (t) =>
                    t.id === b.tagId &&
                    t.parentId === r.parentId &&
                    t.name === r.name,
                ),
            )
          )
            r.resolved = true;
        }
        item.error = undefined;
        entry.error = undefined;
        entry.status = "完成";
      } catch (e) {
        item.v.process = "失败";
        item.error = e instanceof Error ? e.message : "匹配失败，请重试。";
        entry.status = "失败";
        entry.error = item.error;
      }
  }
  if (task.items.some((i) => ["排队中", "处理中"].includes(i.status)))
    task.finishAt = Date.now() + 900;
  else {
    task.finishAt = undefined;
    task.status = task.items.some((i) => i.status === "失败")
      ? "部分失败"
      : "完成";
    if (
      batch.items.some(
        (i) => !i.cancelled && !i.archived && i.v.process === "完成",
      )
    )
      s.notices.unshift({
        id: uid("notice"),
        at: now(),
        title: "标签匹配完成，待确认结果",
        detail: "查看每份文件的完整标签结果，确认后更新。",
        route: `upload/${batch.id}`,
        read: false,
        recipientId: batch.ownerId,
      });
  }
}
export function retryTagMatching(s: State, id: string, assetId?: string) {
  const actor = assertMatching(s);
  const task = s.tasks.find((t) => t.id === id && t.type === "标签匹配");
  const batch = s.uploadBatches?.find((b) => b.id === task?.batchId);
  if (!task || !batch)
    throw new Error("该历史任务请从“同步最新标签到文件”重新发起。");
  if (actor.roleId !== "admin" && batch.ownerId !== actor.id)
    throw new Error("没有处理该批次的权限。");
  if (!task.items.some((i) => i.status === "失败"))
    throw new Error("没有失败项");
  for (const entry of task.items.filter(
    (i) => i.status === "失败" && (!assetId || i.assetId === assetId),
  )) {
    const item = batch.items.find((i) => i.targetId === entry.assetId);
    if (!item || item.cancelled || item.archived) continue;
    const asset = s.assets.find((a) => a.id === item.targetId);
    if (!asset || asset.lifecycle !== "正常")
      throw new Error("内容已作废或不存在。");
    if (
      current(asset).process !== "完成" ||
      Object.values(current(asset).pageStates || {}).some(
        (p) => !["完成", "人工完成"].includes(p.status),
      )
    )
      throw new Error("请先完成该文件的解析，再重新匹配标签。");
    const sameVersion = item.baseVersion === asset.current;
    const previousRecommendations = item.recommendations;
    const exclusions =
      item.baseVersion === asset.current
        ? item.v.tagExclusions
        : current(asset).tagExclusions;
    item.baseline = JSON.stringify(current(asset));
    item.baseVersion = asset.current;
    item.tagSnapshot = structuredClone(s.tags);
    item.v = {
      ...structuredClone(current(asset)),
      tagExclusions: structuredClone(exclusions),
      process: "处理中",
      tagStatus: "打标中",
    };
    item.recommendations = matchingRecommendations(s, asset).map((r) => {
      const previous =
        sameVersion &&
        previousRecommendations?.find(
          (old) =>
            old.suggestionId === r.suggestionId &&
            old.page === r.page &&
            old.cancelled,
        );
      return previous ? { ...r, resolved: true, cancelled: true } : r;
    });
    item.revision++;
    item.confirmedRevision = undefined;
    item.confirmedTags = undefined;
    // Cancelled contexts also suppress a same-named tag added after cancellation.
    for (const r of s.suggestions)
      for (const c of suggestionContexts(r, s.assets)) {
        if (c.assetId !== asset.id || c.version !== asset.current) continue;
        if (
          r.status === "已忽略" ||
          r.cancelled?.some(
            (x) =>
              x.assetId === c.assetId &&
              x.version === c.version &&
              x.page === c.page,
          )
        ) {
          const exclusion = {
            name: r.name,
            parentId: r.parentId,
            page: c.page,
          };
          if (
            !item.v.tagExclusions?.some((e) =>
              exclusionMatches(e, exclusion, c.page),
            )
          )
            (item.v.tagExclusions ||= []).push(exclusion);
        }
      }
    item.error = undefined;
    item.archiveError = undefined;
    entry.version = asset.current;
    entry.status = "排队中";
  }
  task.status = "处理中";
  task.attempts++;
  task.finishAt = Date.now() + 900;
}
