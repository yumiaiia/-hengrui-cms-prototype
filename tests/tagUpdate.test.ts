import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { prepareAdministration } from "../src/administration";
import { current, type Tag } from "../src/model";
import {
  startTagMatching,
  advanceTagMatching,
  matchingResult,
} from "../src/tagMatching";
import {
  activeItem,
  advanceUploads,
  archiveStaged,
  cancelStaged,
  confirmStaged,
  patchStaged,
  resolveStagedRecommendation,
  retryStaged,
  startUploadBatch,
} from "../src/uploadReview";
import { excludeTag, stampBinding } from "../src/tagResults";
import { setRecommendationCancelled } from "../src/recommendations";
import {
  pendingSuggestions,
  pendingRecommendationsForVersion,
} from "../src/taxonomy";
import { appendAudit } from "../src/audit";
const setup = () => {
  const s = prepareAdministration(prepareWorkspace(seedState()));
  s.userId = "u1";
  s.tags = [
    {
      id: "root",
      name: "疾病",
      parentId: null,
      enabled: true,
      external: false,
    },
    ...["旧词", "正文", "人工词", "停用词"].map((name, i): Tag => ({
      id: `t${i}`,
      name,
      parentId: "root",
      enabled: i !== 3,
      external: false,
    })),
  ];
  const a = s.assets[0];
  const v = current(a);
  v.title = "匹配验收";
  v.summary = "";
  v.content = ["正文", "正文与其他内容"];
  v.pages = 2;
  v.kind = "PDF";
  v.process = "完成";
  v.pageStates = { 1: { status: "完成" }, 2: { status: "完成" } };
  v.approval = { mode: "exempt" };
  v.tags = [
    { tagId: "t0", origin: "AI" },
    { tagId: "t2", origin: "人工" },
    { tagId: "t3", origin: "AI", page: 1 },
  ].map((b) => stampBinding(b as (typeof v.tags)[number], s.tags));
  s.suggestions = [];
  s.tasks = [];
  s.uploadBatches = [];
  return { s, a, v };
};
const match = (s: ReturnType<typeof setup>["s"], id: string) => {
  const taskId = startTagMatching(s, [id]);
  const task = s.tasks.find((t) => t.id === taskId)!;
  for (let i = 0; task.status === "处理中" && i < 50; i++)
    advanceTagMatching(s, task);
  return s.uploadBatches!.find((b) => b.id === task.batchId)!;
};
describe("标签更新结果与确认", () => {
  it("文件产生新版本后重新匹配，不把旧版本的推荐或取消决定带到新版本", () => {
    const { s, a, v } = setup();
    s.suggestions = [
      {
        id: "old-rec",
        name: "旧版独有推荐",
        parentId: "root",
        mentions: 1,
        assetIds: [a.id],
        contexts: [{ assetId: a.id, version: a.current, page: 1 }],
        status: "待处理",
      },
    ];
    const b = match(s, a.id),
      i = b.items[0];
    expect(i.recommendations).toHaveLength(1);
    const oldVersion = a.current;
    a.current++;
    a.versions.push({ ...structuredClone(v), number: a.current });
    retryStaged(s, b.id, i.id);
    advanceTagMatching(s, s.tasks[0]);
    expect(i.baseVersion).toBe(a.current);
    expect(i.recommendations).toHaveLength(0);
    expect(s.suggestions[0].contexts?.[0].version).toBe(oldVersion);
  });
  it("计算完成只暂存完整结果，确认归档后创建新版本并写入新标签", () => {
    const { s, a, v } = setup();
    const before = structuredClone(v),
      versions = a.versions.length,
      pubs = structuredClone(s.publications);
    const b = match(s, a.id),
      i = b.items[0];
    expect(v).toEqual(before);
    expect(i.v.tags.map((t) => t.tagId)).toContain("t0");
    expect(i.v.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagId: "t1", page: 1 }),
        expect.objectContaining({ tagId: "t1", page: 2 }),
        expect.objectContaining({ tagId: "t2", origin: "人工" }),
        expect.objectContaining({ tagId: "t3", page: 1 }),
      ]),
    );
    confirmStaged(s, b.id, i.id);
    expect(v).toEqual(before);
    expect(archiveStaged(s, b.id, [i.id])).toEqual({ success: 1, failed: 0 });
    expect(a.versions).toHaveLength(versions + 1);
    const next = current(a);
    expect(next.number).toBe(before.number + 1);
    expect(next.tags).toEqual(i.v.tags);
    expect(next.fileKey).toBe(before.fileKey);
    expect(next.approval).toEqual(before.approval);
    expect(next.cover).toBe(before.cover);
    expect(v).toEqual(before);
    expect(s.publications).toEqual(pubs);
    expect(archiveStaged(s, b.id, [i.id])).toEqual({ success: 0, failed: 0 });
  });
  it("分类停用时所有旧绑定保留，新增停用标签不产生绑定", () => {
    const { s, v } = setup();
    s.tags[0].enabled = false;
    const r = matchingResult(v, s.tags).tags;
    expect(r).toEqual(v.tags);
    expect(r.some((x) => x.tagId === "t1")).toBe(false);
  });
  it("标签改名后原有自动和人工绑定保留，未绑定位置按新值补充", () => {
    const { s, v } = setup();
    s.tags.find((t) => t.id === "t0")!.name = "正文";
    s.tags.find((t) => t.id === "t2")!.name = "新的人工标签";
    const r = matchingResult(v, s.tags).tags;
    expect(r).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagId: "t0", name: "正文", origin: "AI" }),
        expect.objectContaining({ tagId: "t0", name: "正文", page: 2 }),
        expect.objectContaining({
          tagId: "t2",
          name: "新的人工标签",
          origin: "人工",
        }),
      ]),
    );
    expect(v.tags.find((t) => t.tagId === "t0")!.name).toBe("旧词");
  });
  it("改名后不再命中的自动绑定仍保留，同一位置不重复添加", () => {
    const { s, v } = setup();
    s.tags.find((t) => t.id === "t0")!.name = "不在正文中的新名称";
    v.tags.push(stampBinding({ tagId: "t1", origin: "人工", page: 1 }, s.tags));
    const original = structuredClone(v);
    const r = matchingResult(v, s.tags).tags;
    expect(r).toContainEqual({
      tagId: "t0",
      origin: "AI",
      name: "不在正文中的新名称",
      parentId: "root",
    });
    expect(r.filter((b) => b.tagId === "t1" && b.page === 1)).toHaveLength(1);
    expect(r.find((b) => b.tagId === "t1" && b.page === 1)?.origin).toBe(
      "人工",
    );
    expect(r.some((b) => b.tagId === "t1" && b.page === 2)).toBe(true);
    expect(matchingResult({ ...v, tags: r }, s.tags).tags).toEqual(r);
    expect(v).toEqual(original);
  });
  it("新增启用标签参与补充，新增停用标签不添加", () => {
    const { s, v } = setup();
    s.tags.push(
      {
        id: "new-active",
        name: "其他内容",
        parentId: "root",
        enabled: true,
        external: false,
      },
      {
        id: "new-disabled",
        name: "正文",
        parentId: "root",
        enabled: false,
        external: false,
      },
    );
    const r = matchingResult(v, s.tags).tags;
    expect(r.some((b) => b.tagId === "new-active" && b.page === 2)).toBe(true);
    expect(r.some((b) => b.tagId === "new-disabled")).toBe(false);
    expect(r).toEqual(expect.arrayContaining(v.tags));
  });
  it("重新启用时仅补充未绑定位置，分类停用时仍不新增", () => {
    const { s, v } = setup();
    const tag = s.tags.find((t) => t.id === "t3")!;
    tag.name = "正文";
    const disabled = matchingResult(v, s.tags).tags;
    expect(disabled.filter((b) => b.tagId === tag.id)).toHaveLength(1);
    tag.enabled = true;
    const enabled = matchingResult(v, s.tags).tags;
    expect(
      enabled.filter((b) => b.tagId === tag.id && b.page === 1),
    ).toHaveLength(1);
    expect(enabled.some((b) => b.tagId === tag.id && b.page === 2)).toBe(true);
    s.tags[0].enabled = false;
    const inactiveParent = matchingResult(v, s.tags).tags;
    expect(inactiveParent.filter((b) => b.tagId === tag.id)).toHaveLength(1);
  });
  it("分类变更按最新分类展示，启用后恢复计算但不抹去人工排除", () => {
    const { s, v } = setup();
    s.tags.push({
      id: "r2",
      name: "新分类",
      parentId: null,
      enabled: true,
      external: false,
    });
    const t = s.tags.find((t) => t.id === "t1")!;
    t.parentId = "r2";
    expect(matchingResult(v, s.tags).tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagId: t.id, parentId: "r2" }),
      ]),
    );
    excludeTag(v, { name: t.name, parentId: t.parentId }, 1);
    t.enabled = false;
    t.enabled = true;
    const r = matchingResult(v, s.tags).tags;
    expect(r.some((x) => x.tagId === t.id && x.page === 1)).toBe(false);
    expect(r.some((x) => x.tagId === t.id && x.page === 2)).toBe(true);
  });
  it("仅对外展示变化不会使待确认结果失效", () => {
    const { s, a } = setup();
    const b = match(s, a.id),
      i = b.items[0];
    s.tags[1].external = true;
    confirmStaged(s, b.id, i.id);
    expect(archiveStaged(s, b.id, [i.id]).success).toBe(1);
  });
  it("确认后再修改标签结果须重新确认，人工移除在归档新版本中生效", () => {
    const { s, a, v } = setup();
    const b = match(s, a.id),
      i = b.items[0];
    confirmStaged(s, b.id, i.id);
    patchStaged(s, b.id, i.id, {
      tags: i.v.tags.filter((x) => !(x.tagId === "t1" && x.page === 1)),
    });
    expect(i.confirmedRevision).toBeUndefined();
    expect(archiveStaged(s, b.id, [i.id]).success).toBe(0);
    confirmStaged(s, b.id, i.id);
    archiveStaged(s, b.id, [i.id]);
    const next = current(a);
    expect(next.number).toBe(v.number + 1);
    expect(
      matchingResult(next, s.tags).tags.some((x) => x.tagId === "t1" && x.page === 1),
    ).toBe(false);
    expect(
      matchingResult(next, s.tags).tags.some((x) => x.tagId === "t1" && x.page === 2),
    ).toBe(true);
  });
  it("正式标签在确认后被编辑时拒绝旧结果，重新匹配后可继续", () => {
    const { s, a, v } = setup();
    const b = match(s, a.id),
      i = b.items[0];
    confirmStaged(s, b.id, i.id);
    v.summary = "他人更新摘要";
    const newest = structuredClone(v);
    expect(archiveStaged(s, b.id, [i.id])).toEqual({ success: 0, failed: 1 });
    expect(v).toEqual(newest);
    retryStaged(s, b.id, i.id);
    const task = s.tasks[0];
    advanceTagMatching(s, task);
    expect(i.confirmedRevision).toBeUndefined();
    confirmStaged(s, b.id, i.id);
    expect(archiveStaged(s, b.id, [i.id]).success).toBe(1);
  });
  it("标签改名或停用后仍可确认归档，元数据保持只读，原版本不受影响", () => {
    const { s, a, v } = setup();
    const b = match(s, a.id),
      i = b.items[0];
    const original = structuredClone(v);
    s.tags[1].name = "新值";
    expect(() => patchStaged(s, b.id, i.id, { title: "违规修改" })).toThrow(
      "仅允许维护标签",
    );
    confirmStaged(s, b.id, i.id);
    expect(archiveStaged(s, b.id, [i.id]).success).toBe(1);
    expect(v).toEqual(original);
  });
  it("无标签结果可直接确认，失败结果仍然阻止确认", () => {
    const { s, a, v } = setup();
    v.tags = [];
    v.content = ["完全不同内容"];
    v.pages = 1;
    v.pageStates = { 1: { status: "完成" } };
    const b = match(s, a.id),
      i = b.items[0];
    expect(i.noApplicableTags).toBeUndefined();
    expect(() => confirmStaged(s, b.id, i.id)).not.toThrow();
    i.v.process = "失败";
    expect(() => confirmStaged(s, b.id, i.id)).toThrow("文件解析");
  });
  it("同步仅处理明确选中的文件，失效选项不会被静默缩小或扩大范围", () => {
    const { s, a } = setup();
    expect(() => startTagMatching(s, [a.id, "missing-file"])).toThrow(
      "状态已变化",
    );
    expect(s.uploadBatches).toHaveLength(0);
    const id = startTagMatching(s, [a.id]);
    expect(
      s.tasks.find((t) => t.id === id)?.items.map((i) => i.assetId),
    ).toEqual([a.id]);
  });
  it("未处理推荐不阻止标签更新，更新后仍可从正式内容处理", () => {
    const { s, a } = setup();
    s.suggestions = [
      {
        id: "pending-rec",
        name: "尚未处理推荐",
        parentId: "root",
        mentions: 1,
        assetIds: [a.id],
        contexts: [{ assetId: a.id, version: a.current, page: 1 }],
        status: "待处理",
      },
    ];
    const b = match(s, a.id),
      i = b.items[0];
    expect(i.recommendations?.[0].resolved).toBeUndefined();
    confirmStaged(s, b.id, i.id);
    expect(archiveStaged(s, b.id, [i.id]).success).toBe(1);
    expect(pendingRecommendationsForVersion(s, a).map((r) => r.id)).toEqual([
      "pending-rec",
    ]);
    expect(current(a).tagStatus).toBe("未匹配");
  });
});
describe("取消批次与推荐", () => {
  it("空标签且有未处理推荐仍可归档，推荐按归档版本及页码保留且不自动入库", () => {
    const { s, v } = setup();
    const tagCount = s.tags.length;
    const id = startUploadBatch(
      s,
      [
        {
          id: "empty-tags",
          v: {
            ...v,
            fileKey: "empty-file",
            fileHash: "empty-new-hash",
            title: "空标签文件",
            summary: "",
            tags: [],
            content: ["无任何匹配项"],
            pages: 1,
          },
          recommendations: [
            { id: "pending", name: "尚未处理推荐", parentId: "root", page: 1 },
          ],
        },
      ],
      { mode: "exempt" },
    );
    advanceUploads(s, Date.now() + 60000, id);
    const i = s.uploadBatches![0].items[0];
    expect(i.v.tags).toHaveLength(0);
    expect(i.noApplicableTags).toBeUndefined();
    confirmStaged(s, id, i.id);
    expect(archiveStaged(s, id, [i.id])).toEqual({ success: 1, failed: 0 });
    const asset = s.assets.find((a) => a.id === i.archived!.assetId)!;
    expect(current(asset).tags).toHaveLength(0);
    expect(pendingSuggestions(s, asset, asset.current, 1)).toHaveLength(1);
    expect(pendingSuggestions(s, asset, asset.current)).toHaveLength(0);
    expect(s.tags).toHaveLength(tagCount);
    archiveStaged(s, id, [i.id]);
    expect(
      pendingSuggestions(s, asset, asset.current, 1)[0].contexts,
    ).toHaveLength(1);
  });
  it("解析期间取消单份，后台返回不恢复；同批其余项可继续归档", () => {
    const { s, v } = setup();
    const source = structuredClone(v);
    source.fileKey = "local-demo";
    source.fileHash = "one";
    const id = startUploadBatch(
      s,
      [
        { id: "one", v: source },
        { id: "two", v: { ...source, fileHash: "two" } },
      ],
      { mode: "exempt" },
    );
    cancelStaged(s, id, ["one"]);
    advanceUploads(s, Date.now() + 60000, id);
    const b = s.uploadBatches![0],
      one = b.items[0],
      two = b.items[1];
    expect(one.cancelled).toBeDefined();
    expect(one.v.process).toBe("处理中");
    expect(() => confirmStaged(s, id, one.id)).toThrow("已结束");
    expect(two.v.process).toBe("完成");
    confirmStaged(s, id, two.id);
    archiveStaged(s, id, [two.id]);
    expect(cancelStaged(s, id, ["one", "two"])).toBe(0);
    expect(two.archived).toBeDefined();
    expect(b.items.some(activeItem)).toBe(false);
  });
  it("取消标签更新保留原文件且后续任务不能写回，可再次发起", () => {
    const { s, a, v } = setup(),
      original = structuredClone(v);
    const id = startTagMatching(s, [a.id]),
      b = s.uploadBatches![0];
    cancelStaged(
      s,
      b.id,
      b.items.map((i) => i.id),
    );
    advanceTagMatching(
      s,
      s.tasks.find((t) => t.id === id)!,
    );
    expect(v).toEqual(original);
    expect(() => startTagMatching(s, [a.id])).not.toThrow();
    s.userId = "u3";
    expect(() =>
      cancelStaged(
        s,
        b.id,
        b.items.map((i) => i.id),
      ),
    ).toThrow();
  });
  it("取消推荐按来源独立并可恢复，不撤回已采纳标签，重跑不补回", () => {
    const { s, a, v } = setup();
    s.suggestions = [
      {
        id: "r",
        name: "正文",
        parentId: "root",
        mentions: 2,
        assetIds: [a.id],
        contexts: [
          { assetId: a.id, version: a.current, page: 1 },
          { assetId: a.id, version: a.current, page: 2 },
        ],
        status: "待处理",
      },
    ];
    const c = { assetId: a.id, version: a.current, page: 1 };
    setRecommendationCancelled(s, "r", true, c);
    expect(pendingSuggestions(s, a, a.current, 1)).toHaveLength(0);
    expect(pendingSuggestions(s, a, a.current, 2)).toHaveLength(1);
    expect(
      matchingResult(v, s.tags).tags.some((b) => b.tagId === "t1" && b.page === 1),
    ).toBe(false);
    setRecommendationCancelled(s, "r", false, c);
    expect(pendingSuggestions(s, a, a.current, 1)).toHaveLength(1);
    expect(
      matchingResult(v, s.tags).tags.some((b) => b.tagId === "t1" && b.page === 1),
    ).toBe(true);
  });
  it("待归档取消推荐不删除字典，取消操作保留一条简短用户审计", () => {
    const { s, v } = setup();
    const id = startUploadBatch(
      s,
      [
        {
          id: "one",
          v: { ...v, fileKey: "demo", fileHash: "new" },
          recommendations: [{ id: "rec", name: "建议词", parentId: "root" }],
        },
      ],
      { mode: "exempt" },
    );
    advanceUploads(s, Date.now() + 60000, id);
    const count = s.tags.length;
    resolveStagedRecommendation(s, id, "one", "rec");
    expect(s.tags).toHaveLength(count);
    expect(s.uploadBatches![0].items[0].recommendations![0].cancelled).toBe(
      true,
    );
    const logs = s.audits.length;
    appendAudit(s, {
      action: "取消推荐标签",
      object: "建议词",
      module: "内容库",
    });
    expect(s.audits.length).toBe(logs + 1);
    expect(s.audits[0].detail).toBe("");
  });
});
