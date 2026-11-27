import { describe, it, expect } from "vitest";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { prepareAdministration, saveManagedRole } from "../src/administration";
import {
  mutationAudit,
  prepareReview,
  userWriteAudits,
  auditModule,
  auditSummary,
  appendAudit,
} from "../src/audit";
import {
  startUploadBatch,
  advanceUploads,
  patchStaged,
  confirmStaged,
  archiveStaged,
  visibleBatches,
  retryStaged,
  rebaseStaged,
  resolveStagedRecommendation,
} from "../src/uploadReview";
import { current, type State, type Tag, type Version } from "../src/model";
import {
  nameSimilarity,
  similarTags,
  tagCheckReceipt,
  requireTagCheck,
} from "../src/tagSimilarity";
import { validateTag, acceptSuggestedTag } from "../src/taxonomy";
import {
  previewUserImport,
  applyUserImport,
  writeUserWorkbook,
  readUserWorkbook,
} from "../src/userTransfer";
import {
  previewTagImport,
  applyTagImport,
  type TagImportRow,
} from "../src/tagTransfer";
const setup = () => {
  const s = prepareReview(prepareAdministration(prepareWorkspace(seedState())));
  s.userId = "u1";
  return s;
};
function input(s: State, id = "one", hash = "unique-file") {
  const v: Version = {
    ...structuredClone(current(s.assets[0])),
    fileHash: hash,
    title: "验收上传",
    number: 0,
    fileKey: `file-${id}`,
    approval: { mode: "exempt" },
    tags: [],
    content: [],
  };
  return { id, v };
}
function staged(s: State, existing = false) {
  const target = s.assets[0];
  const v = input(s);
  const id = startUploadBatch(
    s,
    [v],
    { mode: "exempt" },
    existing ? target.id : undefined,
    existing ? target.current : undefined,
  );
  advanceUploads(s, Date.now() + 60000);
  const item = s.uploadBatches!.find((b) => b.id === id)!.items[0];
  patchStaged(s, id, item.id, {}, { noApplicableTags: true });
  return { id, item, target };
}

