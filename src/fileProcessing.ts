import { canRole, current, now, uid, type State, type Version } from "./model";

export function fileParsingFailed(version: Version) {
  return (
    version.process === "失败" ||
    version.process === "部分失败" ||
    version.tagStatus === "失败" ||
    Object.values(version.pageStates || {}).some(
      (page) => page.status === "失败",
    )
  );
}

export function prepareFileProcessing(state: State): State {
  if (state.fileProcessingRevision) return state;
  const next = structuredClone(state);
  for (const asset of next.assets) {
    const version = current(asset);
    if (fileParsingFailed(version)) version.process = "失败";
  }
  next.fileProcessingRevision = 1;
  return next;
}

export function reparseFile(
  state: State,
  assetId: string,
  versionNumber: number,
) {
  const user = state.users.find((item) => item.id === state.userId);
  const role = state.roles.find((item) => item.id === user?.roleId);
  if (!user || user.enabled === false || !canRole(role, "edit"))
    throw new Error("当前账号没有重新解析权限。");
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset || asset.current !== versionNumber || asset.lifecycle !== "正常")
    throw new Error("仅可重新解析正常内容的当前版本。");
  const version = current(asset);
  if (["处理中", "排队中"].includes(version.process))
    throw new Error("文件正在解析，请等待处理完成。");
  if (!fileParsingFailed(version)) throw new Error("文件无需重新解析。");
  version.process = "处理中";
  version.tagStatus = "待打标";
  version.pageStates = Object.fromEntries(
    Array.from({ length: version.pages }, (_, index) => [
      index + 1,
      { status: "待打标" as const },
    ]),
  );
  state.tasks.unshift({
    id: uid("task"),
    name: version.title + " · 重新解析",
    type: "解析与打标",
    actorId: user.id,
    status: "处理中",
    items: [
      {
        assetId,
        version: versionNumber,
        label: version.title,
        status: "处理中",
      },
    ],
    createdAt: now(),
    attempts: 1,
    finishAt: Date.now() + 2200,
  });
}
