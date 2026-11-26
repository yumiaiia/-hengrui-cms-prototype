import { referenceTags } from "./referenceTags";
import { fileParsingFailed } from "./fileProcessing";
import { primaryTagId } from "./model";
import {
  current,
  expiryStatus,
  now,
  type Asset,
  type Binding,
  type Publication,
  type State,
  type Tag,
  type Version,
} from "./model";

export const paginated = (v: Version) =>
  ["PDF", "PPT", "Word"].includes(v.kind);
export function matchesTags(
  bindings: Binding[],
  selected: string[],
  tags: Tag[],
) {
  const groups = [
    ...new Set(selected.map((id) => tags.find((t) => t.id === id)?.parentId)),
  ];
  return groups.every((parent) =>
    bindings.some(
      (b) =>
        selected.includes(b.tagId) &&
        tags.find((t) => t.id === b.tagId)?.parentId === parent,
    ),
  );
}
export function pageHits(
  assets: Asset[],
  tags: Tag[],
  materialTags: string[],
  pageTags: string[],
  query = "",
  people: Record<string, string> = {},
) {
  return assets.flatMap((asset) => {
    const v = current(asset);
    if (
      v.process !== "完成" ||
      fileParsingFailed(v) ||
      !paginated(v) ||
      !matchesTags(
        v.tags.filter((b) => !b.page),
        materialTags,
        tags,
      )
    )
      return [];
    const count = v.pages;
    return Array.from({ length: count }, (_, i) => i + 1).flatMap((page) => {
      const bindings = v.tags.filter((b) => b.page === page);
      const text = [
        v.title,
        asset.code,
        people[asset.ownerId] || "",
        v.approval.snapshot?.number || "",
        v.content[page - 1] || "",
        ...bindings.map((b) => tags.find((t) => t.id === b.tagId)?.name),
      ]
        .join(" ")
        .toLowerCase();
      return matchesTags(bindings, pageTags, tags) &&
        text.includes(query.trim().toLowerCase())
        ? [{ asset, version: v, page, bindings }]
        : [];
    });
  });
}
export function publicationProblems(asset: Asset, v: Version) {
  return [
    expiryStatus(v) === "已过期" && "内容已过期，请先更新有效期",
    asset.lifecycle !== "正常" && "内容已作废",
    (v.process !== "完成" || fileParsingFailed(v)) && "请先完成文件解析",
    v.approval.mode === "pending" && "请先补充审批信息",
    v.tagStatus === "打标中" && "标签识别尚未完成",
    v.tagStatus === "待打标" && "请先完成标签识别",
  ].filter(Boolean) as string[];
}
export function prepareWorkspace(state: State): State {
  if (state.workspaceRevision === 7) return state;
  const s = structuredClone(state);
  for (const role of s.roles)
    if (role.menus.includes("library") && !role.menus.includes("publishing"))
      role.menus.push("publishing");
  for (const a of s.assets)
    for (const v of a.versions) {
      if (v.process === "部分失败") v.process = "失败";
      if (paginated(v) && !v.pageStates) {
        v.pageStates = Object.fromEntries(
          Array.from({ length: v.pages }, (_, i) => [
            i + 1,
            { status: "完成" },
          ]),
        );
      }
    }
  s.publications ||= [];
  const samples: {
    assetId: string;
    status: Publication["status"];
    offset: number;
  }[] = [
    { assetId: "a1", status: "待发布", offset: 2 },
    { assetId: "a6", status: "已发布", offset: -1 },
    { assetId: "a7", status: "发布失败", offset: 3 },
    { assetId: "a8", status: "待发布", offset: 4 },
  ];
  if (!s.publications.length)
    for (const [i, sample] of samples.entries()) {
      const a = s.assets.find((a) => a.id === sample.assetId);
      if (!a) continue;
      const v = current(a);
      const planned = new Date();
      planned.setDate(planned.getDate() + sample.offset);
      planned.setHours(10, 0, 0, 0);
      const id = `publication-demo-${i}`;
      const createdAt = now();
      const record: Publication = {
        id,
        assetId: a.id,
        version: v.number,
        title: v.title,
        summary: v.summary,
        cover: v.cover,
        plannedAt: planned.toISOString(),
        createdAt,
        updatedAt: createdAt,
        submittedAt: createdAt,
        status: sample.status,
        revision: 1,
        previews: [],
      };
      if (sample.status === "发布失败")
        record.error = "下游反馈：封面资源获取失败，请更换封面后重新提交。";
      if (sample.status === "待发布" || sample.status === "已发布")
        record.previews = ["微网站", "企微端", "微信端"].map((port, j) => ({
          id: `${id}-${j}`,
          platform: "瑞医空间",
          port,
          url: `${locationOrigin()}/#/publication-preview/${id}?port=${encodeURIComponent(port)}&revision=1`,
          generatedAt: createdAt,
          version: v.number,
          revision: 1,
          status: sample.status,
          actualAt:
            sample.status === "已发布" ? planned.toISOString() : undefined,
        }));
      s.publications.push(record);
    }
  // Upgrade known demonstration tags; keep user-created tags and bindings.
  const aliases: Record<string, [string, string]> = {
    t1: ["产品标签", "卡瑞利珠单抗"],
    t2: ["药物分类", "PD-1抑制剂"],
    t3: ["疾病领域", "非小细胞肺癌"],
    t4: ["疾病领域", "类风湿关节炎"],
    t5: ["内容主题", "临床研究"],
    t6: ["治疗方案", "免疫联合化疗"],
    t7: ["内容主题", "疾病知识与患教"],
    t8: ["内容主题", "指南共识"],
    t9: ["内容主题", "病例分享"],
    t10: ["药物分类", "抗体药物"],
    t11: ["治疗方案", "单药治疗"],
  };
  for (const [id, [group, name]] of Object.entries(aliases)) {
    const t = s.tags.find((t) => t.id === id);
    if (t) {
      t.name = name;
      t.parentId = primaryTagId(group);
    }
  }
  for (const t of referenceTags)
    if (
      !s.tags.some((old) => old.name === t.name && old.parentId === t.parentId)
    )
      s.tags.push(structuredClone(t));
  // 用户可见范围为派生标签目标，仅允许人工与派生规则添加，AI 链路排除。
  for (const t of s.tags)
    if (t.parentId === primaryTagId("用户可见范围")) t.manualOnly = true;
  // 演示用写死集合预置值（正式值待上线前按初始化清单替换）。
  for (const name of ["指南共识", "临床研究"]) {
    const tag = s.tags.find((t) => t.parentId && t.name === name);
    if (tag) {
      tag.locked = true;
      tag.enabled = true;
    }
  }
  const obsolete = [
    "产品 / 品牌",
    "产品线",
    "目标受众",
    "Key Message",
    "页面类型",
    "证据类型",
  ];
  s.tags = s.tags.filter(
    (t) =>
      t.parentId !== null ||
      !obsolete.includes(t.name) ||
      s.tags.some((c) => c.parentId === t.id),
  );
  for (const suggestion of s.suggestions) {
    if (!s.tags.some((t) => t.id === suggestion.parentId))
      suggestion.parentId = primaryTagId("内容主题");
  }
  for (const a of s.assets)
    for (const v of a.versions) {
      if (
        paginated(v) &&
        v.process === "完成" &&
        a.id.startsWith("a") &&
        v.tags.some((b) => b.tagId === "t7")
      ) {
        if (!v.tags.some((b) => b.page === 3))
          v.tags.push({ tagId: "t9", origin: "AI", page: 3 });
        if (a.id === "a1") {
          const treatment = s.tags.find((t) => t.name === "免疫联合化疗");
          if (
            treatment &&
            !v.tags.some((b) => b.page === 2 && b.tagId === treatment.id)
          )
            v.tags.push({ tagId: treatment.id, origin: "AI", page: 2 });
        }
      }
    }
  for (const p of s.publications || []) {
    const a = s.assets.find((a) => a.id === p.assetId);
    const v = a?.versions.find((v) => v.number === p.version);
    if (v && p.status !== "草稿") p.snapshot ||= structuredClone(v);
    p.thumbnail ||= v?.thumbnail;
    p.submittedBy ||= a?.ownerId;
  }
  if (!s.assets.some((a) => a.id === "demo-page-linkage")) {
    const template = s.assets.find((a) => a.id === "a1")?.versions[0];
    if (template) {
      const base: Version = {
        ...structuredClone(template),
        number: 1,
        kind: "PDF",
        title: "非小细胞肺癌免疫联合治疗 · 学术资料",
        fileName: "非小细胞肺癌免疫联合治疗.pdf",
        fileUrl: "/samples/sample.pdf",
        fileKey: undefined,
        previewUrl: undefined,
        fileHash: undefined,
        source: "手动上传",
        process: "完成",
        tagStatus: "已完成",
        pages: 3,
        cover: "/samples/cover-1.svg",
        thumbnail: "/samples/cover-2.svg",
        approval: { mode: "exempt" },
        expiry: "2027-12-31",
        summary: "按疾病知识、指南证据和病例分享整理免疫联合治疗学术资料。",
        content: [
          "疾病背景与资料概览\n\n本页梳理非小细胞肺癌的疾病背景。页级标签为疾病知识与患教；整份材料的产品、疾病领域标签在上方展示。此为原型演示资料。",
          "指南证据与治疗方案\n\n本页整理指南共识及免疫联合化疗相关证据。页级标签为指南共识、免疫联合化疗。切换页面后，右侧标签会同步更新。此为原型演示资料。",
          "病例分享与应用讨论\n\n本页为病例分享结构示例。页级标签为病例分享、单药治疗，与前两页分别管理。此为原型演示资料，不构成医学建议。",
        ],
        tags: [
          { tagId: "t1", origin: "AI" },
          { tagId: "t3", origin: "AI" },
          { tagId: "t5", origin: "AI" },
          { tagId: "t7", origin: "AI", page: 1 },
          { tagId: "t8", origin: "AI", page: 2 },
          { tagId: "t6", origin: "人工", page: 2 },
          { tagId: "t9", origin: "AI", page: 3 },
          { tagId: "t11", origin: "AI", page: 3 },
        ],
        pageStates: {
          1: { status: "完成" },
          2: { status: "完成" },
          3: { status: "完成" },
        },
        changeNote: "首次归档",
        unmatched: undefined,
        createdAt: now(),
      };
      const latest: Version = {
        ...structuredClone(base),
        number: 2,
        summary: "更新指南证据与病例讨论，补充材料标签与页级标签。",
        changeNote: "更新指南证据与病例讨论",
        createdAt: now(),
      };
      const maxCode = Math.max(
        0,
        ...s.assets.map((a) => Number(a.code.replace("CMS-", "")) || 0),
      );
      s.assets.unshift({
        id: "demo-page-linkage",
        code: `CMS-${String(maxCode + 1).padStart(5, "0")}`,
        ownerId: s.users[0]?.id || "u1",
        current: 2,
        versions: [base, latest],
        lifecycle: "正常",
        updatedAt: now(),
      });
      const p: Publication = {
        id: "publication-version-example",
        assetId: "demo-page-linkage",
        version: 1,
        title: base.title,
        summary: base.summary,
        cover: base.cover,
        thumbnail: base.thumbnail,
        snapshot: structuredClone(base),
        submittedBy: s.users[0]?.id,
        plannedAt: new Date(Date.now() + 86400000 * 3).toISOString(),
        createdAt: now(),
        updatedAt: now(),
        submittedAt: now(),
        status: "待发布",
        revision: 1,
        previews: [],
      };
      p.previews = ["微网站", "企微端", "微信端"].map((port, i) => ({
        id: `${p.id}-${i}`,
        platform: "瑞医空间",
        port,
        url: `${locationOrigin()}/#/publication-preview/${p.id}?port=${encodeURIComponent(port)}&revision=1`,
        generatedAt: now(),
        version: 1,
        revision: 1,
        status: "待发布",
      }));
      s.publications!.unshift(p);
    }
  }
  s.workspaceRevision = 7;
  return s;
}
function locationOrigin() {
  return typeof location === "undefined"
    ? "http://127.0.0.1:5180"
    : location.origin;
}
