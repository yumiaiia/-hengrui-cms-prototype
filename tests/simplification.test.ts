import { describe, expect, it } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { prepareAdministration } from "../src/administration";
import {
  normalizePublicationStatus,
  prepareSimplification,
} from "../src/simplification";
import { current, type PublicationStatus, type Role } from "../src/model";
import { articleSourceUrl } from "../src/collectionSources";
import {
  advanceTagMatching,
  matchableAssets,
  retryTagMatching,
  startTagMatching,
  tagImpact,
  tagUsage,
} from "../src/tagMatching";
import {
  applyTagImport,
  previewTagImport,
  readTagWorkbook,
  writeTagWorkbook,
  type TagImportRow,
} from "../src/tagTransfer";
const setup = () =>
  prepareSimplification(prepareAdministration(prepareWorkspace(seedState())));
const finish = (s: ReturnType<typeof setup>, id: string) => {
  const t = s.tasks.find((t) => t.id === id)!;
  for (let n = 0; t.status === "处理中" && n < 100; n++)
    advanceTagMatching(s, t);
  return t;
};
describe("精简数据迁移", () => {
  it("升级已保存示例的来源链接，不覆盖真实链接、不为用户记录编造地址", () => {
    const s = setup();
    s.simplificationRevision = 1;
    s.articles.forEach((a) => {
      delete a.sourceUrl;
    });
    s.articles[1].sourceUrl = "https://mp.weixin.qq.com/s/existing-source";
    s.articles.push({
      ...s.articles[0],
      id: "user-article",
      title: "用户文章",
    });
    const assets = structuredClone(s.assets),
      roles = structuredClone(s.roles);
    const next = prepareSimplification(s);
    expect(next.articles[0].sourceUrl).toBe("/samples/wechat/article1.html");
    expect(next.articles[1].sourceUrl).toBe(
      "https://mp.weixin.qq.com/s/existing-source",
    );
    expect(next.articles.at(-1)?.sourceUrl).toBeUndefined();
    expect(next.assets).toEqual(assets);
    expect(next.roles).toEqual(roles);
    expect(prepareSimplification(next)).toBe(next);
    expect(
      articleSourceUrl(next.articles[0].sourceUrl, "http://localhost:5180"),
    ).toBe("http://localhost:5180/samples/wechat/article1.html");
  });
  it("合并旧状态并保留预览、版本、原始来源及账号归属，迁移幂等", () => {
    const s = setup();
    delete s.simplificationRevision;
    delete s.articles[0].sourceUrl;
    s.roles.push({ ...s.roles[1], id: "medical", name: "医学部高权限用户" });
    s.users[1].roleId = "medical";
    const custom: Role = {
      id: "custom",
      name: "学术编辑",
      menus: ["library"],
      permissions: ["edit"],
    };
    s.roles.push(custom);
    s.publications![0].status = "状态待确认" as PublicationStatus;
    s.publications![0].previews[0].status = "下游处理中" as PublicationStatus;
    const beforeAssets = structuredClone(s.assets),
      beforeUsers = s.users.map((u) => u.id);
    current(s.assets.find((a) => a.id === s.articles[0].assetId)!).sourceUrl =
      "https://mp.weixin.qq.com/s/known-source";
    beforeAssets.find((a) => a.id === s.articles[0].assetId)!.versions =
      structuredClone(
        s.assets.find((a) => a.id === s.articles[0].assetId)!.versions,
      );
    const next = prepareSimplification(s);
    expect(next.assets).toEqual(beforeAssets);
    expect(next.users.map((u) => u.id)).toEqual(beforeUsers);
    expect(next.users[1].roleId).toBe("operator");
    expect(next.roles).toContainEqual(custom);
    expect(next.publications![0].status).toBe("待发布");
    expect(next.publications![0].error).toBeTruthy();
    expect(next.publications![0].previews[0].status).toBe("待发布");
    expect(next.articles[0].sourceUrl).toBe(
      "https://mp.weixin.qq.com/s/known-source",
    );
    expect(prepareSimplification(next)).toBe(next);
  });
  it("四态映射覆盖旧发布状态", () => {
    expect(
      [
        "草稿",
        "已提交",
        "下游处理中",
        "待发布",
        "已发布",
        "处理失败",
        "状态待确认",
      ].map(normalizePublicationStatus),
    ).toEqual([
      "草稿",
      "待发布",
      "待发布",
      "待发布",
      "已发布",
      "发布失败",
      "待发布",
    ]);
  });
});
describe("增量标签匹配", () => {
  it("匹配异常可重试，恢复后保留已完成项和新增计数", () => {
    const s = setup(),
      a = matchableAssets(s)[0],
      v = current(a);
    const root = s.tags.find((t) => t.parentId === null && t.enabled)!;
    s.tags.push({
      id: "retry-keyword",
      name: "重试词",
      parentId: root.id,
      enabled: true,
      external: false,
    });
    const body = [...v.content];
    v.content = [null as unknown as string];
    const id = startTagMatching(s),
      failed = finish(s, id);
    expect(failed.status).toBe("部分失败");
    expect(failed.items.find((i) => i.assetId === a.id)?.error).toBeTruthy();
    v.content = ["重试词", ...body];
    retryTagMatching(s, id);
    expect(finish(s, id).status).toBe("完成");
    expect(v.tags.some((b) => b.tagId === "retry-keyword")).toBe(true);
    expect(failed.items.filter((i) => i.assetId === a.id)).toHaveLength(1);
  });
  it("材料及页级匹配只追加缺失绑定，不改人工、历史、审批和发布快照", () => {
    const s = setup(),
      a = matchableAssets(s)[0],
      v = current(a);
    const root = s.tags.find((t) => t.parentId === null && t.enabled)!;
    s.tags.push({
      id: "match-test",
      parentId: root.id,
      name: "专用匹配词",
      enabled: true,
      external: false,
    });
    v.content[0] = "包含专用匹配词的正文";
    v.tags.push({ tagId: "manual", origin: "人工" });
    a.versions.push({ ...structuredClone(v), number: 99 });
    const old = structuredClone(a.versions.find((v) => v.number === 99)),
      approval = structuredClone(v.approval),
      pubs = structuredClone(s.publications);
    const done = finish(s, startTagMatching(s));
    expect(done.status).toBe("完成");
    expect(v.tags).toContainEqual({ tagId: "manual", origin: "人工" });
    expect(v.tags).toContainEqual({
      tagId: "match-test",
      origin: "AI",
      page: undefined,
    });
    expect(v.tags).toContainEqual({
      tagId: "match-test",
      origin: "AI",
      page: 1,
    });
    expect(a.versions.find((v) => v.number === 99)).toEqual(old);
    expect(v.approval).toEqual(approval);
    expect(s.publications).toEqual(pubs);
    expect(finish(s, startTagMatching(s)).result?.added).toBe(0);
  });
  it("停用标签、失败页和非当前版本不参与匹配，变更文件跳过只计一次", () => {
    const s = setup(),
      a = matchableAssets(s)[0],
      v = current(a),
      root = s.tags.find((t) => t.parentId === null && t.enabled)!;
    s.tags.push(
      {
        id: "disabled-test",
        name: "专用词",
        parentId: root.id,
        enabled: false,
        external: false,
      },
      {
        id: "page-test",
        name: "专用词",
        parentId: root.id,
        enabled: true,
        external: false,
      },
    );
    v.content[0] = "专用词";
    v.pageStates = { 1: { status: "失败" } };
    const id = startTagMatching(s);
    const other = matchableAssets(s)[1];
    other.lifecycle = "已作废";
    const done = finish(s, id);
    expect(v.tags.some((b) => b.tagId === "disabled-test")).toBe(false);
    expect(v.tags.some((b) => b.tagId === "page-test" && b.page === 1)).toBe(
      false,
    );
    expect(done.items.find((i) => i.assetId === other.id)?.skipped).toBe(true);
    expect(done.result?.skipped).toBe(s.assets.length - done.items.length + 1);
  });
  it("权限和并发受控，失败重试保留成功结果", () => {
    const s = setup(),
      id = startTagMatching(s),
      task = s.tasks.find((t) => t.id === id)!;
    expect(() => startTagMatching(s)).toThrow("正在进行");
    task.items[0].status = "失败";
    task.items[1].status = "完成";
    task.items[1].added = 2;
    task.status = "部分失败";
    retryTagMatching(s, id);
    expect(task.items[0].status).toBe("排队中");
    expect(task.items[1].added).toBe(2);
    s.userId = "u3";
    expect(() => startTagMatching(s)).toThrow("权限");
  });
  it("影响数量覆盖历史版本并按文件去重，分类取子标签并集", () => {
    const s = setup(),
      a = s.assets[0],
      v = current(a),
      tag = s.tags.find((t) => t.parentId)!;
    v.tags = [
      { tagId: tag.id, origin: "人工" },
      { tagId: tag.id, origin: "AI", page: 1 },
    ];
    a.versions.push({ ...structuredClone(v), number: 99 });
    const only = { ...s, assets: [a] };
    expect(tagUsage(only, [tag.id])).toBe(1);
    expect(tagUsage(only, [tag.parentId!])).toBe(1);
    expect(tagImpact(tag, { ...tag, enabled: !tag.enabled })).toHaveLength(1);
  });
});
describe("标签 Excel 交换", () => {
  it("损坏文件不产生可提交的预览", async () => {
    await expect(
      readTagWorkbook(new TextEncoder().encode("invalid workbook").buffer),
    ).rejects.toThrow();
  });
  it("导出重新导入保持 ID、层级、状态和绑定，模板可解析", async () => {
    const s = setup(),
      rows = await readTagWorkbook(
        await (await writeTagWorkbook(s.tags)).arrayBuffer(),
      );
    const preview = previewTagImport(s, rows);
    expect(preview.rows.some((r) => r.error)).toBe(false);
    expect(preview.unchanged).toBe(s.tags.length);
    expect(preview.updated + preview.added).toBe(0);
    const assets = structuredClone(s.assets);
    applyTagImport(s, preview);
    expect(s.assets).toEqual(assets);
    expect(
      await readTagWorkbook(
        await (await writeTagWorkbook(s.tags, true)).arrayBuffer(),
      ),
    ).toEqual([]);
  });
  it("支持 ID 更新、分类名称识别、新增；不删除文件未列出的标签", () => {
    const s = setup(),
      root = s.tags.find((t) => t.parentId === null)!,
      tag = s.tags.find((t) => t.parentId === root.id)!;
    const rows: TagImportRow[] = [
      {
        sheet: "标签",
        row: 2,
        id: tag.id,
        name: "更新名称",
        parentId: root.id,
        enabled: false,
        external: true,
      },
      {
        sheet: "标签",
        row: 3,
        id: "",
        name: "导入新标签",
        parentName: root.name,
        enabled: true,
        external: false,
      },
    ];
    const preview = previewTagImport(s, rows);
    expect(preview.updated).toBe(1);
    expect(preview.added).toBe(1);
    const count = s.tags.length;
    applyTagImport(s, preview);
    expect(s.tags).toHaveLength(count + 1);
    expect(s.tags.find((t) => t.id === tag.id)?.enabled).toBe(false);
  });
  it("无效分类、重复行、级别变化、错误值阻止整批保存", () => {
    const s = setup(),
      root = s.tags.find((t) => t.parentId === null)!;
    const row: TagImportRow = {
      sheet: "标签",
      row: 2,
      id: "",
      name: "新增",
      parentId: root.id,
      enabled: true,
      external: false,
    };
    const before = structuredClone(s.tags);
    for (const rows of [
      [{ ...row, parentId: "missing" }],
      [row, { ...row, row: 3 }],
      [{ ...row, id: root.id }],
      [{ ...row, error: "启用值错误" }],
    ]) {
      const preview = previewTagImport(s, rows);
      expect(preview.rows.some((r) => r.error)).toBe(true);
      expect(() => applyTagImport(s, preview)).toThrow("错误");
      expect(s.tags).toEqual(before);
    }
  });
  it("预览后标签变化需重新预览，无权限不能导入", () => {
    const s = setup(),
      preview = previewTagImport(s, []);
    s.tags[0].name += "变化";
    expect(() => applyTagImport(s, preview)).toThrow("变化");
    s.userId = "u3";
    expect(() => applyTagImport(s, preview)).toThrow("权限");
  });
});
