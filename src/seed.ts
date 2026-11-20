import { sampleArticleSource } from "./collectionSources";
import { sampleCollectionTasks } from "./collection";
import { convertLegacyTags } from "./migration";
import { primaryTagId } from "./model";
import {
  accounts,
  now,
  today,
  type State,
  type Version,
  type CredentialRevision,
  type Kind,
} from "./model";
const stamp = now();
const day = (offset: number) =>
  new Date(Date.parse(today() + "T00:00:00Z") + offset * 86400000)
    .toISOString()
    .slice(0, 10);
export const demoCredential: CredentialRevision = {
  revision: 1,
  number: "APP-DEMO-001",
  title: "肿瘤学术材料包",
  expiry: "2027-06-30",
  evidence: [
    {
      id: "e1",
      name: "审批单 · 基本信息",
      url: "/samples/approval-1.svg",
      number: "APP-DEMO-001",
      title: "肿瘤学术材料包",
      expiry: "2027-06-30",
      status: "一致",
    },
  ],
  confirmed: false,
  updatedAt: stamp,
};
const titles = [
  "肿瘤诊疗研究进展 · 学术资讯",
  "临床实践指南解读与证据梳理",
  "研究摘要与关键结论汇编",
  "学术交流培训视频",
  "产品资料与常见问题",
  "专业渠道内容使用说明",
  "临床研究证据资料",
  "医学部学术资料精选",
  "免疫疾病诊疗资讯 · 公众号文章",
  "眼科研究进展 · 公众号文章",
];
const kinds: Kind[] = [
  "PDF",
  "PPT",
  "PDF",
  "视频",
  "网页",
  "PPT",
  "Word",
  "PDF",
  "网页",
  "网页",
];
const text = [
  "学术资料概览\n\n本资料为 CMS 交互原型的虚构演示内容，用于验证内容管理、标签校正与审批登记流程，不构成医学建议。\n\n材料覆盖研究背景、证据整理与关键观点，原文件、来源和版本信息均可追溯。",
  "研究背景与证据整理\n\n研究资料按疾病领域、证据类型和目标受众分类。每个页面可单独查看和校正标签，人工校正结果会保留。\n\n示例材料展示的统计数据仅用于界面演示，不代表真实研究结果。",
  "关键观点与适用范围\n\n内容归档与解析、自动打标分别管理。审批编号可复用，但不作为内容的唯一编号。\n\n请核对内容版本、审批覆盖范围及有效期，再进行后续使用。",
];
export function makeDemoVersion(i: number): Version {
  const kind = kinds[i] || "PDF";
  const url =
    kind === "PPT"
      ? "/samples/sample.pptx"
      : kind === "Word"
        ? "/samples/sample.docx"
        : kind === "PDF"
          ? "/samples/sample.pdf"
          : undefined;
  const credential =
    i === 6
      ? {
          ...demoCredential,
          number: "APP-DEMO-003",
          expiry: "2026-11-15",
          evidence: [
            {
              ...demoCredential.evidence[0],
              id: "e4",
              url: "/samples/approval-4.svg",
              number: "APP-DEMO-003",
              expiry: "2026-11-15",
              status: "一致" as const,
            },
          ],
        }
      : i === 5
        ? {
            ...demoCredential,
            number: "APP-DEMO-002",
            title: "学术指南解读资料包",
            expiry: "2026-12-07",
            evidence: [
              {
                ...demoCredential.evidence[0],
                id: "e3",
                url: "/samples/approval-3.svg",
                number: "APP-DEMO-022",
                title: "学术指南解读资料包",
                expiry: "2026-12-07",
                status: "差异" as const,
              },
            ],
            confirmed: true,
            confirmation: "已核对原审批单，截图文字识别有误，登记编号正确。",
          }
        : demoCredential;
  return {
    number: 1,
    title: titles[i] || "示例材料",
    kind,
    fileName: `${titles[i] || "示例材料"}.${kind === "PPT" ? "pptx" : kind === "Word" ? "docx" : kind === "网页" ? "html" : kind === "视频" ? "mp4" : "pdf"}`,
    fileUrl: url,
    previewUrl:
      kind === "PPT" || kind === "Word" ? "/samples/sample.pdf" : undefined,
    source: i >= 8 ? accounts[i === 8 ? 0 : 3] : "手动上传",
    sourcePublished: i >= 8 ? day(-2) : undefined,
    cover: `/samples/cover-${(i % 4) + 1}.svg`,
    thumbnail: `/samples/cover-${(i % 4) + 1}.svg`,
    summary:
      "整理研究背景与关键证据，为内容查找、标签识别和合规信息核对提供演示样例。",
    content: [...text],
    pages: 3,
    createdAt: stamp,
    process: i === 2 ? "失败" : i === 3 ? "处理中" : i === 4 ? "失败" : "完成",
    tagStatus:
      i === 2 ? "失败" : i === 1 ? "未匹配" : i === 3 ? "待打标" : "已完成",
    tags: [
      { tagId: "t1", origin: "AI" },
      { tagId: i >= 8 ? "t4" : "t3", origin: "AI" },
      { tagId: "t5", origin: i === 1 ? "人工" : "AI" },
      { tagId: "t7", origin: "AI", page: 1 },
      { tagId: "t8", origin: "AI", page: 2 },
    ],
    approval:
      i >= 8
        ? { mode: "pending" }
        : i === 7
          ? { mode: "exempt" }
          : {
              mode: "registered",
              credentialId: i === 6 ? "c3" : i === 5 ? "c2" : "c1",
              snapshot: structuredClone(credential),
            },
    unmatched:
      i === 1 ? "指南更新 · 第 2 页：标准标签池暂无完全匹配项" : undefined,
  };
}
export function seedState(): State {
  const assets = titles.map((_, i) => ({
    id: `a${i + 1}`,
    code: `CMS-${String(i + 1).padStart(5, "0")}`,
    ownerId: i % 3 === 0 ? "u2" : i % 3 === 2 ? "u3" : "u1",
    current: 1,
    versions: [makeDemoVersion(i)],
    lifecycle: "正常" as const,
    updatedAt: stamp,
  }));
  const old = structuredClone(assets[0].versions[0]);
  old.title = "肿瘤诊疗研究进展 · 初版";
  old.createdAt = new Date(Date.now() - 7 * 86400000).toISOString();
  old.changeNote = "初始归档";
  assets[0].versions.unshift(old);
  assets[0].versions[1].number = 2;
  assets[0].versions[1].changeNote = "补充研究证据与封面";
  assets[0].current = 2;
  return {
    schema: 2,
    userId: "u1",
    assets,
    credentials: [
      {
        id: "c1",
        revisions: [structuredClone(demoCredential)],
        createdAt: stamp,
      },
      {
        id: "c2",
        revisions: [structuredClone(makeDemoVersion(5).approval.snapshot!)],
        createdAt: stamp,
      },
      {
        id: "c3",
        revisions: [structuredClone(makeDemoVersion(6).approval.snapshot!)],
        createdAt: stamp,
      },
    ],
    tags: convertLegacyTags([
      {
        id: "t1",
        name: "瑞普泊肽",
        group: "产品 / 品牌",
        synonyms: ["产品示例"],
        enabled: true,
        external: false,
      },
      {
        id: "t2",
        name: "肿瘤产品线",
        group: "产品线",
        synonyms: [],
        enabled: true,
        external: false,
      },
      {
        id: "t3",
        name: "肿瘤",
        group: "疾病领域",
        synonyms: ["肿瘤学"],
        enabled: true,
        external: true,
      },
      {
        id: "t4",
        name: "免疫疾病",
        group: "疾病领域",
        synonyms: ["自免"],
        enabled: true,
        external: true,
      },
      {
        id: "t5",
        name: "临床医生",
        group: "目标受众",
        synonyms: ["医师"],
        enabled: true,
        external: false,
      },
      {
        id: "t6",
        name: "关键研究证据",
        group: "Key Message",
        synonyms: [],
        enabled: true,
        external: false,
      },
      {
        id: "t7",
        name: "资料概览",
        group: "页面类型",
        synonyms: ["概述页"],
        enabled: true,
        external: false,
      },
      {
        id: "t8",
        name: "指南证据",
        group: "证据类型",
        synonyms: ["指南推荐"],
        enabled: true,
        external: true,
      },
      {
        id: "t9",
        name: "临床研究",
        group: "证据类型",
        parent: "t8",
        synonyms: [],
        enabled: true,
        external: false,
      },
      {
        id: "t10",
        name: "历史分类",
        group: "页面类型",
        synonyms: [],
        enabled: false,
        external: false,
      },
      {
        id: "t11",
        name: "医学专家",
        group: "目标受众",
        synonyms: ["研究专家"],
        enabled: true,
        external: false,
      },
    ]),
    suggestions: [
      {
        id: "s1",
        name: "指南更新",
        parentId: primaryTagId("证据类型"),
        contexts: [
          { assetId: "a2", version: 1 },
          { assetId: "a3", version: 1 },
        ],
        mentions: 12,
        assetIds: ["a2", "a3"],
        status: "待处理",
      },
      {
        id: "s2",
        name: "长期随访",
        parentId: primaryTagId("Key Message"),
        contexts: [
          { assetId: "a1", version: 2 },
          { assetId: "a7", version: 1 },
        ],
        mentions: 8,
        assetIds: ["a1", "a7"],
        status: "待处理",
      },
      {
        id: "s3",
        name: "临床实践",
        parentId: primaryTagId("页面类型"),
        contexts: [{ assetId: "a2", version: 1 }],
        mentions: 5,
        assetIds: ["a2"],
        status: "待处理",
      },
    ],
    tasks: [
      ...sampleCollectionTasks(stamp),
      {
        id: "task1",
        name: "研究摘要 · 自动打标",
        type: "解析与打标",
        status: "失败",
        items: [
          {
            assetId: "a3",
            version: 1,
            label: titles[2],
            status: "失败",
            error: "标签识别演示任务失败，可仅重试此项。",
          },
        ],
        createdAt: stamp,
        attempts: 1,
      },
      {
        id: "task2",
        name: "学术网页 · 图片转存",
        type: "解析与打标",
        status: "部分失败",
        items: [
          {
            assetId: "a5",
            version: 1,
            label: titles[4],
            status: "失败",
            error: "示例文章中 1 张图片获取失败，可重新解析。",
          },
        ],
        createdAt: stamp,
        attempts: 1,
      },
      {
        id: "task3",
        name: "学术交流培训视频 · 转码",
        type: "解析与打标",
        status: "处理中",
        items: [
          { assetId: "a4", version: 1, label: titles[3], status: "处理中" },
        ],
        createdAt: stamp,
        attempts: 1,
        finishAt: Date.now() + 30000,
      },
    ],
    articles: [
      {
        id: "article1",
        sourceUrl: sampleArticleSource({
          id: "article1",
          title: titles[8],
          account: accounts[0],
        }),
        title: titles[8],
        account: accounts[0],
        publishedAt: day(-2),
        checkedAt: stamp,
        status: "成功",
        assetId: "a9",
      },
      {
        id: "article4",
        sourceUrl: sampleArticleSource({
          id: "article4",
          title: titles[9],
          account: accounts[3],
        }),
        title: titles[9],
        account: accounts[3],
        publishedAt: day(-2),
        checkedAt: stamp,
        status: "成功",
        assetId: "a10",
      },
    ],
    users: [
      {
        id: "u1",
        name: "陈莉莉",
        account: "chenlili",
        roleId: "admin",
        createdAt: stamp,
      },
      {
        id: "u2",
        name: "医学内容组",
        account: "medical",
        roleId: "operator",
        createdAt: stamp,
      },
      {
        id: "u3",
        name: "内容运营",
        account: "operator",
        roleId: "operator",
        createdAt: stamp,
      },
    ],
    roles: [
      {
        id: "admin",
        name: "管理员",
        permissions: [
          "upload",
          "edit",
          "publish",
          "exempt",
          "tags",
          "taxonomy",
          "void",
          "export",
          "evidence",
          "admin",
        ],
        menus: [
          "workbench",
          "library",
          "publishing",
          "collection",
          "tags",
          "admin",
        ],
      },
      {
        id: "operator",
        name: "普通用户",
        permissions: ["upload", "edit", "publish", "tags", "export"],
        menus: [
          "workbench",
          "library",
          "publishing",
          "collection",
          "credentials",
          "tags",
        ],
      },
    ],
    audits: [
      {
        id: "log1",
        at: stamp,
        user: "陈莉莉",
        action: "人工确认 OCR 差异",
        object: "APP-DEMO-002",
        detail:
          "填写编号 APP-DEMO-002；识别编号 APP-DEMO-022；人工核对确认。原始识别结果保留。",
        category: "审批校验",
      },
      {
        id: "log2",
        at: stamp,
        user: "医学内容组",
        action: "归档内容",
        object: "CMS-00008",
        detail: "免登记审批信息；未设置有效期。",
        category: "内容",
      },
    ],
    notices: [
      {
        id: "n1",
        title: "2 份采集内容需要补充审批信息",
        detail: "选择审批凭证或由有权限的人员选择免登记。",
        route: "library?approval=pending",
        read: false,
        at: stamp,
      },
      {
        id: "n2",
        title: "指南解读有标签未匹配",
        detail: "第 2 页的标签建议需要核对。",
        route: "content/a2?tab=tags",
        read: false,
        at: stamp,
      },
      {
        id: "n3",
        title: "审批编号存在 OCR 差异",
        detail: "APP-DEMO-002 已人工确认，原始差异仍保留。",
        route: "content/a6?tab=approval",
        read: false,
        at: stamp,
        adminOnly: true,
      },
    ],
  };
}
