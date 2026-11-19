import { describe, it, expect } from "vitest";
import {
  expiryStatus,
  credentialErrors,
  ocrWarnings,
  current,
  visibleFor,
  canRole,
  type Version,
} from "../src/model";
import { demoCredential, seedState } from "../src/seed";
import { csvCell } from "../src/storage";
const version = (expiry?: string): Version => ({
  ...seedState().assets[7].versions[0],
  expiry,
  approval: { mode: "exempt" },
});
describe("独立状态及到期规则", () => {
  it("提前30自然日提醒，31天仍生效", () => {
    expect(expiryStatus(version("2026-12-19"), "2026-11-19")).toBe("即将过期");
    expect(expiryStatus(version("2026-12-20"), "2026-11-19")).toBe("生效中");
  });
  it("到期当天仍有效，次日过期", () => {
    expect(expiryStatus(version("2026-11-19"), "2026-11-19")).toBe("即将过期");
    expect(expiryStatus(version("2026-11-18"), "2026-11-19")).toBe("已过期");
  });
  it("未设置不推断为永久有效", () =>
    expect(expiryStatus(version(), "2026-11-19")).toBe("未设置"));
  it("登记时采用凭证有效期", () =>
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
});
describe("审批凭证与版本", () => {
  it("编号/截图/有效期缺失必须补齐", () => {
    const errors = credentialErrors({
      ...demoCredential,
      number: "",
      evidence: [],
      expiry: "",
    });
    expect(errors).toHaveLength(3);
  });
  it("一致结果无需额外人工确认", () =>
    expect(credentialErrors(demoCredential)).toHaveLength(0));
  it("无法识别可以人工确认继续，原结果不变", () => {
    const revision = structuredClone(demoCredential);
    revision.evidence[0].number = "";
    revision.evidence[0].status = "无法识别";
    expect(credentialErrors(revision)).toContain("请人工确认 OCR 异常");
    revision.confirmed = true;
    revision.confirmation = "已核对原图";
    expect(credentialErrors(revision)).toHaveLength(0);
    expect(revision.evidence[0].number).toBe("");
    expect(ocrWarnings(revision).length).toBeGreaterThan(0);
  });
  it("多截图不同编号与有效期分别记录冲突", () => {
    const r = structuredClone(demoCredential);
    r.evidence[1].number = "APP-DEMO-X";
    r.evidence[1].expiry = "2028-01-01";
    expect(ocrWarnings(r).some((w) => w.includes("不同编号"))).toBe(true);
    expect(ocrWarnings(r).some((w) => w.includes("不同有效期"))).toBe(true);
  });
  it("内容ID、版本和审批编号不混用", () => {
    const s = seedState();
    expect(s.assets[0].versions).toHaveLength(2);
    expect(current(s.assets[0]).number).toBe(2);
    expect(
      s.assets.filter((a) => current(a).approval.credentialId === "c1"),
    ).toHaveLength(5);
  });
  it("凭证快照不随共享凭证修改", () => {
    const s = seedState();
    const before = current(s.assets[0]).approval.snapshot!.number;
    s.credentials[0].revisions[0].number = "REVISED";
    expect(current(s.assets[0]).approval.snapshot!.number).toBe(before);
    expect(s.assets[0].versions[0].approval.snapshot!.number).toBe(before);
  });
});
describe("角色与导出边界", () => {
  it("普通用户仅能访问本人内容且不可免登记", () => {
    const s = seedState();
    const u = s.users.find((u) => u.id === "u3")!;
    const r = s.roles.find((r) => r.id === u.roleId)!;
    expect(visibleFor(s, u, r).every((a) => a.ownerId === u.id)).toBe(true);
    expect(visibleFor(s, u, r)).toHaveLength(3);
    expect(canRole(r, "exempt")).toBe(false);
  });
  it("未登录无数据", () =>
    expect(visibleFor(seedState(), undefined, undefined)).toEqual([]));
  it("CSV转义公式和引号", () => {
    expect(csvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});
