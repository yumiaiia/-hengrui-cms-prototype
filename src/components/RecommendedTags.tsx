import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useCMS } from "../store";
import { recommendationSources, primaryTags } from "../taxonomy";
import { Badge, Button, Dialog, Empty, Pagination, SearchBox } from "./ui";
import { ignoreRecommendation } from "../recommendations";
import { SuggestionSources } from "./SuggestionSources";

export function RecommendedTags() {
  const { state, assets, can, update, toast } = useCMS();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState("");
  const [ignoring, setIgnoring] = useState(false);
  const suggestions = state.suggestions.map((s) => {
    const sources = recommendationSources(s, assets, state.tags);
    const accepted = sources.filter((c) => c.accepted).length;
    const displayStatus =
      s.status === "已忽略"
        ? "已忽略"
        : accepted && accepted === sources.length
          ? "已采纳"
          : accepted
            ? "部分采纳"
            : "待处理";
    return { suggestion: s, sources, accepted, displayStatus };
  });
  const rows = suggestions.filter(
    ({ suggestion: s, sources, displayStatus }) =>
      (!category || s.parentId === category) &&
      (!status || displayStatus === status) &&
      [
        s.name,
        state.tags.find((t) => t.id === s.parentId)?.name,
        ...sources.flatMap((c) => [c.version?.title, c.asset?.code]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const activePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const detail = suggestions.find((s) => s.suggestion.id === detailId);
  function ignore() {
    if (!detail) return;
    try {
      const ok = update(
        (s) => ignoreRecommendation(s, detailId),
        undefined,
        "taxonomy",
      );
      if (ok) {
        setIgnoring(false);
        toast("已忽略这条推荐，已采纳的标签保留。");
      }
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "操作失败，请重试。");
    }
  }
  return (
    <section className="panel recommended-tags-panel">
      <div className="recommendation-heading">
        <Sparkles size={20} />
        <div>
          <h2>全部推荐标签</h2>
          <p>按推荐标签汇总来源，核对文件、版本与页码后再采纳。</p>
        </div>
      </div>
      <div className="recommendation-toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="搜索推荐标签、来源标题或内容编号"
        />
        <select
          aria-label="推荐标签分类"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部分类</option>
          {primaryTags(state.tags).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="推荐处理状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          {["待处理", "部分采纳", "已采纳", "已忽略"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="data-table recommendation-table">
          <thead>
            <tr>
              <th>推荐标签</th>
              <th>建议分类</th>
              <th>来源内容</th>
              <th>处理状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice((activePage - 1) * 8, activePage * 8)
              .map(({ suggestion: s, sources, accepted, displayStatus }) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>
                    {state.tags.find((t) => t.id === s.parentId)?.name ||
                      "未分类"}
                  </td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => setDetailId(s.id)}
                    >
                      {new Set(sources.map((c) => c.assetId)).size} 份内容 ·{" "}
                      {sources.length} 处来源
                    </button>
                    <small className="recommendation-row-note">
                      {sources[0]?.version?.title || "来源信息待补充"}
                      {sources.length > 1 ? " 等" : ""}
                    </small>
                  </td>
                  <td>
                    <Badge>{displayStatus}</Badge>
                    {accepted ? (
                      <small className="recommendation-row-note">
                        已采纳 {accepted}/{sources.length} 处
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => setDetailId(s.id)}
                    >
                      查看来源
                      <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? (
        <Empty
          title="没有匹配的推荐标签"
          description="调整关键词或筛选条件，识别到的新标签将在这里汇总。"
        />
      ) : null}
      <Pagination total={rows.length} page={activePage} onChange={setPage} />
      {detail ? (
        <Dialog
          drawer
          title="推荐标签详情"
          onClose={() => {
            setDetailId("");
            setIgnoring(false);
          }}
          footer={
            <>
              {can("taxonomy") &&
              !["已采纳", "已忽略"].includes(detail.displayStatus) ? (
                <Button onClick={() => setIgnoring(true)}>忽略此推荐</Button>
              ) : null}
              <Button
                onClick={() => {
                  setDetailId("");
                  setIgnoring(false);
                }}
              >
                关闭
              </Button>
            </>
          }
        >
          <div className="recommendation-detail-heading">
            <div>
              <h3>{detail.suggestion.name}</h3>
              <p>
                {state.tags.find((t) => t.id === detail.suggestion.parentId)
                  ?.name || "未分类"}
              </p>
            </div>
            <Badge>{detail.displayStatus}</Badge>
          </div>
          <p className="recommendation-detail-hint">
            共 {detail.sources.length}{" "}
            处来源。采纳只添加到对应内容的指定位置，其他来源独立处理。
          </p>
          <SuggestionSources suggestion={detail.suggestion} />
        </Dialog>
      ) : null}
      {ignoring && detail ? (
        <Dialog
          title="忽略推荐标签"
          onClose={() => setIgnoring(false)}
          footer={
            <>
              <Button onClick={() => setIgnoring(false)}>取消</Button>
              <Button variant="primary" onClick={ignore}>
                确认忽略
              </Button>
            </>
          }
        >
          <p>
            忽略“{detail.suggestion.name}
            ”后，各来源内容将不再提示这条推荐。已经采纳的标签会保留，仍可在“已忽略”中查看来源。
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
