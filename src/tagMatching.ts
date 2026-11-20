import {
  canRole,
  current,
  now,
  uid,
  type State,
  type Tag,
  type Task,
} from "./model";
import {
  availableTag,
  pendingRecommendationsForVersion,
  suggestionContexts,
} from "./taxonomy";
import { paginated } from "./workflow";

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
    previous.name !== next.name && "名称将在关联内容中同步显示",
    previous.parentId !== next.parentId && "关联内容将归入新的标签分类",
    previous.enabled !== next.enabled &&
      (next.enabled ? "可用于新增匹配" : "停止新增绑定，已有绑定保留"),
    previous.external !== next.external &&
      (next.external ? "允许对外展示" : "停止对外展示"),
  ].filter(Boolean) as string[];
}
export const matchableAssets = (s: State) =>
  s.assets.filter(
    (a) => a.lifecycle === "正常" && current(a).process === "完成",
  );
function assertMatching(s: State) {
  const actor = s.users.find((u) => u.id === s.userId && u.enabled !== false);
  const role = s.roles.find((r) => r.id === actor?.roleId);
  if (!actor || !canRole(role, "taxonomy") || !canRole(role, "tags"))
    throw new Error("重新匹配需要标签管理与内容标签维护权限");
  return actor;
}
export function startTagMatching(s: State) {
  const actor = assertMatching(s);
  if (
    s.tasks.some(
      (t) => t.type === "标签匹配" && ["排队中", "处理中"].includes(t.status),
    )
  )
    throw new Error("标签匹配正在进行");
  const assets = matchableAssets(s);
  if (!assets.length) throw new Error("没有可处理的文件");
  const task: Task = {
    id: uid("match"),
    name: "标签重新匹配",
    type: "标签匹配",
    status: "处理中",
    actorId: actor.id,
    tagIds: s.tags
      .filter((t) => t.parentId && availableTag(s.tags, t))
      .map((t) => t.id),
    items: assets.map((a) => ({
      assetId: a.id,
      version: a.current,
      label: current(a).title,
      status: "排队中",
    })),
    createdAt: now(),
    attempts: 1,
    finishAt: Date.now() + 350,
    result: { added: 0, affected: 0, skipped: s.assets.length - assets.length },
  };
  s.tasks.unshift(task);
  return task.id;
}
// One file per tick; the task and its partial results survive navigation/reload.
export function advanceTagMatching(s: State, task: Task) {
  const item = task.items.find(
    (i) => i.status === "排队中" || i.status === "处理中",
  );
  if (item) {
    try {
      const asset = s.assets.find((a) => a.id === item.assetId);
      if (
        !asset ||
        asset.current !== item.version ||
        asset.lifecycle !== "正常" ||
        current(asset).process !== "完成"
      ) {
        item.status = "完成";
        item.skipped = true;
        task.result ||= { added: 0, affected: 0, skipped: 0 };
        task.result.skipped++;
      } else {
        const v = current(asset),
          planned: { tagId: string; origin: "AI"; page?: number }[] = [];
        const text = (x: string) =>
          x.normalize("NFKC").trim().toLocaleLowerCase();
        const add = (tagId: string, page?: number) => {
          if (
            page !== undefined &&
            (!Number.isInteger(page) ||
              page < 1 ||
              page > v.pages ||
              ["失败", "待打标", "打标中"].includes(
                v.pageStates?.[page]?.status || "",
              ))
          )
            return;
          if (
            ![...v.tags, ...planned].some(
              (b) => b.tagId === tagId && b.page === page,
            )
          )
            planned.push({ tagId, page, origin: "AI" });
        };
        for (const tag of s.tags.filter(
          (t) =>
            task.tagIds?.includes(t.id) &&
            t.parentId &&
            availableTag(s.tags, t),
        )) {
          const name = text(tag.name);
          if (!name) continue;
          const bodies = v.content.filter(
            (_, i) =>
              !["失败", "待打标", "打标中"].includes(
                v.pageStates?.[i + 1]?.status || "",
              ),
          );
          if (text([v.title, v.summary, ...bodies].join(" ")).includes(name))
            add(tag.id);
          if (paginated(v))
            v.content.slice(0, v.pages).forEach((body, index) => {
              if (text(body).includes(name)) add(tag.id, index + 1);
            });
          for (const suggestion of s.suggestions.filter(
            (r) =>
              r.status !== "已忽略" &&
              r.parentId === tag.parentId &&
              text(r.name) === name,
          )) {
            for (const context of suggestionContexts(suggestion, s.assets))
              if (context.assetId === asset.id && context.version === v.number)
                add(tag.id, context.page);
          }
        }
        v.tags.push(...planned);
        for (const suggestion of s.suggestions.filter(
          (r) => r.status !== "已忽略",
        )) {
          for (const context of suggestionContexts(suggestion, s.assets)) {
            if (context.assetId !== asset.id || context.version !== v.number)
              continue;
            if (
              !v.tags.some(
                (b) =>
                  b.page === context.page &&
                  s.tags.some(
                    (t) =>
                      t.id === b.tagId &&
                      t.parentId === suggestion.parentId &&
                      text(t.name) === text(suggestion.name),
                  ),
              )
            )
              continue;
            suggestion.accepted ||= [];
            if (
              !suggestion.accepted.some(
                (c) =>
                  c.assetId === context.assetId &&
                  c.version === context.version &&
                  c.page === context.page,
              )
            )
              suggestion.accepted.push({ ...context });
          }
          if (
            suggestionContexts(suggestion, s.assets).every((c) =>
              suggestion.accepted?.some(
                (a) =>
                  a.assetId === c.assetId &&
                  a.version === c.version &&
                  a.page === c.page,
              ),
            )
          )
            suggestion.status = "已采纳";
        }
        if (
          v.tagStatus === "未匹配" &&
          !pendingRecommendationsForVersion(s, asset).length
        ) {
          v.tagStatus = "已完成";
          v.unmatched = undefined;
        }
        if (planned.length) asset.updatedAt = now();
        item.added = planned.length;
        item.status = "完成";
        item.error = undefined;
      }
    } catch (error) {
      item.status = "失败";
      item.error = error instanceof Error ? error.message : "匹配失败";
    }
  }
  task.result = {
    added: task.items.reduce((n, i) => n + (i.added || 0), 0),
    affected: task.items.filter((i) => (i.added || 0) > 0).length,
    skipped: task.result?.skipped || 0,
  };
  if (task.items.some((i) => ["排队中", "处理中"].includes(i.status)))
    task.finishAt = Date.now() + 350;
  else {
    task.finishAt = undefined;
    task.status = task.items.some((i) => i.status === "失败")
      ? "部分失败"
      : "完成";
  }
}
export function retryTagMatching(s: State, id: string) {
  assertMatching(s);
  const task = s.tasks.find((t) => t.id === id && t.type === "标签匹配");
  if (!task || !task.items.some((i) => i.status === "失败"))
    throw new Error("没有失败项");
  if (
    s.tasks.some(
      (t) => t.id !== id && t.type === "标签匹配" && t.status === "处理中",
    )
  )
    throw new Error("标签匹配正在进行");
  for (const item of task.items)
    if (item.status === "失败") item.status = "排队中";
  task.status = "处理中";
  task.attempts++;
  task.finishAt = Date.now() + 350;
}
