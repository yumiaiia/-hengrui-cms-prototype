import { describe, it, expect } from "vitest";
import { referenceDimensions } from "../src/referenceTags";
import { seedState } from "../src/seed";
import { current, type State } from "../src/model";
import { prepareWorkspace } from "../src/workflow";
import {
  releaseInput,
  saveReleaseBatch,
  publicationVersionNotice,
} from "../src/publication";
const future = () => new Date(Date.now() + 86400000).toISOString();
function workspace() {
  const s = prepareWorkspace(seedState());
  const a = s.assets.find((a) => a.id === "demo-page-linkage")!;
  const b = structuredClone(a);
  b.id = "batch-second";
  b.code = "CMS-09999";
  s.assets.push(b);
  return { s, a, b };
}
describe("批量发布与版本快照", () => {
  it("每份内容生成独立记录，带入不同的封面与缩略图", () => {
    const { s, a, b } = workspace();
    const ids = saveReleaseBatch(
      s,
      [releaseInput(a), releaseInput(b)],
      future(),
      true,
    );
    expect(new Set(ids).size).toBe(2);
    expect(s.publications?.find((p) => p.id === ids[0])?.thumbnail).toBe(
      current(a).thumbnail,
    );
    expect(s.publications?.find((p) => p.id === ids[0])?.cover).not.toBe(
      current(a).thumbnail,
    );
  });
  it("一份内容缺少图片时整批不提交，补默认图片后可提交", () => {
    const { s, a, b } = workspace();
    const count = s.publications!.length;
    const inputs = [
      releaseInput(a),
      { ...releaseInput(b), cover: "", thumbnail: "" },
    ];
    expect(() => saveReleaseBatch(s, inputs, future(), true)).toThrow(
      "选择默认图片",
    );
    expect(s.publications).toHaveLength(count);
    inputs[1].cover = "/samples/cover-1.svg";
    inputs[1].thumbnail = inputs[1].cover;
    expect(saveReleaseBatch(s, inputs, future(), true)).toHaveLength(2);
  });
  it("内容更新不改变历史发布快照、预览与状态，新发布另建记录", () => {
    const { s, a } = workspace();
    const old = s.publications!.find(
      (p) => p.id === "publication-version-example",
    )!;
    const saved = structuredClone(old);
    const id = saveReleaseBatch(
      s,
      [releaseInput(a)],
      future(),
      true,
      undefined,
      old.id,
    )[0];
    current(a).content[0] = "再次修改正文";
    current(a).tags = [];
    expect(old).toEqual(saved);
    expect(
      s.publications!.find((p) => p.id === id)?.snapshot?.content[0],
    ).not.toBe("再次修改正文");
    expect(s.publications!.find((p) => p.id === id)?.replacesId).toBe(old.id);
    expect(publicationVersionNotice(old, a.current)).toContain("另建发布记录");
  });
  it("禁止覆盖已提交记录，陈旧选择必须重新核对", () => {
    const { s, a } = workspace();
    expect(() =>
      saveReleaseBatch(
        s,
        [releaseInput(a)],
        future(),
        true,
        "publication-version-example",
      ),
    ).toThrow("仅可编辑");
    const input = releaseInput(a);
    a.current = 1;
    expect(() => saveReleaseBatch(s, [input], future(), true)).toThrow(
      "已有新版本",
    );
  });
  it("草稿可补全，提交后锁定快照", () => {
    const { s, a } = workspace();
    const id = saveReleaseBatch(
      s,
      [{ ...releaseInput(a), cover: "" }],
      "",
      false,
    )[0];
    const p = s.publications!.find((p) => p.id === id)!;
    expect(p.snapshot).toBeUndefined();
    expect(p.status).toBe("草稿");
    saveReleaseBatch(s, [releaseInput(a)], future(), true, id);
    expect(p.status).toBe("待发布");
    expect(p.snapshot?.number).toBe(2);
  });
  it("CSV 维度与字段已导入，联动示例每页标签不同", () => {
    const { s, a } = workspace();
    expect(s.tags.filter((t) => !t.parentId).map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "内容类型",
        "内容形式",
        "内容主题",
        "产品",
        "疾病领域",
        "药物分类",
        "治疗方案",
        "推广性质",
        "用户可见范围",
        "内容渠道",
      ]),
    );
    for (const dimension of referenceDimensions) {
      const parent = s.tags.find(
        (t) => t.name === dimension.name && !t.parentId,
      )!;
      expect(
        s.tags.filter((t) => t.parentId === parent.id).map((t) => t.name),
      ).toEqual(
        expect.arrayContaining(
          dimension.values.map((v) => (typeof v === "string" ? v : v.name)),
        ),
      );
    }
    const v = current(a);
    expect(v.tags.filter((b) => b.page === 1).map((b) => b.tagId)).not.toEqual(
      v.tags.filter((b) => b.page === 2).map((b) => b.tagId),
    );
    expect(prepareWorkspace(s)).toBe(s);
  });
});
