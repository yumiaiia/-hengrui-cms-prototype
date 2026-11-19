import { describe, expect, it } from "vitest";
import { seedState } from "../src/seed";
import { current, type Approval, type Asset } from "../src/model";
import { prepareWorkspace } from "../src/workflow";
import {
  appendUploadVersions,
  planUploadVersions,
  type UploadInput,
} from "../src/upload";

function setup() {
  const s = prepareWorkspace(seedState());
  const a = s.assets.find((a) => a.id === "demo-page-linkage")!;
  current(a).fileHash = "identical-pdf";
  const upload = (id = "one", hash = "identical-pdf"): UploadInput => ({
    id,
    v: {
      ...structuredClone(current(a)),
      number: 1,
      title: "本次上传标题",
      fileHash: hash,
      cover: undefined,
      thumbnail: undefined,
    },
  });
  const oldApproval = current(a).approval;
  const approval: Approval = {
    mode: "registered",
    credentialId: "latest-approval",
    snapshot: {
      revision: 1,
      number: "NEW-2026-001",
      title: "新审批",
      expiry: "2027-12-31",
      evidence: [
        {
          id: "new-evidence",
          name: "新审批截图.png",
          number: "NEW-2026-001",
          title: "新审批",
          expiry: "2027-12-31",
          status: "一致",
        },
      ],
      confirmed: true,
      updatedAt: new Date().toISOString(),
    },
  };
  return { s, a, upload, approval, oldApproval };
}

describe("重复上传自动创建内容版本", () => {
  it("相同文件归入原内容，使用本次审批信息并保留历史与已提交发布快照", () => {
    const { s, a, upload, approval } = setup();
    const count = s.assets.length;
    const history = structuredClone(a.versions);
    const publications = structuredClone(s.publications);
    const input = upload();
    const plan = planUploadVersions(s.assets, [input]);
    const items = appendUploadVersions(s, [input], plan, approval, "u1");
    expect(s.assets).toHaveLength(count);
    expect(plan[0]).toMatchObject({
      assetId: a.id,
      number: 3,
      newAsset: false,
    });
    expect(a.current).toBe(3);
    expect(current(a).approval.snapshot?.number).toBe("NEW-2026-001");
    expect(current(a).approval.snapshot?.evidence[0].id).toBe("new-evidence");
    expect(a.versions.slice(0, -1)).toEqual(history);
    expect(s.publications).toEqual(publications);
    expect(items[0]).toMatchObject({ assetId: a.id, version: 3 });
    approval.snapshot!.number = "不应改变已存快照";
    expect(current(a).approval.snapshot?.number).toBe("NEW-2026-001");
    expect(current(a).cover).toBe(history.at(-1)?.cover);
  });
  it("命中历史版本也追加至最大版本号，不回退或替换原版本", () => {
    const { s, a, upload, approval } = setup();
    a.versions[0].fileHash = "historical-file";
    const later = structuredClone(current(a));
    later.number = 7;
    a.versions.push(later);
    a.current = 7;
    const input = upload("old-file", "historical-file");
    const plan = planUploadVersions(s.assets, [input]);
    appendUploadVersions(s, [input], plan, approval, "u1");
    expect(a.current).toBe(8);
    expect(a.versions).toHaveLength(4);
  });
  it("同批相同文件生成连续版本，不同文件各建一份内容", () => {
    const { s, upload, approval } = setup();
    const count = s.assets.length;
    const inputs = [
      upload("a", "new-hash"),
      upload("b", "new-hash"),
      upload("c", "other-hash"),
    ];
    const plan = planUploadVersions(s.assets, inputs);
    appendUploadVersions(s, inputs, plan, approval, "u1");
    expect(s.assets).toHaveLength(count + 2);
    expect(plan[0].assetId).toBe(plan[1].assetId);
    expect(plan.map((t) => t.number)).toEqual([1, 2, 1]);
    const a = s.assets.find((a) => a.id === plan[0].assetId)!;
    expect(a.versions).toHaveLength(2);
    expect(a.current).toBe(2);
  });
  it("同批连续重复已存在文件时，每项都归入同一内容并使用本次审批", () => {
    const { s, a, upload, approval } = setup();
    const inputs = [upload("a"), upload("b")];
    const plan = planUploadVersions(s.assets, inputs);
    appendUploadVersions(s, inputs, plan, approval, "u1");
    expect(plan.map((t) => t.assetId)).toEqual([a.id, a.id]);
    expect(a.current).toBe(4);
    expect(
      a.versions.slice(-2).map((v) => v.approval.snapshot?.number),
    ).toEqual(["NEW-2026-001", "NEW-2026-001"]);
  });
  it("相同公开链接创建版本；无文件摘要或来源链接时不凭标题合并", () => {
    const { s, a, upload } = setup();
    current(a).sourceUrl = "https://example.com/article";
    const link = upload();
    link.v.fileHash = undefined;
    link.v.sourceUrl = current(a).sourceUrl;
    expect(planUploadVersions(s.assets, [link])[0].assetId).toBe(a.id);
    link.v.sourceUrl = undefined;
    expect(planUploadVersions(s.assets, [link])[0].newAsset).toBe(true);
  });
  it("仅匹配可见正常内容；指定上传版本的目标保持不变", () => {
    const { s, a, upload } = setup();
    expect(planUploadVersions([], [upload()])[0].newAsset).toBe(true);
    a.lifecycle = "已作废";
    expect(planUploadVersions([a], [upload()])[0].newAsset).toBe(true);
    expect(() => planUploadVersions([a], [upload()], a.id)).toThrow("不可更新");
    const b: Asset = structuredClone(a);
    b.id = "other";
    b.lifecycle = "正常";
    a.lifecycle = "正常";
    expect(planUploadVersions([a, b], [upload()], b.id)[0].assetId).toBe(b.id);
    expect(planUploadVersions(s.assets, [], a.id)).toEqual([]);
  });
});
