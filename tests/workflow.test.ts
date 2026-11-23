import { describe, it, expect } from "vitest";
import { current, type Tag } from "../src/model";
import { seedState } from "../src/seed";
import {
  pageHits,
  prepareWorkspace,
  publicationProblems,
} from "../src/workflow";
import { fileParsingFailed } from "../src/fileProcessing";
const tags: Tag[] = [
  { id: "d", name: "疾病", parentId: null, enabled: true, external: false },
  { id: "p", name: "页面类型", parentId: null, enabled: true, external: false },
  { id: "d1", name: "肿瘤", parentId: "d", enabled: true, external: false },
  { id: "d2", name: "自免", parentId: "d", enabled: true, external: false },
  { id: "p1", name: "研究", parentId: "p", enabled: true, external: false },
];
function asset() {
  const a = structuredClone(seedState().assets[0]);
  const v = current(a);
  v.process = "完成";
  v.kind = "PDF";
  v.pages = 3;
  v.tags = [
    { tagId: "d1", origin: "人工" },
    { tagId: "d1", origin: "AI", page: 1 },
    { tagId: "p1", origin: "AI", page: 2 },
  ];
  return a;
}
describe("页级标签检索", () => {
  it("不同类别必须命中同一页，不能跨页拼出匹配", () => {
    const a = asset();
    expect(pageHits([a], tags, [], ["d1", "p1"])).toHaveLength(0);
    current(a).tags.push({ tagId: "p1", origin: "人工", page: 1 });
    expect(pageHits([a], tags, [], ["d1", "p1"]).map((h) => h.page)).toEqual([
      1,
    ]);
  });
  it("材料标签与页面标签分别匹配，同类标签满足任一个", () => {
    const a = asset();
    expect(pageHits([a], tags, ["d1"], ["p1"]).map((h) => h.page)).toEqual([2]);
    expect(pageHits([a], tags, ["d2"], ["p1"])).toHaveLength(0);
    expect(pageHits([a], tags, [], ["d1", "d2"]).map((h) => h.page)).toEqual([
      1,
    ]);
  });
  it("解析失败的文件不进入页级索引", () => {
    const a = asset();
    current(a).process = "失败";
    expect(pageHits([a], tags, [], [])).toEqual([]);
  });
  it("文字查询定位到对应页面", () => {
    const a = asset();
    current(a).content = ["背景", "独特研究结果", "结语"];
    expect(pageHits([a], tags, [], [], "独特研究").map((h) => h.page)).toEqual([
      2,
    ]);
  });
});
describe("文件解析状态", () => {
  it("旧页面失败统一阻断整份文件的索引和发布", () => {
    const a = asset();
    const v = current(a);
    v.pageStates = { 2: { status: "失败" } };
    expect(fileParsingFailed(v)).toBe(true);
    expect(pageHits([a], tags, [], [])).toEqual([]);
    expect(publicationProblems(a, v)).toContain("请先完成文件解析");
    expect(
      publicationProblems(a, v).some((reason) => reason.includes("页面")),
    ).toBe(false);
  });
  it("OCR 差异已经人工确认时，不阻断发布", () => {
    const a = asset();
    const v = current(a);
    v.approval.snapshot!.confirmed = true;
    v.approval.snapshot!.evidence[0].number = "OTHER";
    v.approval.snapshot!.expiry = "2099-12-31";
    v.tagStatus = "已完成";
    expect(publicationProblems(a, v)).toEqual([]);
  });
  it("已过期的内容需更新有效期", () => {
    const a = asset();
    const v = current(a);
    v.approval.snapshot!.expiry = "2000-01-01";
    expect(publicationProblems(a, v)).toContain("内容已过期，请先更新有效期");
  });
  it("工作区升级保留已有原文件和审批快照，并只初始化一次", () => {
    const s = seedState();
    const before = structuredClone(current(s.assets[0]));
    const next = prepareWorkspace(s);
    expect(
      current(next.assets.find((a) => a.id === s.assets[0].id)!).fileKey,
    ).toEqual(before.fileKey);
    expect(
      current(next.assets.find((a) => a.id === s.assets[0].id)!).fileUrl,
    ).toEqual(before.fileUrl);
    expect(
      current(next.assets.find((a) => a.id === s.assets[0].id)!).approval,
    ).toEqual(before.approval);
    expect(next.publications?.length).toBeGreaterThan(0);
    expect(prepareWorkspace(next)).toBe(next);
  });
});
