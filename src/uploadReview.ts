import {
  canRole,
  credentialErrors,
  current,
  now,
  pushNotice,
  uid,
  type State,
  type UploadBatch,
  type StagedUploadItem,
  type Version,
  type Approval,
} from "./model";
import {
  aiEligibleTag,
  availableTag,
  pendingRecommendationsForVersion,
  suggestionContexts,
} from "./taxonomy";
import { normalizeTagName } from "./tagSimilarity";
import {
  applyRules,
  boundDefinitions,
  enforceSingleValue,
  excludeTag,
  exclusionMatches,
  maintainBindings,
  stampBinding,
  tagHitsText,
} from "./tagResults";
import { retryTagMatching } from "./tagMatching";
import { planUploadVersions, type UploadInput } from "./upload";
// 新版本静默继承上一版全部补充视频（保持顺序），再追加本次新传，上限 3 个。
function mergeVideos(previous?: Version["videos"], added?: Version["videos"]) {
  const merged = [
    ...(previous ? structuredClone(previous) : []),
    ...(added ? structuredClone(added) : []),
  ];
  const unique = merged
    .filter((v, index) => merged.findIndex((x) => x.fileKey === v.fileKey) === index)
    .slice(0, 3);
  return unique.length ? unique : undefined;
}
export function visibleBatches(s: State) {
  const actor = s.users.find((u) => u.id === s.userId);
  if (!actor || actor.enabled === false) return [];
  return (s.uploadBatches || []).filter(
    (b) => actor.roleId === "admin" || b.ownerId === actor.id,
  );
}
export function batchAccess(s: State, batchId: string) {
  const actor = s.users.find((u) => u.id === s.userId);
  const role = s.roles.find((r) => r.id === actor?.roleId);
  const batch = visibleBatches(s).find((b) => b.id === batchId);
  if (!batch) throw new Error("批次不存在或无权访问。");
  if (
    !actor ||
    actor.enabled === false ||
    (batch.kind === "tags"
      ? !canRole(role, "taxonomy") || !canRole(role, "tags")
      : !canRole(role, "upload"))
  )
    throw new Error("当前账号没有处理本批次的权限。");
  return { actor, role, batch };
}
export const activeItem = (i: StagedUploadItem) => !i.archived && !i.cancelled;
export function cancelStaged(s: State, batchId: string, ids: string[]) {
  const { batch, actor } = batchAccess(s, batchId);
  let count = 0;
  for (const item of batch.items.filter(
    (i) => ids.includes(i.id) && activeItem(i),
  )) {
    item.cancelled = { at: now(), by: actor.id };
    item.finishAt = undefined;
    invalidate(item);
    count++;
  }
  if (!batch.items.some(activeItem)) {
    for (const task of s.tasks.filter((t) => t.batchId === batchId)) {
      task.finishAt = undefined;
      task.status = "完成";
    }
    for (const notice of s.notices.filter(
      (n) => n.route === `upload/${batchId}`,
    ))
      notice.read = true;
  }
  return count;
}
export function startUploadBatch(
  s: State,
  inputs: UploadInput[],
  approval: Approval,
  explicitId?: string | null,
  expectedVersion?: number,
  expectedActorId?: string,
) {
  if (expectedActorId && s.userId !== expectedActorId)
    throw new Error("操作账号已变化，请重新打开上传页面。");
  const actor = s.users.find((u) => u.id === s.userId),
    role = s.roles.find((r) => r.id === actor?.roleId);
  if (!actor || actor.enabled === false || !canRole(role, "upload"))
    throw new Error("没有上传权限。");
  if (!inputs.length) throw new Error("请添加文件。");
  if (approval.mode === "pending") throw new Error("请补充审批信息。");
  if (approval.mode === "exempt" && !canRole(role, "exempt"))
    throw new Error("没有免登记权限。");
  if (
    approval.mode === "registered" &&
    (!approval.snapshot || credentialErrors(approval.snapshot).length)
  )
    throw new Error("请补全审批并确认 OCR 差异。");
  const seen = new Set<string>();
  for (const { v } of inputs) {
    const key = v.fileHash || v.sourceUrl;
    if (key && seen.has(key))
      throw new Error("本批次有重复文件或链接，请移除重复项。");
    if (key) seen.add(key);
    if (!v.title.trim() || (!v.fileKey && !v.fileUrl && !v.sourceUrl))
      throw new Error("文件或标题不完整。");
  }
  if (
    explicitId &&
    s.assets.find((a) => a.id === explicitId)?.current !== expectedVersion
  )
    throw new Error("当前版本已变化，请重新选择上传目标。");
  const targets = planUploadVersions(s.assets, inputs, explicitId);
  const batch: UploadBatch = {
    id: uid("batch"),
    ownerId: actor.id,
    createdAt: now(),
    items: inputs.map((input, index) => {
      const target = targets[index],
        asset = s.assets.find((a) => a.id === target.assetId),
        previous = asset ? current(asset) : undefined;
      return {
        id: input.id,
        revision: 1,
        recommendations: structuredClone(input.recommendations),
        finishAt: Date.now() + 12000 + index * 2000,
        targetId: target.newAsset ? undefined : target.assetId,
        baseVersion: target.newAsset ? undefined : asset?.current,
        v: {
          ...structuredClone(input.v),
          number: 0,
          uploadedAt: now(),
          approval: structuredClone(approval),
          cover: input.v.cover ?? previous?.cover,
          thumbnail: input.v.thumbnail ?? previous?.thumbnail,
          videos: mergeVideos(previous?.videos, input.v.videos),
          process: "处理中",
          tagStatus: "打标中",
        },
      };
    }),
  };
  (s.uploadBatches ||= []).unshift(batch);
  return batch.id;
}
export function parseFailed(v: Version) {
  return v.process === "失败" || v.process === "部分失败";
}
export function reviewProblems(
  s: State,
  item: StagedUploadItem,
  batch?: UploadBatch,
) {
  const v = item.v,
    problems: string[] = [];
  if (v.process !== "完成") problems.push("请先完成文件解析");
  if (Object.values(v.pageStates || {}).some((p) => p.status === "失败"))
    problems.push("存在页面解析失败，请重新解析");
  if (!v.title.trim()) problems.push("内容标题必填");
  if (v.tagStatus === "待打标" || v.tagStatus === "打标中")
    problems.push("标签识别尚未完成");
  if (v.tagStatus === "失败" && !item.manualTagging)
    problems.push("请重试打标或人工完成标签核对");
  if (
    v.tags.some(
      (b) =>
        !s.tags.some(
          (t) =>
            t.id === b.tagId &&
            t.parentId &&
            (availableTag(s.tags, t) ||
              (batch?.kind === "tags" &&
                s.assets
                  .find((a) => a.id === item.targetId)
                  ?.versions.find((v) => v.number === item.baseVersion)
                  ?.tags.some(
                    (old) => old.tagId === b.tagId && old.page === b.page,
                  ))),
        ),
    )
  )
    problems.push("存在已停用或失效标签，请移除或替换");
  if (
    v.tags.some(
      (b) =>
        b.page !== undefined &&
        (!Number.isInteger(b.page) || b.page < 1 || b.page > v.pages),
    )
  )
    problems.push("标签页码无效");
  if (batch?.kind === "tags") {
    const asset = s.assets.find((a) => a.id === item.targetId);
    if (
      !asset ||
      asset.lifecycle !== "正常" ||
      asset.current !== item.baseVersion ||
      JSON.stringify(current(asset)) !== item.baseline
    )
      problems.push("正式内容已变化，请重新同步本文件");
    return problems;
  }
  if (v.approval.mode === "pending")
    problems.push("上传时未完成审批登记，请联系管理员核查本批次");
  if (v.approval.mode === "registered")
    problems.push(
      ...((v.approval.snapshot
        ? credentialErrors(v.approval.snapshot)
        : ["缺少审批信息"]) as string[]),
    );
  return problems;
}
function editable(s: State, batchId: string, itemId: string) {
  const ctx = batchAccess(s, batchId),
    item = ctx.batch.items.find((i) => i.id === itemId);
  if (!item || !activeItem(item)) throw new Error("该明细已结束或不存在。");
  return { ...ctx, item };
}
export function invalidate(item: StagedUploadItem) {
  item.revision++;
  item.confirmedRevision = undefined;
  item.confirmedAt = undefined;
  item.confirmedBy = undefined;
  item.archiveError = undefined;
}
export function patchStaged(
  s: State,
  batchId: string,
  itemId: string,
  patch: Partial<
    Pick<
      Version,
      "title" | "summary" | "tags" | "cover" | "thumbnail" | "videos"
    >
  >,
  flags: Partial<
    Pick<StagedUploadItem, "noApplicableTags" | "manualTagging">
  > = {},
) {
  const { item, batch } = editable(s, batchId, itemId);
  const allowed = new Set([
    "title",
    "summary",
    "tags",
    "cover",
    "thumbnail",
    "videos",
  ]);
  if (Object.keys(patch).some((key) => !allowed.has(key)))
    throw new Error("提交后不能更换源文件或修改审批信息。");
  if (batch.kind === "tags" && Object.keys(patch).some((key) => key !== "tags"))
    throw new Error("标签更新仅允许维护标签，内容信息保持原样。");
  if (["处理中", "排队中"].includes(item.v.process))
    throw new Error("文件正在解析打标，请等待完成后核对结果。");
  if (
    JSON.stringify({ ...item.v, ...patch }) === JSON.stringify(item.v) &&
    Object.entries(flags).every(
      ([k, v]) => item[k as keyof StagedUploadItem] === v,
    )
  )
    return;
  const { tags, ...metadata } = patch;
  if (tags) {
    for (const b of tags) {
      if (
        item.v.tags.some((old) => old.tagId === b.tagId && old.page === b.page)
      )
        continue;
      const tag = s.tags.find((t) => t.id === b.tagId);
      if (!tag?.parentId || !availableTag(s.tags, tag))
        throw new Error("只能添加已启用标签。");
    }
    maintainBindings(item.v, tags, s.tags);
    applyRules(item.v, s.tags, s.rules);
  }
  Object.assign(item.v, structuredClone(metadata));
  Object.assign(item, flags);
  if (patch.tags?.length) item.noApplicableTags = false;
  invalidate(item);
}
export function resolveStagedRecommendation(
  s: State,
  batchId: string,
  itemId: string,
  recommendationId: string,
  tagId?: string,
) {
  const { item } = editable(s, batchId, itemId);
  if (item.v.process !== "完成")
    throw new Error("请等待匹配或解析完成后处理推荐。");
  const recommendation = item.recommendations?.find(
    (r) => r.id === recommendationId,
  );
  if (!recommendation || recommendation.resolved)
    throw new Error("推荐已处理或不存在。");
  if (tagId) {
    const tag = s.tags.find(
      (t) =>
        t.id === tagId &&
        t.parentId === recommendation.parentId &&
        availableTag(s.tags, t),
    );
    if (!tag) throw new Error("请选择同分类且已启用的标签。");
    if (
      !item.v.tags.some(
        (b) => b.tagId === tagId && b.page === recommendation.page,
      )
    )
      item.v.tags.push({ tagId, origin: "人工", page: recommendation.page });
  }
  recommendation.resolved = true;
  recommendation.resolvedTagId = tagId;
  recommendation.cancelled = !tagId;
  if (!tagId) excludeTag(item.v, recommendation, recommendation.page);
  else item.v.tags = item.v.tags.map((b) => stampBinding(b, s.tags));
  invalidate(item);
}
export function restoreStagedRecommendation(
  s: State,
  batchId: string,
  itemId: string,
  id: string,
) {
  const { item } = editable(s, batchId, itemId);
  if (item.v.process !== "完成") throw new Error("请等待处理完成。");
  const r = item.recommendations?.find((r) => r.id === id && r.cancelled);
  if (!r) throw new Error("已取消的推荐不存在。");
  r.resolved = false;
  r.cancelled = false;
  item.v.tagExclusions = item.v.tagExclusions?.filter(
    (e) => !exclusionMatches(e, r, r.page),
  );
  invalidate(item);
}
export function confirmStaged(s: State, batchId: string, itemId: string) {
  const { item, actor } = editable(s, batchId, itemId);
  if (
    ["排队中", "处理中"].includes(item.v.process) ||
    parseFailed(item.v)
  )
    throw new Error("请先完成文件解析，再确认结果。");
  if (Object.values(item.v.pageStates || {}).some((p) => p.status === "失败"))
    throw new Error("存在页面解析失败，请重新解析");
  if (item.v.tagStatus === "待打标" || item.v.tagStatus === "打标中")
    throw new Error("标签识别尚未完成，请稍后确认。");
  if (item.v.tagStatus === "失败" && !item.manualTagging)
    throw new Error("请重试打标或人工完成标签核对后再确认。");
  item.confirmedRevision = item.revision;
  item.confirmedAt = now();
  item.confirmedBy = actor.id;
  item.confirmedTags = boundDefinitions(item.v, s.tags);
}
export function retryStaged(s: State, batchId: string, itemId: string) {
  const { item, batch } = editable(s, batchId, itemId);
  if (batch.kind === "tags") {
    const task = s.tasks.find((t) => t.batchId === batchId);
    const entry = task?.items.find((i) => i.assetId === item.targetId);
    if (!task || !entry) throw new Error("任务不存在，请重新发起匹配。");
    if (item.v.process === "处理中")
      throw new Error("文件正在匹配，请等待完成。");
    entry.status = "失败";
    retryTagMatching(s, task.id, item.targetId);
    return;
  }
  if (["处理中", "排队中"].includes(item.v.process))
    throw new Error("文件正在处理中。");
  if (
    item.v.process === "完成" &&
    item.v.tagStatus !== "失败" &&
    !Object.values(item.v.pageStates || {}).some((p) => p.status === "失败")
  )
    throw new Error("解析已完成，无需重新解析；可直接核对和调整标签。");
  invalidate(item);
  item.v.process = "处理中";
  item.v.tagStatus = "打标中";
  item.finishAt = Date.now() + 1500;
  item.error = undefined;
  item.manualTagging = false;
}
export function rebaseStaged(s: State, batchId: string, itemId: string) {
  const { item, batch } = editable(s, batchId, itemId);
  if (batch.kind === "tags") return retryStaged(s, batchId, itemId);
  const target = s.assets.find((a) => a.id === item.targetId);
  if (!target || target.lifecycle !== "正常")
    throw new Error("原内容已作废或不存在，无法更新。");
  item.baseVersion = target.current;
  invalidate(item);
}
export function advanceUploads(s: State, time = Date.now(), batchId?: string) {
  for (const batch of (s.uploadBatches || []).filter(
    (b) => b.kind !== "tags" && (!batchId || b.id === batchId),
  )) {
    const due = batch.items.filter(
      (i) => activeItem(i) && i.finishAt !== undefined && i.finishAt <= time,
    );
    for (const item of due) {
      item.finishAt = undefined;
      invalidate(item);
      item.v.process = "完成";
      item.v.tagStatus = "已完成";
      item.error = undefined;
      const text = [item.v.title, item.v.summary, ...item.v.content]
        .join(" ")
        .normalize("NFKC")
        .toLowerCase();
      // 命中条件：标签名 ∪ 别名（如产品通用名）任一词命中正文。
      const ai = s.tags
        .filter(
          (t) => t.parentId && aiEligibleTag(s.tags, t) && tagHitsText(t, text),
        )
        .map((t) => ({ tagId: t.id, origin: "AI" as const }));
      item.v.tags = [
        ...item.v.tags.filter((b) => b.origin === "人工"),
        ...ai.filter(
          (b) =>
            !item.v.tags.some(
              (t) => t.origin === "人工" && t.tagId === b.tagId && !t.page,
            ),
        ),
      ];
      for (let page = 1; page <= item.v.pages; page++) {
        const body = item.v.content[page - 1]?.normalize("NFKC").toLowerCase();
        if (!body) continue;
        for (const tag of s.tags.filter(
          (t) => t.parentId && aiEligibleTag(s.tags, t) && tagHitsText(t, body),
        ))
          if (!item.v.tags.some((b) => b.tagId === tag.id && b.page === page))
            item.v.tags.push({ tagId: tag.id, origin: "AI", page });
      }
      item.v.pageStates = Object.fromEntries(
        Array.from({ length: item.v.pages }, (_, i) => [
          i + 1,
          { status: "完成" as const },
        ]),
      );
      // 单值维度收敛后再走一次规则，规则产物整体重算。
      item.v.tags = enforceSingleValue(item.v.tags, s.tags);
      applyRules(item.v, s.tags, s.rules);
    }
    if (due.length)
      pushNotice(s, {
        title: "解析打标完成，待确认归档",
        detail: `${due.length} 份内容已完成解析打标，请核对后归档。`,
        route: `upload/${batch.id}`,
        recipientId: batch.ownerId,
      });
  }
}
export function archiveStaged(
  s: State,
  batchId: string,
  ids: string[],
  fileErrors: Record<string, string> = {},
) {
  const { batch, actor, role } = batchAccess(s, batchId);
  const result = { success: 0, failed: 0 };
  for (const id of [...new Set(ids)]) {
    const item = batch.items.find((i) => i.id === id);
    if (!item || !activeItem(item)) continue;
    try {
      if (
        item.confirmedTags &&
        item.confirmedTags !== boundDefinitions(item.v, s.tags)
      )
        throw new Error("标签定义已变化，请重新确认本文件。");
      if (fileErrors[id]) throw new Error(fileErrors[id]);
      if (item.confirmedRevision !== item.revision)
        throw new Error("内容变更后需要重新确认结果。");
      const issues = reviewProblems(s, item, batch);
      if (issues.length) throw new Error(issues.join("；"));
      if (batch.kind === "tags") {
        const asset = s.assets.find((a) => a.id === item.targetId)!;
        const base =
          asset.versions.find((v) => v.number === item.baseVersion) ||
          current(asset);
        const at = now(),
          number = Math.max(...asset.versions.map((v) => v.number)) + 1;
        const version: Version = {
          ...structuredClone(base),
          fields: structuredClone(item.v.fields),
          fieldsManual: structuredClone(item.v.fieldsManual),
          tags: item.v.tags.map((b) => stampBinding(b, s.tags)),
          tagExclusions: structuredClone(item.v.tagExclusions),
          number,
          createdAt: at,
          archivedAt: at,
          confirmedAt: item.confirmedAt,
          confirmedBy: item.confirmedBy,
          process: "完成",
          changeNote: "标签更新确认后归档新版本",
        };
        for (const r of item.recommendations || []) {
          const suggestion = s.suggestions.find((x) => x.id === r.suggestionId);
          if (!suggestion || !r.resolved) continue;
          const context = {
            assetId: asset.id,
            version: number,
            page: r.page,
          };
          const key = r.cancelled ? "cancelled" : "accepted";
          if (
            !suggestion[key]?.some(
              (c) =>
                c.assetId === context.assetId &&
                c.version === context.version &&
                c.page === context.page,
            )
          )
            (suggestion[key] ||= []).push(context);
        }
        asset.versions.push(version);
        asset.current = number;
        asset.updatedAt = now();
        // 内容升版后，历史版本上未处理的推荐随内容快照迁移到新版本。
        for (const suggestion of s.suggestions)
          for (const context of suggestion.contexts || [])
            if (
              context.assetId === asset.id &&
              context.version === item.baseVersion
            )
              context.version = number;
        const pending =
          pendingRecommendationsForVersion(s, asset, number).length > 0;
        version.tagStatus = pending ? "未匹配" : "已完成";
        version.unmatched = pending ? "有推荐标签可后续处理。" : undefined;
        item.archived = {
          assetId: asset.id,
          version: number,
          at: now(),
        };
        item.archiveError = undefined;
        result.success++;
        continue;
      }
      if (item.v.approval.mode === "exempt" && !canRole(role, "exempt"))
        throw new Error("免登记权限已变化。");
      let asset = item.targetId
        ? s.assets.find((a) => a.id === item.targetId)
        : undefined;
      if (
        item.targetId &&
        (!asset ||
          asset.lifecycle !== "正常" ||
          asset.current !== item.baseVersion)
      )
        throw new Error("目标内容版本已变化或作废，请重新核对更新目标。");
      const at = now(),
        number = asset
          ? Math.max(...asset.versions.map((v) => v.number)) + 1
          : 1;
      const version: Version = {
        ...structuredClone(item.v),
        tags: item.v.tags.map((b) => stampBinding(b, s.tags)),
        number,
        createdAt: at,
        archivedAt: at,
        confirmedAt: item.confirmedAt,
        confirmedBy: item.confirmedBy,
        process: "完成",
        tagStatus: "已完成",
        changeNote: asset ? "确认结果后归档新版本" : "人工确认后首次归档",
      };
      if (version.approval.mode === "registered" && version.approval.snapshot) {
        const credentialId = uid("credential");
        version.approval.credentialId = credentialId;
        s.credentials.push({
          id: credentialId,
          createdAt: at,
          createdBy: actor.id,
          revisions: [structuredClone(version.approval.snapshot)],
        });
      }
      if (!asset) {
        const numeric =
          Math.max(
            0,
            ...s.assets.map((a) => Number(a.code.replace("CMS-", "")) || 0),
          ) + 1;
        asset = {
          id: uid("asset"),
          code: `CMS-${String(numeric).padStart(5, "0")}`,
          ownerId: batch.ownerId,
          current: number,
          versions: [],
          lifecycle: "正常",
          updatedAt: at,
        };
        s.assets.unshift(asset);
      }
      asset.versions.push(version);
      asset.current = number;
      asset.updatedAt = at;
      for (const r of item.recommendations || []) {
        if (r.resolved) continue;
        let suggestion = s.suggestions.find(
          (x) =>
            x.status !== "已忽略" &&
            x.parentId === r.parentId &&
            normalizeTagName(x.name) === normalizeTagName(r.name),
        );
        if (!suggestion) {
          suggestion = {
            id: uid("suggestion"),
            name: r.name,
            parentId: r.parentId,
            mentions: 0,
            assetIds: [],
            contexts: [],
            status: "待处理",
          };
          s.suggestions.unshift(suggestion);
        }
        suggestion.contexts ||= suggestionContexts(suggestion, s.assets);
        const context = { assetId: asset.id, version: number, page: r.page };
        if (
          !suggestion.contexts?.some(
            (c) =>
              c.assetId === context.assetId &&
              c.version === number &&
              c.page === r.page,
          )
        ) {
          (suggestion.contexts ||= []).push(context);
          suggestion.mentions++;
        }
        if (!suggestion.assetIds.includes(asset.id))
          suggestion.assetIds.push(asset.id);
        suggestion.status = "待处理";
      }
      const pending = pendingRecommendationsForVersion(s, asset).length > 0;
      version.tagStatus = pending ? "未匹配" : "已完成";
      version.unmatched = pending ? "有推荐标签可后续处理。" : undefined;
      item.archived = { assetId: asset.id, version: number, at };
      item.archiveError = undefined;
      result.success++;
    } catch (error) {
      item.archiveError = error instanceof Error ? error.message : "归档失败";
      result.failed++;
    }
  }
  if (result.success)
    pushNotice(s, {
      title: batch.kind === "tags" ? "标签更新归档完成" : "内容归档完成",
      detail:
        batch.kind === "tags"
          ? `已为 ${result.success} 份内容创建新版本并更新标签${
              result.failed ? `，${result.failed} 份需处理` : ""
            }。`
          : `成功归档 ${result.success} 份内容${
              result.failed ? `，${result.failed} 份需处理` : ""
            }。`,
      route: `upload/${batch.id}`,
      recipientId: batch.ownerId,
    });
  return result;
}
