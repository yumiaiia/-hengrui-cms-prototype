import { describe, it, expect } from "vitest";
import {
  expiryStatus,
  credentialErrors,
  ocrWarnings,
  current,
  visibleFor,
  canRole,
  primaryTagId,
  type Version,
  type State,
  approvalExpiryFromNumber,
  approvalNumberError,
} from "../src/model";
import { demoCredential, seedState } from "../src/seed";
import { csvCell } from "../src/storage";
import { migrateState } from "../src/migration";
import {
  primaryTags,
  primaryOf,
  validateTag,
  availableTag,
  pendingSuggestions,
  acceptSuggestedTag,
  bindTag,
} from "../src/taxonomy";
import { persistApproval } from "../src/components/ApprovalEditor";
const version = (expiry?: string): Version => ({
  ...seedState().assets[7].versions[0],
  expiry,
  approval: { mode: "exempt" },
});
describe("有效期与版本", () => {
  it("提前30自然日提醒，31天仍生效", () => {
    expect(expiryStatus(version("2026-12-19"), "2026-11-19")).toBe("即将过期");
    expect(expiryStatus(version("2026-12-20"), "2026-11-19")).toBe("生效中");
  });
  it("到期日有效，次日过期", () => {
    expect(expiryStatus(version("2026-11-19"), "2026-11-19")).toBe("即将过期");
    expect(expiryStatus(version("2026-11-18"), "2026-11-19")).toBe("已过期");
  });
  it("未设置不是永久有效", () =>
    expect(expiryStatus(version(), "2026-11-19")).toBe("未设置"));
  it("采用登记的审批有效期", () =>
    expect(
      expiryStatus(
        {
          ...version("2028-01-01"),
          approval: {
            mode: "registered",
            snapshot: { ...demoCredential, expiry: "2026-11-18" },
          },
        },
        "2026-11-19",
      ),
    ).toBe("已过期"));
  it("编号、版本和审批号互不混用", () => {
    const s = seedState();
    expect(s.assets[0].versions).toHaveLength(2);
    expect(current(s.assets[0]).number).toBe(2);
    expect(
      s.assets.filter((a) => current(a).approval.credentialId === "c1"),
    ).toHaveLength(5);
  });
  it("历史快照不随审批信息修改", () => {
    const s = seedState();
    s.credentials[0].revisions[0].number = "CHANGED";
    expect(s.assets[0].versions[0].approval.snapshot!.number).toBe(
      "APP-DEMO-001",
    );
  });
});
describe("整批统一、单张审批截图", () => {
  it("必需字段缺失会阻止保存", () =>
    expect(
      credentialErrors({
        ...demoCredential,
        number: "",
        evidence: [],
        expiry: "",
      }),
    ).toHaveLength(3));
  it("演示审批信息只有一张且匹配无需人工确认", () => {
    expect(demoCredential.evidence).toHaveLength(1);
    expect(credentialErrors(demoCredential)).toEqual([]);
  });
  it("新登记不接受第二张截图", () => {
    const r = structuredClone(demoCredential);
    r.evidence.push({ ...r.evidence[0], id: "second" });
    expect(credentialErrors(r)).toContain("每次只能上传一张审批截图");
  });
  it("无法识别可确认继续，不伪装为识别一致", () => {
    const r = structuredClone(demoCredential);
    r.evidence[0].number = "";
    r.evidence[0].status = "无法识别";
    expect(credentialErrors(r)).toContain("请人工确认 OCR 异常");
    r.confirmed = true;
    expect(credentialErrors(r)).toEqual([]);
    expect(ocrWarnings(r).length).toBeGreaterThan(0);
    expect(r.evidence[0].number).toBe("");
  });
  it("整批可以共用同一截图和编号而不改历史", () => {
    const s = seedState();
    const before = structuredClone(s.assets[0].versions[0]);
    const approval = persistApproval(
      s,
      structuredClone(demoCredential),
      s.users[0],
      s.assets.slice(0, 8).map((a) => a.id),
      s.credentials.map((c) => c.id),
    );
    s.assets
      .slice(0, 8)
      .forEach((a) => (current(a).approval = structuredClone(approval)));
    expect(
      new Set(s.assets.slice(0, 8).map((a) => current(a).approval.credentialId))
        .size,
    ).toBe(1);
    expect(
      s.assets
        .slice(0, 8)
        .every((a) => current(a).approval.snapshot?.evidence.length === 1),
    ).toBe(true);
    expect(s.assets[0].versions[0]).toEqual(before);
  });
  it("免登记不要求任何审批字段", () => {
    const s = seedState();
    expect(persistApproval(s, null, s.users[0], ["a1"], [])).toEqual({
      mode: "exempt",
    });
  });
});
describe("只有一级和二级标签", () => {
  it("一级是实体，不存在额外分组或同义词字段", () => {
    const s = seedState();
    expect(primaryTags(s.tags)).toHaveLength(7);
    expect(
      s.tags.every(
        (t) => !("group" in t) && !("synonyms" in t) && !("parent" in t),
      ),
    ).toBe(true);
  });
  it("一级可以创建", () =>
    expect(
      validateTag(seedState().tags, { name: "新一级", parentId: null }),
    ).toBe(""));
  it("二级只能归属一级，三级被拒绝", () => {
    const s = seedState();
    expect(
      validateTag(s.tags, {
        name: "新二级",
        parentId: primaryTagId("疾病领域"),
      }),
    ).toBe("");
    expect(validateTag(s.tags, { name: "第三层", parentId: "t3" })).toContain(
      "不支持第三级",
    );
  });
  it("同一级下不能重名，不同一级可以", () => {
    const s = seedState();
    expect(
      validateTag(s.tags, { name: "肿瘤", parentId: primaryTagId("疾病领域") }),
    ).not.toBe("");
    expect(
      validateTag(s.tags, { name: "肿瘤", parentId: primaryTagId("目标受众") }),
    ).toBe("");
  });
  it("一级停用时二级不可再添加，既有绑定保留", () => {
    const s = seedState();
    const root = s.tags.find((t) => t.id === primaryTagId("疾病领域"))!;
    root.enabled = false;
    expect(
      availableTag(
        s.tags,
        s.tags.find((t) => t.id === "t3")!,
      ),
    ).toBe(false);
    expect(current(s.assets[0]).tags.some((b) => b.tagId === "t3")).toBe(true);
  });
});
describe("内容内推荐新增和关联", () => {
  it("一次操作新增标签并绑定当前内容，不影响另一个来源", () => {
    const s = seedState();
    const id = acceptSuggestedTag(s, "s1", "a2", 1, primaryTagId("证据类型"));
    expect(s.tags.find((t) => t.id === id)?.name).toBe("指南更新");
    expect(
      current(s.assets.find((a) => a.id === "a2")!).tags.some(
        (b) => b.tagId === id,
      ),
    ).toBe(true);
    expect(
      current(s.assets.find((a) => a.id === "a3")!).tags.some(
        (b) => b.tagId === id,
      ),
    ).toBe(false);
    expect(
      pendingSuggestions(
        s,
        s.assets.find((a) => a.id === "a2")!,
      ).some((x) => x.id === "s1"),
    ).toBe(false);
  });
  it("没有管理权限不能新增推荐，不产生半成品", () => {
    const s = seedState();
    s.userId = "u3";
    const before = JSON.stringify(s);
    expect(() =>
      acceptSuggestedTag(s, "s1", "a3", 1, primaryTagId("证据类型")),
    ).toThrow("标签管理权限");
    expect(JSON.stringify(s)).toBe(before);
  });
  it("已有推荐标签只需内容编辑权限", () => {
    const s = seedState();
    s.userId = "u3";
    s.tags.push({
      id: "existing",
      name: "指南更新",
      parentId: primaryTagId("证据类型"),
      enabled: true,
      external: false,
    });
    expect(acceptSuggestedTag(s, "s1", "a3", 1, primaryTagId("证据类型"))).toBe(
      "existing",
    );
    expect(
      current(s.assets.find((a) => a.id === "a3")!).tags.some(
        (b) => b.tagId === "existing",
      ),
    ).toBe(true);
  });
  it("旧版本只读，不能直接添加标签", () => {
    const s = seedState();
    expect(() => bindTag(s, "a1", 1, "t3")).toThrow("当前正常版本");
  });
  it("页面标签只添加到指定页", () => {
    const s = seedState();
    bindTag(s, "a1", 2, "t9", 3);
    expect(
      current(s.assets[0]).tags.some((b) => b.tagId === "t9" && b.page === 3),
    ).toBe(true);
    expect(
      current(s.assets[0]).tags.some(
        (b) => b.tagId === "t9" && b.page === undefined,
      ),
    ).toBe(false);
  });
});
describe("旧数据迁移不丢内容", () => {
  function legacy() {
    const s = seedState();
    const tags = s.tags
      .filter((t) => t.parentId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        group: primaryOf(s.tags, t)!.name,
        parent: t.id === "t9" ? "t8" : undefined,
        synonyms: ["旧字段"],
        enabled: t.enabled,
        external: t.external,
      }));
    const suggestions = s.suggestions.map(({ parentId, ...rest }) => ({
      ...rest,
      group: s.tags.find((t) => t.id === parentId)!.name,
    }));
    s.assets[0].versions[0].fileKey = "saved-original";
    s.assets[0].versions[0].approval.snapshot!.evidence.push({
      ...demoCredential.evidence[0],
      id: "legacy-second",
      fileKey: "saved-old-image",
    });
    return {
      ...s,
      schema: 1,
      tags,
      suggestions,
      roles: s.roles.map((r) => ({ ...r, menus: [...r.menus, "credentials"] })),
    };
  }
  it("保留原文件、所有历史截图和标签ID", () => {
    const old = legacy();
    const migrated = migrateState(old);
    expect(migrated.schema).toBe(2);
    expect(migrated.assets).toEqual(old.assets);
    expect(migrated.assets[0].versions[0].fileKey).toBe("saved-original");
    expect(
      migrated.assets[0].versions[0].approval.snapshot!.evidence,
    ).toHaveLength(2);
    expect(migrated.tags.filter((t) => t.parentId).map((t) => t.id)).toEqual(
      old.tags.map((t) => t.id),
    );
    expect(
      migrated.tags.every(
        (t) =>
          t.parentId === null ||
          migrated.tags.some((p) => p.id === t.parentId && p.parentId === null),
      ),
    ).toBe(true);
  });
  it("迁移幂等，审批菜单不再存在", () => {
    const s = migrateState(legacy());
    expect(migrateState(s)).toEqual(s);
    expect(s.roles.every((r) => !r.menus.includes("credentials"))).toBe(true);
  });
});
describe("权限和导出", () => {
  it("普通用户可查看全部内容，免登记仍按功能权限控制", () => {
    const s = seedState();
    const user = s.users.find((u) => u.id === "u3")!;
    const role = s.roles.find((r) => r.id === user.roleId)!;
    Object.assign(role, { dataRange: "own" });
    expect(visibleFor(s, user, role)).toEqual(s.assets);
    expect(canRole(role, "exempt")).toBe(false);
  });
  it("未登录没有内容", () =>
    expect(visibleFor(seedState(), undefined, undefined)).toEqual([]));
  it("导出CSV转义公式和引号", () => {
    expect(csvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});
describe("审批编号解析", () => {
  it("双结构末段年月推导月末有效期", () => {
    expect(approvalExpiryFromNumber("TG-非肿瘤-减重瑞普泊肽注射液-02893-2028-10")).toBe(
      "2028-10-31",
    );
    expect(approvalExpiryFromNumber("HR-P-108051-00001-2607")).toBe("2026-07-31");
    expect(approvalExpiryFromNumber("APP-DEMO-001-2028-02")).toBe("2028-02-29");
    expect(approvalExpiryFromNumber("全角编号－2027-01")).toBe("2027-01-31");
  });
  it("末段无法解析合法年月时返回空", () => {
    expect(approvalExpiryFromNumber("APP-DEMO-001")).toBe("");
    expect(approvalExpiryFromNumber("HR-P-00001-2613")).toBe("");
    expect(approvalExpiryFromNumber("")).toBe("");
  });
  it("编号格式校验", () => {
    expect(approvalNumberError("")).toBe("审批编号必填");
    expect(approvalNumberError("AB-123")).toBe("请填写 8~64 位有效审批编号");
    expect(approvalNumberError("HR-P/108051-00001-2607")).toContain("斜杠");
    expect(approvalNumberError("HR-P（108051）-00001")).toContain("括号");
    expect(approvalNumberError("TG-非肿瘤-减重瑞普泊肽注射液-02893-2028-10")).toBe("");
  });
});