describe("待确认归档流程", () => {
  it("解析完成仍不入正式库；刷新可恢复，确认后才新建且防重", () => {
    const s = setup(),
      count = s.assets.length;
    const { id, item } = staged(s);
    expect(s.assets.length).toBe(count);
    expect(item.confirmedRevision).toBeUndefined();
    const restored = JSON.parse(JSON.stringify(s));
    expect(visibleBatches(restored)[0].id).toBe(id);
    confirmStaged(s, id, item.id);
    expect(archiveStaged(s, id, [item.id])).toEqual({ success: 1, failed: 0 });
    expect(s.assets.length).toBe(count + 1);
    expect(current(s.assets[0]).confirmedAt).toBeTruthy();
    expect(current(s.assets[0]).archivedAt).toBeTruthy();
    expect(archiveStaged(s, id, [item.id])).toEqual({ success: 0, failed: 0 });
    expect(s.assets.length).toBe(count + 1);
  });
  it("新版本确认前保留旧版本，归档不改历史和发布快照", () => {
    const s = setup(),
      { id, item, target } = staged(s, true),
      number = target.current,
      old = structuredClone(target.versions),
      publications = structuredClone(s.publications);
    expect(target.current).toBe(number);
    confirmStaged(s, id, item.id);
    archiveStaged(s, id, [item.id]);
    expect(target.current).toBe(Math.max(...old.map((v) => v.number)) + 1);
    expect(target.versions.slice(0, -1)).toEqual(old);
    expect(s.publications).toEqual(publications);
  });
  it("结果变更取消确认；重跑解析保留其他明细确认", () => {
    const s = setup();
    const id = startUploadBatch(
      s,
      [input(s, "one", "a"), input(s, "two", "b")],
      { mode: "exempt" },
    );
    advanceUploads(s, Date.now() + 60000);
    for (const i of s.uploadBatches![0].items) {
      patchStaged(s, id, i.id, {}, { noApplicableTags: true });
      confirmStaged(s, id, i.id);
    }
    const [a, b] = s.uploadBatches![0].items;
    patchStaged(s, id, a.id, { summary: "调整摘要" });
    expect(a.confirmedRevision).toBeUndefined();
    expect(b.confirmedRevision).toBe(b.revision);
    expect(() => retryStaged(s, id, a.id)).toThrow("无需重新解析");
    a.v.tagStatus = "失败";
    retryStaged(s, id, a.id);
    expect(a.v.process).toBe("处理中");
    expect(b.confirmedRevision).toBe(b.revision);
  });
  it("冲突项保留，其他项可归档；重核对后才能更新", () => {
    const s = setup();
    const a = input(s, "one", "a"),
      b = input(s, "two", "b");
    const id = startUploadBatch(s, [a, b], { mode: "exempt" });
    advanceUploads(s, Date.now() + 60000);
    const [one, two] = s.uploadBatches![0].items;
    one.targetId = s.assets[0].id;
    one.baseVersion = 0;
    for (const i of [one, two]) {
      patchStaged(s, id, i.id, {}, { noApplicableTags: true });
      confirmStaged(s, id, i.id);
    }
    expect(archiveStaged(s, id, [one.id, two.id])).toEqual({
      success: 1,
      failed: 1,
    });
    expect(one.archiveError).toContain("版本已变化");
    expect(one.confirmedRevision).toBe(one.revision);
    rebaseStaged(s, id, one.id);
    expect(one.confirmedRevision).toBeUndefined();
    confirmStaged(s, id, one.id);
    expect(archiveStaged(s, id, [one.id])).toEqual({ success: 1, failed: 0 });
  });
  it("标签失败允许人工补标，解析失败始终阻止确认", () => {
    const s = setup(),
      { id, item } = staged(s);
    item.v.tagStatus = "失败";
    expect(() => confirmStaged(s, id, item.id)).toThrow("人工");
    patchStaged(s, id, item.id, {}, { manualTagging: true });
    confirmStaged(s, id, item.id);
    item.v.process = "失败";
    expect(() => confirmStaged(s, id, item.id)).toThrow("文件解析");
  });
  it("停用标签、收回权限和批内重复均阻止提交", () => {
    const s = setup(),
      v = input(s);
    expect(() =>
      startUploadBatch(
        s,
        [v],
        { mode: "exempt" },
        undefined,
        undefined,
        "other-actor",
      ),
    ).toThrow("账号已变化");
    expect(() =>
      startUploadBatch(s, [v, { ...v, id: "duplicate" }], { mode: "exempt" }),
    ).toThrow("重复");
    const { id, item } = staged(s);
    const tag = s.tags.find((t) => t.parentId)!;
    patchStaged(s, id, item.id, { tags: [{ tagId: tag.id, origin: "人工" }] });
    tag.enabled = false;
    confirmStaged(s, id, item.id);
    expect(archiveStaged(s, id, [item.id])).toEqual({ success: 0, failed: 1 });
    expect(item.archiveError).toContain("停用");
    const role = s.roles.find((r) => r.id === "admin")!;
    role.permissions = role.permissions.filter((p) => p !== "upload");
    expect(() => archiveStaged(s, id, [item.id])).toThrow("权限");
  });
  it("提交后锁定源文件和审批，不能通过补充信息接口修改", () => {
    const s = setup(),
      { id, item } = staged(s),
      original = structuredClone(item.v);
    for (const patch of [
      { fileKey: "changed" },
      { fileName: "替换.pdf" },
      { approval: { mode: "exempt" } },
      { sourceUrl: "https://example.com/new" },
    ]) {
      expect(() =>
        patchStaged(s, id, item.id, patch as Parameters<typeof patchStaged>[3]),
      ).toThrow("不能更换源文件或修改审批");
    }
    expect(item.v).toEqual(original);
  });
  it("每份文件独立保存展示素材和视频，确认后归档保留快照", () => {
    const s = setup(),
      inputs = [input(s, "one", "one"), input(s, "two", "two")];
    const video = {
      fileKey: "video-1",
      fileName: "讲解.webm",
      size: 2000,
      type: "video/webm",
    };
    inputs[0].v.cover = "/samples/cover-1.svg";
    inputs[0].v.thumbnail = "/samples/cover-2.svg";
    inputs[0].v.videos = [video];
    const id = startUploadBatch(s, inputs, { mode: "exempt" });
    expect(() =>
      patchStaged(s, id, "one", { summary: "处理中不能修改" }),
    ).toThrow("正在解析");
    advanceUploads(s, Date.now() + 60000);
    const [one, two] = s.uploadBatches![0].items;
    expect(one.v.videos).toEqual([video]);
    expect(two.v.videos).toBeUndefined();
    patchStaged(s, id, one.id, {}, { noApplicableTags: true });
    confirmStaged(s, id, one.id);
    patchStaged(s, id, one.id, { thumbnail: "/samples/cover-3.svg" });
    expect(one.confirmedRevision).toBeUndefined();
    confirmStaged(s, id, one.id);
    expect(archiveStaged(s, id, [one.id])).toEqual({ success: 1, failed: 0 });
    const v = current(s.assets.find((a) => a.id === one.archived!.assetId)!);
    expect(v.videos).toEqual([video]);
    expect(v.cover).toBe("/samples/cover-1.svg");
    expect(v.thumbnail).toBe("/samples/cover-3.svg");
    one.v.videos![0].fileName = "后来修改.webm";
    expect(v.videos![0].fileName).toBe("讲解.webm");
  });
  it("确认前已显示新版本继承的封面，明确清除后归档不再隐式恢复", () => {
    const s = setup(),
      asset = s.assets[0],
      old = current(asset);
    old.cover = "/samples/cover-1.svg";
    old.thumbnail = "/samples/cover-2.svg";
    old.videos = [
      { fileKey: "old-video", fileName: "旧视频.mp4", size: 10, type: "video/mp4" },
    ];
    const upload = input(s);
    upload.v.cover = undefined;
    upload.v.thumbnail = undefined;
    const id = startUploadBatch(
        s,
        [upload],
        { mode: "exempt" },
        asset.id,
        asset.current,
      ),
      item = s.uploadBatches![0].items[0];
    expect(item.v.cover).toBe(old.cover);
    expect(item.v.thumbnail).toBe(old.thumbnail);
    expect(item.v.videos).toEqual(old.videos);
    advanceUploads(s, Date.now() + 60000);
    patchStaged(s, id, item.id, { cover: "" }, { noApplicableTags: true });
    confirmStaged(s, id, item.id);
    archiveStaged(s, id, [item.id]);
    expect(current(asset).cover).toBe("");
    expect(current(asset).thumbnail).toBe("/samples/cover-2.svg");
    expect(current(asset).videos).toEqual(old.videos);
  });
  it("单项素材不可用不归档，重试不要求重新确认", () => {
    const s = setup(),
      { id, item } = staged(s);
    confirmStaged(s, id, item.id);
    expect(
      archiveStaged(s, id, [item.id], { [item.id]: "上传视频不可用" }),
    ).toEqual({ success: 0, failed: 1 });
    expect(item.confirmedRevision).toBe(item.revision);
    expect(archiveStaged(s, id, [item.id])).toEqual({ success: 1, failed: 0 });
  });
  it("页级解析失败阻止确认，推荐复用保存原始页码", () => {
    const s = setup(),
      { id, item } = staged(s);
    item.v.pageStates = { 1: { status: "失败" } };
    expect(() => confirmStaged(s, id, item.id)).toThrow("页面解析失败");
    item.v.pageStates = { 1: { status: "完成" } };
    const tag = s.tags.find(
      (t) =>
        t.parentId &&
        s.tags.some(
          (d) =>
            d.id === t.parentId &&
            d.kind !== "enum" &&
            (d.scope === "page" || d.scope === "both" || !d.scope),
        ),
    )!;
    item.recommendations = [
      { id: "rec", name: "测试推荐", parentId: tag.parentId!, page: 2 },
    ];
    resolveStagedRecommendation(s, id, item.id, "rec", tag.id);
    expect(item.v.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagId: tag.id, origin: "人工", page: 2 }),
      ]),
    );
    expect(item.recommendations[0].resolvedTagId).toBe(tag.id);
  });
  it("普通账号只看本人批次，超级管理员可看全部", () => {
    const s = setup();
    staged(s);
    s.userId = "u3";
    expect(visibleBatches(s)).toEqual([]);
    s.userId = "u1";
    expect(visibleBatches(s)).toHaveLength(1);
  });
});

