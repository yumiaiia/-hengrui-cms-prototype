import {
  current,
  now,
  type Approval,
  type Asset,
  type State,
  type TaskItem,
  type Version,
} from "./model";

export interface UploadInput {
  id: string;
  v: Version;
}
export interface UploadTarget {
  assetId: string;
  number: number;
  newAsset: boolean;
  code?: string;
  title: string;
}

function sameContent(a: Version, b: Version) {
  return !!(
    (a.fileHash && b.fileHash && a.fileHash === b.fileHash) ||
    (a.sourceUrl && b.sourceUrl && a.sourceUrl === b.sourceUrl)
  );
}

/** Resolve against accessible, active content, including historical versions.
 * Staged items participate too, so duplicates within one upload share an asset.
 */
export function planUploadVersions(
  assets: Asset[],
  inputs: UploadInput[],
  explicitId?: string | null,
): UploadTarget[] {
  if (!inputs.length) return [];
  const candidates = assets
    .filter((a) => a.lifecycle === "正常")
    .map((a) => ({
      id: a.id,
      code: a.code,
      title: current(a).title,
      versions: [...a.versions],
      updatedAt: a.updatedAt,
    }))
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  if (
    explicitId &&
    (inputs.length !== 1 || !candidates.some((a) => a.id === explicitId))
  )
    throw new Error("当前内容不可更新，请返回内容库重新选择。");
  return inputs.map((input) => {
    let target = explicitId
      ? candidates.find((a) => a.id === explicitId)
      : candidates.find((a) => a.versions.some((v) => sameContent(v, input.v)));
    const newAsset = !target;
    if (!target) {
      target = {
        id: `asset-${input.id}`,
        code: "",
        title: input.v.title,
        versions: [],
        updatedAt: "",
      };
      candidates.push(target);
    }
    const number = Math.max(0, ...target.versions.map((v) => v.number)) + 1;
    target.versions.push({ ...input.v, number });
    return {
      assetId: target.id,
      number,
      newAsset,
      code: target.code || undefined,
      title: target.title,
    };
  });
}

/** The approval snapshot belongs to this upload; prior versions and publications
 * retain their original snapshots, even when the approval number changes.
 */
export function appendUploadVersions(
  state: State,
  inputs: UploadInput[],
  targets: UploadTarget[],
  approval: Approval,
  ownerId: string,
): TaskItem[] {
  let numeric = Math.max(
    0,
    ...state.assets.map((a) => Number(a.code.replace("CMS-", "")) || 0),
  );
  return inputs.map((input, index) => {
    const target = targets[index];
    const asset = state.assets.find((a) => a.id === target.assetId);
    if (
      asset &&
      (asset.lifecycle !== "正常" ||
        Math.max(...asset.versions.map((v) => v.number)) >= target.number)
    )
      throw new Error("内容版本已变化，请重新核对后上传。");
    const previous = asset && current(asset);
    const version: Version = {
      ...structuredClone(input.v),
      number: target.number,
      title: input.v.title.trim(),
      cover: input.v.cover || previous?.cover,
      thumbnail: input.v.thumbnail || previous?.thumbnail,
      approval: structuredClone(approval),
      createdAt: now(),
      process: "处理中",
      tagStatus: "打标中",
      changeNote: asset ? "上传新版本，使用本次登记的审批信息。" : "首次归档",
    };
    if (asset) {
      asset.versions.push(version);
      asset.current = version.number;
      asset.updatedAt = version.createdAt;
    } else {
      if (!target.newAsset) throw new Error("原内容已不存在，请重新上传。");
      state.assets.unshift({
        id: target.assetId,
        code: `CMS-${String(++numeric).padStart(5, "0")}`,
        ownerId,
        current: version.number,
        versions: [version],
        lifecycle: "正常",
        updatedAt: version.createdAt,
      });
    }
    return {
      assetId: target.assetId,
      version: version.number,
      label: version.title,
      status: "处理中",
    };
  });
}
