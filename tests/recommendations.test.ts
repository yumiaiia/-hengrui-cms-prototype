import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { current, primaryTagId } from "../src/model";
import { prepareWorkspace } from "../src/workflow";
import {
  prepareRecommendations,
  ignoreRecommendation,
} from "../src/recommendations";
import {
  acceptSuggestedTag,
  pendingRecommendationsForVersion,
  recommendationSources,
} from "../src/taxonomy";
const setup = () => prepareRecommendations(prepareWorkspace(seedState()));
describe("推荐标签来源与采纳", () => {
  it("来源区分材料和具体页面，并绑定生成时的版本", () => {
    const s = setup();
    const r = s.suggestions.find(
      (r) => r.id === "recommendation-page-example",
    )!;
    const sources = recommendationSources(r, s.assets, s.tags);
    expect(sources.map((c) => c.page)).toEqual([undefined, 2, 3]);
    expect(sources.every((c) => c.versionNumber === 2 && !c.issue)).toBe(true);
    const a = s.assets.find((a) => a.id === "demo-page-linkage")!;
    a.versions.push({ ...structuredClone(current(a)), number: 3 });
    a.current = 3;
    expect(
      recommendationSources(r, s.assets, s.tags).every(
        (c) => c.version?.number === 2,
      ),
    ).toBe(true);
    expect(pendingRecommendationsForVersion(s, a)).toEqual([]);
  });
  it("采纳某一页只绑定该页，其他来源保持待处理，材料状态不提前完成", () => {
    const s = setup();
    const a = s.assets.find((a) => a.id === "demo-page-linkage")!;
    const r = s.suggestions.find(
      (r) => r.id === "recommendation-page-example",
    )!;
    const id = acceptSuggestedTag(s, r.id, a.id, 2, r.parentId, 2);
    expect(current(a).tags.filter((b) => b.tagId === id)).toEqual([
      { tagId: id, origin: "人工", page: 2 },
    ]);
    expect(current(a).tagStatus).toBe("未匹配");
    expect(
      recommendationSources(r, s.assets, s.tags).map((c) => c.accepted),
    ).toEqual([false, true, false]);
    expect(
      pendingRecommendationsForVersion(s, a).some((x) => x.id === r.id),
    ).toBe(true);
    acceptSuggestedTag(s, r.id, a.id, 2, r.parentId);
    acceptSuggestedTag(s, r.id, a.id, 2, r.parentId, 3);
    expect(current(a).tagStatus).toBe("已完成");
    expect(r.status).toBe("已采纳");
  });
  it("忽略后保留已采纳标签与来源，不改变其他内容", () => {
    const s = setup();
    const a = s.assets.find((a) => a.id === "demo-page-linkage")!;
    const r = s.suggestions.find(
      (r) => r.id === "recommendation-page-example",
    )!;
    const id = acceptSuggestedTag(s, r.id, a.id, 2, r.parentId, 2);
    const others = structuredClone(s.assets.filter((x) => x.id !== a.id));
    ignoreRecommendation(s, r.id);
    expect(current(a).tags.some((b) => b.tagId === id && b.page === 2)).toBe(
      true,
    );
    expect(recommendationSources(r, s.assets, s.tags)).toHaveLength(3);
    expect(pendingRecommendationsForVersion(s, a)).toHaveLength(0);
    expect(s.assets.filter((x) => x.id !== a.id)).toEqual(others);
    expect(() => acceptSuggestedTag(s, r.id, a.id, 2, r.parentId, 3)).toThrow(
      "不属于",
    );
  });
  it("页码越界、版本缺失时保留来源记录并提示不可预览", () => {
    const s = setup();
    const r = s.suggestions[0];
    r.contexts = [
      { assetId: "demo-page-linkage", version: 2, page: 999 },
      { assetId: "missing", version: 5 },
    ];
    const sources = recommendationSources(r, s.assets, s.tags);
    expect(sources.map((c) => c.issue)).toEqual([
      "来源页码已不可用",
      "来源版本已不可用",
    ]);
    expect(sources[1].versionNumber).toBe(5);
  });
  it("旧推荐无显式版本时仅迁移一次，不随着后来版本移动", () => {
    const s = prepareWorkspace(seedState());
    const r = s.suggestions[0];
    delete r.contexts;
    const prepared = prepareRecommendations(s);
    expect(prepared.suggestions[0].contexts).toBeDefined();
    expect(prepareRecommendations(prepared)).toBe(prepared);
  });
});