describe("标签相似检查", () => {
  const tags: Tag[] = [
    {
      id: "root",
      name: "疾病",
      parentId: null,
      enabled: true,
      external: false,
    },
    {
      id: "one",
      name: "非小细胞肺癌",
      parentId: "root",
      enabled: true,
      external: false,
    },
    {
      id: "other",
      name: "非小细胞肺癌症",
      parentId: "root",
      enabled: false,
      external: false,
    },
  ];
  it("规范化精确重名，计算相似度并保留停用候选", () => {
    expect(nameSimilarity("非小细胞肺癌", "非小细胞肺癌症")).toBeGreaterThan(
      0.7,
    );
    expect(
      validateTag(tags, { name: " 非小细胞肺癌 ", parentId: "root" }),
    ).toContain("同名");
    expect(
      similarTags(tags, { name: "非小细胞肺癌病", parentId: "root" }).map(
        (x) => x.tag.id,
      ),
    ).toContain("other");
    expect(
      validateTag([...tags, { ...tags[1], id: "latin", name: "ＡＢＣ" }], {
        name: "abc",
        parentId: "root",
      }),
    ).toContain("同名");
  });
  it("仅对当前名称和库版本的确认有效", () => {
    const draft = { name: "非小细胞肺癌病", parentId: "root" };
    expect(() => requireTagCheck(tags, draft)).toThrow("相似");
    const receipt = tagCheckReceipt(tags, draft);
    expect(() => requireTagCheck(tags, draft, receipt)).not.toThrow();
    expect(() =>
      requireTagCheck(tags, { ...draft, id: "new-generated-id" }, receipt),
    ).not.toThrow();
    expect(() =>
      requireTagCheck([...tags, { ...tags[1], id: "new" }], draft, receipt),
    ).toThrow("变化");
  });
  it("相似推荐确认后创建独立标签并绑定，不替换为已有相似标签", () => {
    const s = setup();
    s.tags = structuredClone(tags);
    const a = s.assets[0];
    const draft = { name: "非小细胞肺癌病", parentId: "root" };
    s.suggestions = [
      {
        id: "s",
        ...draft,
        assetIds: [a.id],
        mentions: 1,
        status: "待处理",
        contexts: [{ assetId: a.id, version: a.current, page: 1 }],
      },
    ];
    expect(() =>
      acceptSuggestedTag(s, "s", a.id, a.current, "root", 1),
    ).toThrow("相似");
    expect(s.tags).toHaveLength(3);
    const id = acceptSuggestedTag(s, "s", a.id, a.current, "root", 1, {
      receipt: tagCheckReceipt(s.tags, draft),
    });
    expect(s.tags).toHaveLength(4);
    expect(s.tags.find((tag) => tag.id === id)).toMatchObject(draft);
    expect(id).not.toBe("one");
    expect(id).not.toBe("other");
    expect(current(a).tags).toContainEqual({
      tagId: id,
      origin: "人工",
      page: 1,
    });
    expect(s.suggestions[0].resolutions?.[0].tagId).toBe(id);
  });
  it("推荐名称已精确入库时直接添加，不产生相似标签替换操作", () => {
    const s = setup();
    s.tags = structuredClone(tags);
    const a = s.assets[0];
    s.suggestions = [
      {
        id: "s",
        name: "非小细胞肺癌",
        parentId: "root",
        assetIds: [a.id],
        mentions: 1,
        status: "待处理",
        contexts: [{ assetId: a.id, version: a.current, page: 1 }],
      },
    ];
    acceptSuggestedTag(s, "s", a.id, a.current, "root", 1);
    expect(current(a).tags).toContainEqual({
      tagId: "one",
      origin: "人工",
      page: 1,
    });
    expect(s.suggestions[0].resolutions?.[0].tagId).toBe("one");
    expect(s.tags).toHaveLength(3);
  });
  it("导入对库内和同批相似项要求处理，跳过后不写入", () => {
    const s = setup();
    s.tags = structuredClone(tags);
    const rows: TagImportRow[] = [
      {
        sheet: "取值",
        row: 2,
        id: "",
        name: "非小细胞肺癌病",
        parentId: "root",
        enabled: true,
        external: false,
      },
    ];
    let preview = previewTagImport(s, rows);
    expect(preview.rows[0].similar?.length).toBeGreaterThan(0);
    expect(() => applyTagImport(s, preview)).toThrow("相似");
    preview = previewTagImport(s, rows, { "取值-2": "skip" });
    applyTagImport(s, preview);
    expect(s.tags).toHaveLength(3);
    preview = previewTagImport(s, rows, { "取值-2": "keep" });
    applyTagImport(s, preview);
    expect(s.tags).toHaveLength(4);
  });
});

