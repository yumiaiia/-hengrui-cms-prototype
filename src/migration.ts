import { primaryTagId, type State, type Tag } from "./model";
interface LegacyTag {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
  external: boolean;
  parent?: string;
  synonyms?: string[];
}
export function convertLegacyTags(
  tags: LegacyTag[],
  extraRoots: string[] = [],
): Tag[] {
  const names = [...new Set([...tags.map((t) => t.group), ...extraRoots])];
  return [
    ...names.map((name) => ({
      id: primaryTagId(name),
      name,
      parentId: null,
      enabled: true,
      external: false,
    })),
    ...tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      parentId: primaryTagId(tag.group),
      enabled: tag.enabled,
      external: tag.external,
    })),
  ];
}
type VideoCarrier = { video?: unknown; videos?: unknown };
// 旧数据把补充视频存为单个 video 字段，统一迁移为 0~3 个的 videos 数组。
function normalizeVideos(value: State) {
  if ((value as State & { videoRevision?: number }).videoRevision) return;
  const carriers: VideoCarrier[] = [
    ...value.assets.flatMap((a) => a.versions as VideoCarrier[]),
    ...(value.uploadBatches || []).flatMap((b) =>
      (b.items || []).map((i) => i.v as VideoCarrier),
    ),
  ];
  for (const carrier of carriers) {
    if (carrier.video) {
      const legacy = carrier.video as import("./model").SupplementaryVideo;
      carrier.videos = [...(carrier.videos as unknown[] || []), legacy];
    }
    delete carrier.video;
  }
  (value as State & { videoRevision?: number }).videoRevision = 1;
}
export function migrateState(input: unknown): State {  if (!input || typeof input !== "object")
    throw new Error("原型数据格式无法读取");
  const value = input as State;
  if (
    ![1, 2].includes(value.schema) ||
    !Array.isArray(value.assets) ||
    !Array.isArray(value.tags) ||
    !Array.isArray(value.roles)
  )
    throw new Error("原型数据结构不完整");
  normalizeVideos(value);
  if (value.schema === 2) return value;
  const legacy = structuredClone(input) as Omit<
    State,
    "tags" | "suggestions"
  > & {
    tags: LegacyTag[];
    suggestions: (Omit<State["suggestions"][number], "parentId"> & {
      group: string;
    })[];
  };
  const tags = convertLegacyTags(
    legacy.tags,
    legacy.suggestions.map((s) => s.group),
  );
  const suggestions = legacy.suggestions.map((s) => {
    const { group, ...rest } = s;
    return {
      ...rest,
      parentId: primaryTagId(group),
      contexts: s.assetIds.flatMap((id) => {
        const asset = legacy.assets.find((a) => a.id === id);
        return asset ? [{ assetId: id, version: asset.current }] : [];
      }),
      accepted: [],
    };
  });
  const result: State = { ...legacy, schema: 2, tags, suggestions };
  result.roles.forEach(
    (r) => (r.menus = r.menus.filter((m) => m !== "credentials")),
  );
  result.notices.forEach((n) => {
    if (n.route.startsWith("credentials")) {
      const id = new URLSearchParams(n.route.split("?")[1]).get("open");
      const a = result.assets.find((a) =>
        a.versions.some((v) => v.approval.credentialId === id),
      );
      n.route = a ? `content/${a.id}?tab=approval` : "library";
    } else if (n.route.startsWith("tags?tab=suggestions")) n.route = "library";
  });
  return result;
}
