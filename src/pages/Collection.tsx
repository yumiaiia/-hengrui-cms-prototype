import { articleSource, articleSourceUrl } from "../collectionSources";
import { collectedArticles, collectedBody } from "../collection";
import { useState } from "react";
import { Copy, Rss } from "lucide-react";
import { ApprovalEditor } from "../components/ApprovalEditor";
import { ArticleBody } from "../components/ArticleBody";
import { useCMS } from "../store";
import { accounts, current, dateLabel, go, safePublicUrl } from "../model";
import {
  Button,
  Dialog,
  Empty,
  PageHeader,
  Pagination,
  SearchBox,
} from "../components/ui";
import "./operations.css";
export default function Collection() {
  const { state, assets, can, toast } = useCMS();
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const [account, setAccount] = useState(
      accounts.includes(params.get("account") || "")
        ? params.get("account")!
        : "all",
    ),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [preview, setPreview] = useState(""),
    [approvalIds, setApprovalIds] = useState<string[]>([]);
  const rows = collectedArticles(state.articles, assets).filter(
    (a) =>
      accounts.includes(a.account) &&
      (account === "all" || a.account === account) &&
      `${a.title} ${a.account}`.includes(query.trim()),
  );
  const selected = rows.find((a) => a.id === preview);
  const asset = assets.find((a) => a.id === selected?.assetId);
  const version = selected && collectedBody(selected, asset);
  const total = rows.length;
  const active = Math.min(page, Math.max(1, Math.ceil(total / 8)));
  function changeAccount(nextAccount: string) {
    setAccount(nextAccount);
    setPage(1);
    const query = new URLSearchParams({ account: nextAccount });
    history.replaceState(null, "", "#/collection?" + query.toString());
  }
  return (
    <div className="collection-page">
      <PageHeader title="公众号采集" />
      <div className="collection-account-filter">
        {["all", ...accounts].map((name) => (
          <button
            key={name}
            className={account === name ? "active" : ""}
            aria-pressed={account === name}
            onClick={() => changeAccount(name)}
          >
            {name === "all" ? "全部公众号" : name}
          </button>
        ))}
      </div>
      <section className="panel collection-article-panel">
        <div className="collection-article-toolbar">
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="搜索文章标题或公众号"
          />
          <span>{rows.length} 篇文章</span>
        </div>
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table collection-article-table">
                <thead>
                  <tr>
                    <th>文章</th>
                    <th>公众号</th>
                    <th>原始链接</th>
                    <th>采集时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((active - 1) * 8, active * 8).map((article) => {
                    const linked = assets.find((a) => a.id === article.assetId),
                      v = collectedBody(article, linked);
                    const source = articleSource(article, linked);
                    const url = articleSourceUrl(source, location.origin);
                    return (
                      <tr key={article.id}>
                        <td>
                          <button
                            className="title-link"
                            disabled={!v}
                            onClick={() => setPreview(article.id)}
                          >
                            {article.title}
                          </button>
                        </td>
                        <td>
                          <span className="collection-account-name">
                            <Rss size={14} />
                            {article.account}
                          </span>
                        </td>
                        <td>
                          {url && safePublicUrl(url) ? (
                            <div className="source-link">
                              <a
                                href={url}
                                title={
                                  source?.startsWith("/samples/wechat/")
                                    ? `演示来源：${url}`
                                    : url
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                {url}
                              </a>
                              <Button
                                variant="ghost"
                                aria-label={`复制${article.title}原始链接`}
                                icon={<Copy size={14} />}
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(url)
                                    .then(() => toast("链接已复制"))
                                    .catch(() =>
                                      toast("复制失败，请手动复制链接"),
                                    )
                                }
                              />
                            </div>
                          ) : url ? (
                            <span
                              className="error-text"
                              title={
                                source?.startsWith("/samples/wechat/")
                                  ? `演示来源：${url}`
                                  : url
                              }
                            >
                              链接无效
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {article.collectedAt
                            ? dateLabel(article.collectedAt)
                            : "—"}
                        </td>
                        <td>
                          <div className="collection-row-actions">
                            {v ? (
                              <Button
                                variant="ghost"
                                onClick={() => setPreview(article.id)}
                              >
                                预览文章
                              </Button>
                            ) : null}
                            {linked ? (
                              <Button
                                variant="ghost"
                                onClick={() => go(`content/${linked.id}`)}
                              >
                                查看内容
                              </Button>
                            ) : null}
                            {linked &&
                            current(linked).approval.mode === "pending" &&
                            can("edit") ? (
                              <Button
                                variant="ghost"
                                onClick={() => setApprovalIds([linked.id])}
                              >
                                补充审批
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty title="暂无匹配的文章" />
        )}
        {total > 0 ? (
          <Pagination total={total} page={active} onChange={setPage} />
        ) : null}
      </section>
      {selected && version ? (
        <Dialog wide title="文章预览" onClose={() => setPreview("")}>
          <ArticleBody version={version} />
        </Dialog>
      ) : null}
      {approvalIds.length ? (
        <ApprovalEditor
          assetIds={approvalIds}
          onClose={() => setApprovalIds([])}
        />
      ) : null}
    </div>
  );
}