describe("用户导入导出", () => {
  const rows = (s: State) => [
    {
      row: 2,
      name: "导入测试",
      employeeId: "000099",
      roleName: s.roles.find((r) => r.id === "operator")!.name,
    },
  ];
  it("整批创建，默认启用并保留工号前导零；重传不重复", () => {
    const s = setup(),
      preview = previewUserImport(s, rows(s)),
      count = s.users.length;
    applyUserImport(s, preview);
    expect(s.users.at(-1)).toMatchObject({
      employeeId: "000099",
      enabled: true,
    });
    expect(s.users).toHaveLength(count + 1);
    expect(() => applyUserImport(s, preview)).toThrow("变化");
    expect(s.users).toHaveLength(count + 1);
  });
  it("有错误时不创建任何账号，停用工号和批内重复都报错", () => {
    const s = setup(),
      input = rows(s);
    const count = s.users.length;
    const preview = previewUserImport(s, [...input, { ...input[0], row: 3 }]);
    expect(preview.rows[1].error).toContain("重复");
    expect(() => applyUserImport(s, preview)).toThrow("全部");
    expect(s.users).toHaveLength(count);
    s.users[1].enabled = false;
    expect(
      previewUserImport(s, [
        { ...input[0], employeeId: s.users[1].employeeId! },
      ]).rows[0].error,
    ).toContain("工号已存在");
  });
  it("拒绝无管理权限、未知角色和超管分配", () => {
    const s = setup(),
      input = rows(s);
    expect(
      previewUserImport(s, [{ ...input[0], roleName: "超级管理员" }]).rows[0]
        .error,
    ).toContain("不可分配");
    s.userId = "u3";
    expect(() =>
      applyUserImport(s, {
        rows: input,
        baseline: JSON.stringify([s.users, s.roles]),
      }),
    ).toThrow("错误");
  });
  it("真实 Excel 模板与导出保留文本工号", async () => {
    const s = setup();
    const blob = await writeUserWorkbook(s, [], true);
    const { Workbook } = await import("exceljs"),
      book = new Workbook();
    await book.xlsx.load(await blob.arrayBuffer());
    const sh = book.getWorksheet("用户")!;
    expect(sh.getColumn(2).numFmt).toBe("@");
    sh.addRow([
      "测试",
      "000099",
      s.roles.find((r) => r.id === "operator")!.name,
    ]);
    const bytes = await book.xlsx.writeBuffer();
    expect(
      (await readUserWorkbook(new Uint8Array(bytes).buffer))[0].employeeId,
    ).toBe("000099");
    const out = await writeUserWorkbook(s, [s.users[0]]);
    const exported = new Workbook();
    await exported.xlsx.load(await out.arrayBuffer());
    expect(exported.getWorksheet("用户")!.getRow(2).getCell(2).value).toBe(
      s.users[0].employeeId,
    );
  });
});

