import {
  refDimensionId,
  refValueId,
  referenceRules,
  referenceTags,
} from "./referenceTags";
import { fileParsingFailed } from "./fileProcessing";
import { VISIBILITY_FIELD, type Rule } from "./model";
import { applyRules } from "./tagResults";
import {
  current,
  expiryStatus,
  now,
  primaryTagId,
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
  if (state.workspaceRevision === 10) return state;
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
  upgradeTagModel(s);
  const obsolete = [
    "产品 / 品牌",
    "产品线",
    "产品标签",
    "研究要点",
    "目标受众",
    "Key Message",
    "页面类型",
    "证据类型",
  ];
  // 早期演示遗留的分类整体移除（含其取值与残留绑定），避免与新维度混在一起。
  const obsoleteIds = new Set(
    s.tags
      .filter((t) => !t.parentId && obsolete.includes(t.name))
      .flatMap((root) => [
        root.id,
        ...s.tags.filter((t) => t.parentId === root.id).map((t) => t.id),
      ]),
  );
  if (obsoleteIds.size) {
    for (const a of s.assets)
      for (const v of a.versions)
        v.tags = v.tags.filter((b) => !obsoleteIds.has(b.tagId));
    s.tags = s.tags.filter((t) => !obsoleteIds.has(t.id));
  }
  for (const suggestion of s.suggestions) {
    if (!s.tags.some((t) => t.id === suggestion.parentId))
      suggestion.parentId = primaryTagId("内容主题");
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
          { tagId: refValueId("产品", "卡瑞利珠单抗"), origin: "AI" },
          { tagId: refValueId("疾病领域", "非小细胞肺癌"), origin: "AI" },
          { tagId: refValueId("内容类型", "文献解读"), origin: "AI" },
          { tagId: refValueId("治疗方案", "免疫联合化疗"), origin: "人工" },
          { tagId: refValueId("内容主题", "疾病预防"), origin: "AI", page: 1 },
          { tagId: refValueId("内容主题", "循证医学"), origin: "AI", page: 2 },
          { tagId: refValueId("内容主题", "治疗"), origin: "AI", page: 3 },
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
      applyRules(base, s.tags, s.rules);
      applyRules(latest, s.tags, s.rules);
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
  s.workspaceRevision = 10;
  return s;
}

/** 旧演示标签 → 新维度取值（CSV 口径），迁移时改写已有绑定。 */
const LEGACY_TAG_MAP: Record<string, [string, string]> = {
  t1: ["产品", "卡瑞利珠单抗"],
  t2: ["药物分类", "PD-1抑制剂"],
  t3: ["疾病领域", "非小细胞肺癌"],
  t4: ["疾病领域", "类风湿关节炎"],
  t5: ["内容类型", "文献解读"],
  t6: ["治疗方案", "免疫联合化疗"],
  t7: ["内容主题", "疾病预防"],
  t8: ["内容主题", "循证医学"],
  t9: ["内容主题", "治疗"],
  t10: ["药物分类", "抗体药物"],
  t11: ["治疗方案", "单药治疗"],
};
const LEGACY_AUDIENCES = ["未注册", "已注册待认证", "已认证"];
/** 旧可见范围枚举值 → 新受众集合（旧枚举在迁移后会被字段配置取代）。 */
function legacyAudiences(name: string): string[] {
  if (name === "All三类用户") return [...LEGACY_AUDIENCES];
  if (name === "已注册待认证") return ["已注册待认证", "已认证"];
  return ["已认证"];
}
type LegacyState = State & {
  visibilityRules?: { visibility: string; triggers: string[] }[];
  derivationRules?: unknown;
};
type LegacyVersion = Version & {
  visibility?: string;
  visibilityManual?: boolean;
};
/**
 * P0 迁移：写死集合 / deriveFrom / visibilityRules → 维度属性 + 规则 + 字段值。
 * 只做一次性转换，不重算业务已确认的取值，除非规则需要重新推导。
 */
function upgradeTagModel(s: State) {
  const legacy = s as LegacyState;
  const versions: LegacyVersion[] = [
    ...s.assets.flatMap((a) => a.versions),
    ...(s.uploadBatches || []).flatMap((b) => b.items.map((i) => i.v)),
  ];
  // A. 用户可见范围：旧标签取值 → 字段值（受众集合）
  const oldAudience = new Map<string, string>();
  for (const t of s.tags)
    if (t.parentId === VISIBILITY_FIELD && t.id !== refValueId("用户可见范围", t.name))
      oldAudience.set(t.id, t.name);
  for (const v of versions) {
    const bound = v.tags.filter((b) => oldAudience.has(b.tagId));
    const names = new Set<string>();
    let manual = !!v.visibilityManual;
    for (const b of bound) {
      legacyAudiences(oldAudience.get(b.tagId)!).forEach((a) => names.add(a));
      if (b.origin === "人工") manual = true;
    }
    if (v.visibility)
      legacyAudiences(v.visibility).forEach((a) => names.add(a));
    if (names.size) {
      v.fields ||= {};
      v.fields[VISIBILITY_FIELD] = LEGACY_AUDIENCES.filter((a) =>
        names.has(a),
      ).map((a) => refValueId("用户可见范围", a));
      if (manual)
        v.fieldsManual = [
          ...new Set([...(v.fieldsManual || []), VISIBILITY_FIELD]),
        ];
    }
    v.tags = v.tags.filter((b) => !oldAudience.has(b.tagId));
    v.tagExclusions = v.tagExclusions?.filter(
      (e) => !(e.valueId && oldAudience.has(e.valueId)),
    );
    delete v.visibility;
    delete v.visibilityManual;
  }
  s.tags = s.tags.filter((t) => !oldAudience.has(t.id));
  // 旧字段清理：历史旧名、值域受控、填充方式都不再是模型的一部分；
  // 维度禁止停用，迁移时统一置为启用。
  for (const t of s.tags) {
    const legacyTag = t as Tag & {
      legacyNames?: unknown;
      valuePolicy?: unknown;
      fillMode?: unknown;
    };
    delete legacyTag.legacyNames;
    delete legacyTag.valuePolicy;
    delete legacyTag.fillMode;
    if (!t.parentId) {
      t.enabled = true;
      if (t.kind === "enum") {
        t.ai = "none";
        t.scope = "material";
      }
      if (t.cardinality === "single") t.merge = "priority";
    }
  }
  for (const rule of s.rules || []) {
    const legacyRule = rule as Rule & {
      source?: unknown;
      trigger: { scope?: unknown };
    };
    delete legacyRule.source;
    delete legacyRule.trigger.scope;
  }
  // B. 补齐新维度与取值：只补缺，不覆盖业务改动
  for (const ref of referenceTags) {
    const existing = s.tags.find((t) => t.id === ref.id);
    if (!existing) {
      s.tags.push(structuredClone(ref));
      continue;
    }
    if (existing.parentId) continue;
    for (const key of [
      "kind",
      "cardinality",
      "scope",
      "ai",
      "merge",
      "fallbackId",
      "humanEditable",
    ] as const)
      if (existing[key] === undefined && ref[key] !== undefined)
        Object.assign(existing, { [key]: ref[key] });
  }
  // C. 旧演示标签改写为新维度取值，绑定同步换 ID
  const remap = new Map<string, string>();
  for (const [oldId, [dim, name]] of Object.entries(LEGACY_TAG_MAP)) {
    if (!s.tags.some((t) => t.id === oldId)) continue;
    const target = s.tags.find(
      (t) => t.parentId === refDimensionId(dim) && t.name === name,
    );
    if (target) remap.set(oldId, target.id);
  }
  if (remap.size) {
    for (const v of versions)
      v.tags = v.tags.map((b) =>
        remap.has(b.tagId)
          ? { ...b, tagId: remap.get(b.tagId)!, name: undefined, parentId: undefined }
          : b,
      );
    for (const rule of legacy.visibilityRules || [])
      rule.triggers = rule.triggers.map((id) => remap.get(id) || id);
    s.tags = s.tags.filter((t) => !remap.has(t.id));
  }
  // C2. 早期演示分类并入同名新维度，避免出现"产品标签 / 产品"两套
  const ROOT_MERGE: Record<string, string> = {
    产品标签: "产品",
    研究要点: "内容主题",
  };
  for (const [from, to] of Object.entries(ROOT_MERGE)) {
    const source = s.tags.find((t) => !t.parentId && t.name === from);
    const target = s.tags.find((t) => !t.parentId && t.name === to);
    if (!source || !target) continue;
    for (const child of s.tags.filter((t) => t.parentId === source.id)) {
      const twin = s.tags.find(
        (t) => t.parentId === target.id && t.name === child.name,
      );
      if (!twin) continue;
      for (const v of versions)
        v.tags = v.tags.map((b) =>
          b.tagId === child.id
            ? { ...b, tagId: twin.id, name: undefined, parentId: undefined }
            : b,
        );
    }
  }
  // D. 旧可见范围触发配置 → 规则；再补 CSV 预置规则（按 ID 去重，删除的不会被灌回）
  s.rules ||= [];
  const converted: Rule[] = [];
  for (const [index, old] of (legacy.visibilityRules || []).entries()) {
    const triggers = old.triggers.filter((id) =>
      s.tags.some((t) => t.id === id && t.parentId),
    );
    if (!triggers.length) continue;
    converted.push({
      id: `rule-legacy-visibility-${index + 1}`,
      name: `旧可见范围规则：${old.visibility}`,
      enabled: true,
      priority: 60,
      trigger: {
        dimensionId:
          s.tags.find((t) => t.id === triggers[0])?.parentId ||
          refDimensionId("内容主题"),
        valueIds: triggers,
        match: "any",
      },
      action: {
        dimensionId: VISIBILITY_FIELD,
        valueIds: legacyAudiences(old.visibility).map((a) =>
          refValueId("用户可见范围", a),
        ),
      },
    });
  }
  for (const rule of [...converted, ...referenceRules])
    if (!s.rules.some((r) => r.id === rule.id))
      s.rules.push(structuredClone(rule));
  delete legacy.visibilityRules;
  delete legacy.derivationRules;
  // E. 排除记忆补取值 ID：旧数据按名称记录，这里解析一次
  for (const v of versions)
    for (const e of v.tagExclusions || []) {
      if (e.valueId || !e.name) continue;
      const tag = s.tags.find(
        (t) => t.parentId === (e.parentId || null) && t.name === e.name,
      );
      if (tag) e.valueId = tag.id;
    }
  // E2. 清理既不在标准字典、也没有任何绑定的旧取值，避免新旧两套混列
  const refIds = new Set(referenceTags.map((t) => t.id));
  const boundIds = new Set(versions.flatMap((v) => v.tags.map((b) => b.tagId)));
  s.tags = s.tags.filter(
    (t) => !t.parentId || refIds.has(t.id) || boundIds.has(t.id),
  );
  // F. 规则产物整体重算（人工改过的维度保持不变）
  for (const v of versions) applyRules(v, s.tags, s.rules);
}

function locationOrigin() {
  return typeof location === "undefined"
    ? "http://127.0.0.1:5180"
    : location.origin;
}
