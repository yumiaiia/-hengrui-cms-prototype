import { useState } from "react";
import { Eye, FileText, Sparkles } from "lucide-react";
import { useCMS } from "../store";
import { type Suggestion } from "../model";
import {
  acceptSuggestedTag,
  availableTag,
  recommendationSources,
} from "../taxonomy";
import { paginated } from "../workflow";
import { Badge, Button, Dialog, Empty } from "./ui";
import { DocumentReader, PageCanvas } from "./DocumentReader";

type Source = ReturnType<typeof recommendationSources>[number];
export function SuggestionSources({
  suggestion,
  scope,
  readOnly = false,
  compact = false,
}: {
  suggestion: Suggestion;
  scope?: {
    assetId: string;
    version: number;
    page?: number;
    allPages?: boolean;
  };
  readOnly?: boolean;
  compact?: boolean;
}) {
  const { state, assets, can, update, toast } = useCMS();
  const [preview, setPreview] = useState<Source>();
  const [previewPage, setPreviewPage] = useState(1);
  const sources = recommendationSources(suggestion, assets, state.tags).filter(
    (c) =>
      !scope ||
      (c.assetId === scope.assetId &&
        c.versionNumber === scope.version &&
        (scope.allPages || c.page === scope.page)),
  );
  const existing = state.tags.find(
    (t) => t.parentId === suggestion.parentId && t.name === suggestion.name,
  );
  const parent = state.tags.find((t) => t.id === suggestion.parentId);
  function accept(source: Source) {
    try {
      const ok = update(
        (s) => {
          acceptSuggestedTag(
            s,
            suggestion.id,
            source.assetId,
            source.versionNumber,
            suggestion.parentId,
            source.page,
          );
        },
        undefined,
        existing ? "tags" : "taxonomy",
      );
      if (ok)
        toast(
          source.page
            ? `已采纳并添加到第 ${source.page} 页。`
            : "已采纳并添加为材料标签。",
        );
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "采纳失败，请重试。");
    }
  }
  return (
    <div className={`suggestion-source-list ${compact ? "is-compact" : ""}`}>
      {sources.map((source) => {
        const editable =
          !readOnly &&
          !source.issue &&
          source.asset?.current === source.version?.number &&
          source.asset?.lifecycle === "正常" &&
          suggestion.status !== "已忽略" &&
          can("tags") &&
          !!parent?.enabled &&
          (!existing ? can("taxonomy") : availableTag(state.tags, existing));
        const history =
          source.asset && source.asset.current !== source.version?.number;
        return (
          <div
            className="suggestion-source"
            key={`${source.assetId}-${source.versionNumber}-${source.page || "material"}`}
          >
            <div className="suggestion-source-title">
              <FileText size={15} />
              <strong>
                {source.version?.title ||
                  source.asset?.code ||
                  "来源内容不可用"}
              </strong>
            </div>
            <div className="suggestion-source-meta">
              <span>{source.asset?.code || source.assetId}</span>
              <span>V{source.version?.number || source.versionNumber}</span>
              <span>
                {source.page === undefined
                  ? "整份材料 · 材料标签"
                  : `第 ${source.page} 页 · 页级标签`}
              </span>
              {history ? <Badge tone="gray">历史版本</Badge> : null}
            </div>
            {source.issue ? <p className="error-text">{source.issue}</p> : null}
            <div className="suggestion-source-actions">
              <Button
                variant="ghost"
                icon={<Eye size={14} />}
                disabled={!!source.issue}
                onClick={() => {
                  setPreview(source);
                  setPreviewPage(source.page || 1);
                }}
              >
                预览来源
              </Button>
              {source.accepted ? (
                <Badge tone="green">已采纳</Badge>
              ) : suggestion.status === "已忽略" ? (
                <Badge tone="gray">已忽略</Badge>
              ) : (
                <Button
                  variant="ghost"
                  icon={<Sparkles size={13} />}
                  disabled={!editable}
                  title={
                    history
                      ? "历史版本仅可查看"
                      : !can("tags")
                        ? "需要校正标签权限"
                        : !existing && !can("taxonomy")
                          ? "新增标签需要维护标签库权限"
                          : undefined
                  }
                  onClick={() => accept(source)}
                >
                  采纳并添加
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {!sources.length ? (
        <Empty
          title="尚未记录来源内容"
          description="当前推荐没有文件、版本或页码信息。"
        />
      ) : null}
      {preview?.version ? (
        <Dialog
          portal
          wide
          title={`推荐标签来源 · ${suggestion.name}`}
          onClose={() => setPreview(undefined)}
          footer={
            <Button onClick={() => setPreview(undefined)}>关闭预览</Button>
          }
        >
          <div className="suggestion-preview-context">
            <div>
              <strong>{preview.version.title}</strong>
              <p>
                {preview.asset?.code} · V{preview.version.number} ·{" "}
                {preview.page === undefined
                  ? "推荐来自整份材料"
                  : `推荐来自第 ${preview.page} 页`}
              </p>
            </div>
            <span className="tag-chip">{suggestion.name}</span>
          </div>
          {preview.asset?.current !== preview.version.number ? (
            <p className="permission-note">正在预览推荐生成时的历史版本。</p>
          ) : null}
          <div className="suggestion-preview-reader">
            {preview.page !== undefined && paginated(preview.version) ? (
              <section className="reader">
                <div className="reader-toolbar">
                  <span className="suggestion-exact-page">
                    第 {preview.page} 页 / 共 {preview.version.pages} 页
                  </span>
                </div>
                <div className="reader-scroll">
                  <PageCanvas version={preview.version} page={preview.page} />
                </div>
              </section>
            ) : (
              <DocumentReader
                key={`${preview.assetId}-${preview.version.number}`}
                version={preview.version}
                page={previewPage}
                onPage={setPreviewPage}
              />
            )}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