describe("用户写入操作审计", () => {
  it("一次显式写入只记录一条简短日志，不保存字段差异", () => {
    const before = setup(),
      after = structuredClone(before),
      count = after.audits.length;
    current(after.assets[0]).cover = "local:updated-cover";
    current(after.assets[0]).summary = "新的摘要";
    mutationAudit(before, after, {
      action: "修改内容信息",
      object: after.assets[0].code,
      module: "内容库",
      changes: [
        {
          object: "旧详细记录",
          objectId: "id",
          field: "封面",
          before: "old",
          after: "new",
        },
      ],
    });
    expect(after.audits).toHaveLength(count + 1);
    expect(after.audits[0]).toMatchObject({
      actorId: "u1",
      module: "内容库",
      action: "修改内容信息",
      summary: after.assets[0].code,
      result: "成功",
    });
    expect(after.audits[0].changes).toBeUndefined();
    expect(after.audits[0].detail).toBe("");
  });
  it("视图状态变化和未声明的本地更新不自动生成日志", () => {
    const before = setup(),
      after = structuredClone(before),
      count = after.audits.length;
    current(after.assets[0]).cover = "local:cover";
    mutationAudit(before, after);
    expect(after.audits).toHaveLength(count);
  });
  it("系统自动处理、下载导出和登录均不新增审计", () => {
    const before = setup(),
      after = structuredClone(before),
      count = after.audits.length;
    for (const event of [
      { action: "解析打标完成", source: "系统" as const },
      { action: "更新处理状态", source: "系统" as const },
      { action: "下载原文件" },
      { action: "导出用户" },
      { action: "平台账号演示登录" },
      { action: "退出演示账号" },
    ])
      mutationAudit(before, after, { ...event, object: "测试对象" });
    expect(after.audits).toHaveLength(count);
  });
  it("用户修改系统管理中的账号、角色仍然记录，可分别筛选模块", () => {
    const s = setup();
    appendAudit(s, {
      action: "修改角色权限",
      object: "内容编辑",
      module: "系统管理",
    });
    expect(s.audits[0]).toMatchObject({
      user: s.users.find((u) => u.id === "u1")!.name,
      module: "系统管理",
      source: "人工",
    });
    const role = {
      id: "auditor",
      name: "审计员",
      menus: ["audit"],
      permissions: ["audit" as const],
    };
    saveManagedRole(s, role, true);
    expect(role.permissions).toEqual(["audit"]);
  });
  it("历史记录只展示用户写入，归类到模块且说明长度受控", () => {
    const s = setup(),
      base = {
        id: "old",
        at: new Date().toISOString(),
        user: "旧用户",
        action: "修改内容信息",
        object: "内容编号",
        detail: "不展示详细JSON",
        category: "内容" as const,
      };
    s.audits = [
      base,
      { ...base, id: "archive", action: "归档内容" },
      { ...base, id: "system", source: "系统", action: "保存处理结果" },
      { ...base, id: "download", action: "下载原文件" },
      { ...base, id: "export", action: "导出内容资产" },
      { ...base, id: "role", category: "系统", action: "修改角色权限" },
    ];
    expect(userWriteAudits(s).map((a) => a.id)).toEqual([
      "old",
      "archive",
      "role",
    ]);
    expect(auditModule(s.audits[0])).toBe("内容库");
    expect(auditModule({ ...base, action: "确认内容与标签结果" })).toBe(
      "内容库",
    );
    expect(auditModule(s.audits.at(-1)!)).toBe("系统管理");
    expect(
      auditSummary({ ...base, object: "长名称".repeat(80) }).length,
    ).toBeLessThanOrEqual(70);
  });
  it("失败写入保留失败结果，历史内容不补造人工确认", () => {
    const s = setup();
    appendAudit(s, {
      action: "批量创建用户",
      object: "2 个账号",
      module: "系统管理",
      result: "失败",
    });
    expect(s.audits[0].result).toBe("失败");
    expect(current(s.assets[0]).confirmedAt).toBeUndefined();
    expect(prepareReview(s)).toEqual(s);
  });
});
