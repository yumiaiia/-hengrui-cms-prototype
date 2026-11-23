import { current, expiryStatus, type Asset } from "./model";
import { fileParsingFailed } from "./fileProcessing";
export type AttentionCategory = "approval" | "processing" | "expiry";
export function contentAttention(assets: Asset[]) {
  return assets
    .filter((a) => a.lifecycle === "正常")
    .flatMap((a) => {
      const v = current(a),
        issues: {
          category: AttentionCategory;
          label: string;
          route: string;
          priority: number;
        }[] = [];
      if (fileParsingFailed(v))
        issues.push({
          category: "processing",
          label: "文件解析失败",
          route: `content/${a.id}`,
          priority: 0,
        });
      else if (v.tagStatus === "未匹配")
        issues.push({
          category: "processing",
          label: "标签待核对",
          route: `content/${a.id}`,
          priority: 2,
        });
      if (v.approval.mode === "pending")
        issues.push({
          category: "approval",
          label: "审批信息待补充",
          route: `content/${a.id}?tab=approval`,
          priority: 1,
        });
      const expiry = expiryStatus(v);
      if (expiry === "已过期" || expiry === "即将过期")
        issues.push({
          category: "expiry",
          label: expiry,
          route: `content/${a.id}?tab=approval`,
          priority: expiry === "已过期" ? 0 : 3,
        });
      return issues.length
        ? [{ asset: a, issues: issues.sort((x, y) => x.priority - y.priority) }]
        : [];
    })
    .sort(
      (a, b) =>
        a.issues[0].priority - b.issues[0].priority ||
        b.asset.updatedAt.localeCompare(a.asset.updatedAt),
    );
}
