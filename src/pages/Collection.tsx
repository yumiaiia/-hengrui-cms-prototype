import { ApprovalEditor } from "../components/ApprovalEditor";
import { ArticleBody } from "../components/ArticleBody";
import { useCallback, useEffect, useRef, useState } from "react";
import { Rss } from "lucide-react";
import { useCMS } from "../store";
import {
  accounts,
  current,
  dateLabel,
  go,
  now,
  uid,
  type Article,
  type Asset,
  type Task,
  type Version,
} from "../model";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Note,
  PageHeader,
  Pagination,
  SearchBox,
} from "../components/ui";
import "./operations.css";

const taskPrefix = "本地采集演示 · ";
function queuedTask(asset: Asset): Task {
  return {
    id: uid("task"),
    name: `${taskPrefix}${current(asset).title}`,
    type: "解析与打标",
    status: "排队中",
    items: [
      {
        assetId: asset.id,
        version: asset.current,
        label: current(asset).title,
        status: "排队中",
      },
    ],
    createdAt: now(),
    attempts: 1,
  };
}
function articleVisible(article: Article, visibleIds: Set<string>) {
  return !article.assetId || visibleIds.has(article.assetId);
}

export default function Collection() {
  const cms = useCMS();
  const { state, assets, user, can, update, toast } = cms;
  const latest = useRef(cms);
  latest.current = cms;
  const [account, setAccount] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [comparison, setComparison] = useState<{ id: string; base: number }>();
  const [previewId, setPreviewId] = useState("");
  const [approvalIds, setApprovalIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    setComparison(undefined);
    setConfirmed(false);
  }, [user?.id]);
  // Start only this page's explicitly queued local demonstrations. The shared store
  // completes processing and updates the exact version named by each task item.
  const beginQueue = (taskId: string) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const api = latest.current;
      if (!api.can("collect")) return;
      const task = api.state.tasks.find((t) => t.id === taskId);
      const allowed = new Set(api.assets.map((a) => a.id));
      if (
        !task ||
        task.status !== "排队中" ||
        !task.items.every((item) => item.assetId && allowed.has(item.assetId))
      )
        return;
      api.update(
        (s) => {
          const t = s.tasks.find((t) => t.id === taskId)!;
          t.status = "处理中";
          t.finishAt = Date.now() + 1800;
          for (const item of t.items) {
            item.status = "处理中";
            const v = s.assets
              .find((a) => a.id === item.assetId)
              ?.versions.find((v) => v.number === item.version);
            if (v) {
              v.process = "处理中";
              v.tagStatus = "打标中";
            }
          }
        },
        undefined,
        "collect",
      );
    }, 650);
    timers.current.add(timer);
  };
  useEffect(() => {
    const visibleIds = new Set(latest.current.assets.map((a) => a.id));
    if (latest.current.can("collect"))
      for (const task of latest.current.state.tasks) {
        if (
          task.name.startsWith(taskPrefix) &&
          task.status === "排队中" &&
          task.items.every(
            (item) => item.assetId && visibleIds.has(item.assetId),
          )
        )
          beginQueue(task.id);
      }
    // Timers intentionally finish after navigation; they never fetch remote articles.
  }, [user?.id]);
  const visibleIds = new Set(assets.map((a) => a.id));
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const articles = state.articles.filter(
    (a) => accounts.includes(a.account) && articleVisible(a, visibleIds),
  );
  const collectedArticles = articles.filter((a) => a.status !== "失败");
  const rows = collectedArticles.filter(
    (a) =>
      (account === "all" || a.account === account) &&
      `${a.title} ${a.account}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const previewArticle = collectedArticles.find((a) => a.id === previewId);
  const previewAsset = assets.find((a) => a.id === previewArticle?.assetId);
  const previewVersion =
    previewArticle?.collectedVersion || (previewAsset && current(previewAsset));
  const pageNumber = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const comparingArticle = articles.find((a) => a.id === comparison?.id);
  const comparingAsset = comparingArticle?.assetId
    ? assetMap.get(comparingArticle.assetId)
    : undefined;
  const after = comparingArticle?.after || "";
  const changed = !!comparingArticle?.after;
  const previousArticle =
    comparingArticle?.previousVersion ||
    comparingAsset?.versions.find((v) => v.number === comparison?.base);
  const incomingArticle =
    comparingArticle?.collectedVersion ||
    (comparingArticle?.handled && comparingAsset
      ? current(comparingAsset)
      : previousArticle && comparingArticle
        ? {
            ...previousArticle,
            title: comparingArticle.title,
            content: [after, ...previousArticle.content.slice(1)],
          }
        : undefined);

  const openComparison = (article: Article) => {
    const asset = article.assetId ? assetMap.get(article.assetId) : undefined;
    if (!asset) return toast("关联内容不在当前可见范围内。");
    const base = article.handled
      ? article.previousVersion?.number ||
        Math.max(
          1,
          ...asset.versions
            .filter((v) => v.number < asset.current)
            .map((v) => v.number),
        )
      : asset.current;
    setComparison({ id: article.id, base });
    setConfirmed(false);
    setComparisonError("");
  };
  const confirmVersion = () => {
    if (!comparison || !comparingArticle || !comparingAsset || !can("collect"))
      return;
    if (comparingArticle.handled || comparingAsset.current !== comparison.base)
      return setComparisonError(
        "该更新已处理或当前内容版本已变化，请关闭窗口后重新比较。",
      );
    if (comparingAsset.lifecycle !== "正常")
      return setComparisonError("已作废内容不能创建新版本。");
    if (!changed) {
      const ok = update(
        (s) => {
          s.articles.find((a) => a.id === comparison.id)!.checkedAt = now();
        },
        {
          action: "本地采集比较",
          object: comparingArticle.title,
          detail: "比较结果未变化，仅更新 checkedAt，不创建内容或版本。",
        },
        "collect",
      );
      if (ok) {
        setComparison(undefined);
        toast("正文未变化，仅更新检查时间。");
      }
      return;
    }
    if (!confirmed)
      return setComparisonError("请确认创建新版本及重新补充审批信息。");
    let taskId = "";
    const versionNumber =
      Math.max(...comparingAsset.versions.map((v) => v.number)) + 1;
    const ok = update(
      (s) => {
        const asset = s.assets.find((a) => a.id === comparingAsset.id)!;
        const article = s.articles.find((a) => a.id === comparingArticle.id)!;
        const previous = current(asset);
        const next: Version = {
          ...structuredClone(previous),
          number: Math.max(...asset.versions.map((v) => v.number)) + 1,
          content: [after, ...previous.content.slice(1)],
          summary: after,
          createdAt: now(),
          process: "排队中",
          tagStatus: "待打标",
          tags: [],
          approval: { mode: "pending" },
          expiry: undefined,
          unmatched: undefined,
          fileKey: undefined,
          fileUrl: undefined,
          previewUrl: undefined,
          changeNote: "人工确认采集正文变化；本地虚构文章演示。",
        };
        asset.versions.push(next);
        asset.current = next.number;
        asset.updatedAt = now();
        article.previousVersion = structuredClone(previous);
        article.collectedVersion = structuredClone(next);
        article.status = "成功";
        article.checkedAt = now();
        article.handled = true;
        article.error = undefined;
        const task = queuedTask(asset);
        taskId = task.id;
        s.tasks.unshift(task);
        s.tasks.unshift({
          id: uid("collection-task"),
          name: `${taskPrefix}确认文章更新`,
          type: "采集",
          status: "完成",
          items: [
            {
              assetId: asset.id,
              version: next.number,
              label: next.title,
              status: "完成",
            },
          ],
          createdAt: now(),
          attempts: 1,
        });
      },
      {
        action: "确认采集新版本",
        object: comparingAsset.code,
        detail: `人工比较并确认 V${comparison.base} → V${versionNumber}；内容 ID ${comparingAsset.id} 不变，版本编号为现有最大值 + 1。历史正文、标签及审批快照保留；新版本审批待补充、解析排队。本地演示不进行网络采集。`,
        category: "内容",
      },
      "collect",
    );
    if (ok && taskId) {
      beginQueue(taskId);
      setComparison(undefined);
      toast(`已创建 V${versionNumber}，历史版本保留。请在新版本补充审批信息。`);
    }
  };
  const setAccountFilter = (value: string) => {
    setAccount(value);
    setPage(1);
  };
  const closeComparison = useCallback(() => setComparison(undefined), []);

  return (
    <div className="ops-page">
      <PageHeader
        eyebrow="ARTICLE COLLECTION"
        title="公众号采集"
        description="自动采集固定公众号，归档文章内容并跟进更新。"
      />
      <div className="collection-account-filter" aria-label="公众号筛选">
        <button
          className={account === "all" ? "active" : ""}
          onClick={() => setAccountFilter("all")}
        >
          全部公众号
        </button>
        {accounts.map((name) => (
          <button
            className={account === name ? "active" : ""}
            key={name}
            onClick={() => setAccountFilter(name)}
          >
            <Rss size={14} />
            {name}
          </button>
        ))}
        <span>固定账号 · 定期采集</span>
      </div>
      <section className="panel collection-article-panel">
        <div className="collection-article-toolbar">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="搜索文章标题或公众号"
          />
          <span>共 {rows.length} 篇文章</span>
        </div>
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table collection-article-table">
                <thead>
                  <tr>
                    <th>文章</th>
                    <th>公众号</th>
                    <th>采集时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice((pageNumber - 1) * 8, pageNumber * 8)
                    .map((article) => {
                      const asset = assetMap.get(article.assetId || "");
                      const v =
                        article.collectedVersion || (asset && current(asset));
                      return (
                        <tr key={article.id}>
                          <td>
                            <button
                              className="collection-article-title"
                              disabled={!v}
                              onClick={() => setPreviewId(article.id)}
                            >
                              {article.title}
                            </button>
                            {article.after ? (
                              <small className="collection-update-note">
                                {article.handled
                                  ? `更新已归档${asset ? ` · V${article.collectedVersion?.number || asset.current}` : ""}`
                                  : "有文章更新待确认"}
                              </small>
                            ) : null}
                          </td>
                          <td>
                            <span className="collection-account-name">
                              <Rss size={14} />
                              {article.account}
                            </span>
                          </td>
                          <td>
                            {dateLabel(
                              article.collectedAt || article.checkedAt,
                            )}
                          </td>
                          <td>
                            <div className="collection-row-actions">
                              {v ? (
                                <button
                                  className="text-link"
                                  onClick={() => setPreviewId(article.id)}
                                >
                                  预览文章
                                </button>
                              ) : (
                                <span className="muted">暂无正文</span>
                              )}
                              {article.after && asset ? (
                                <button
                                  className="text-link"
                                  onClick={() => openComparison(article)}
                                >
                                  {article.handled
                                    ? "查看更新记录"
                                    : "查看更新"}
                                </button>
                              ) : null}
                              {asset ? (
                                <button
                                  className="text-link"
                                  onClick={() => go(`content/${asset.id}`)}
                                >
                                  查看内容
                                </button>
                              ) : null}
                              {asset &&
                              current(asset).approval.mode === "pending" &&
                              can("edit") ? (
                                <button
                                  className="text-link"
                                  onClick={() => setApprovalIds([asset.id])}
                                >
                                  补充审批
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <Pagination
              total={rows.length}
              page={pageNumber}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title="暂无匹配的文章"
            description="调整公众号或搜索条件后再试。"
          />
        )}
      </section>
      {previewArticle && previewVersion ? (
        <Dialog
          wide
          title="文章预览"
          onClose={() => setPreviewId("")}
          footer={<Button onClick={() => setPreviewId("")}>关闭</Button>}
        >
          <ArticleBody version={previewVersion} />
        </Dialog>
      ) : null}
      {approvalIds.length ? (
        <ApprovalEditor
          assetIds={approvalIds}
          onClose={() => setApprovalIds([])}
        />
      ) : null}
      {comparison ? (
        <Dialog
          wide
          title="查看文章更新"
          onClose={closeComparison}
          footer={
            <>
              <Button onClick={() => setComparison(undefined)}>关闭</Button>
              <Button
                variant="primary"
                disabled={
                  !can("collect") ||
                  !comparingArticle ||
                  !comparingAsset ||
                  comparingArticle.handled
                }
                onClick={confirmVersion}
              >
                {comparingArticle?.handled
                  ? "更新已处理"
                  : changed
                    ? "确认创建新版本"
                    : "确认未变化"}
              </Button>
            </>
          }
        >
          {comparingArticle && comparingAsset ? (
            <>
              <div className="ops-row">
                <div>
                  <h3>{comparingArticle.title}</h3>
                  <p className="muted">
                    {comparingArticle.account} · {comparingAsset.code} · 当前 V
                    {comparingAsset.current}
                  </p>
                </div>
                <Badge>
                  {comparingArticle.handled
                    ? "已创建新版本"
                    : changed
                      ? "发现更新"
                      : "暂无更新"}
                </Badge>
              </div>
              <p className="muted">
                左右分别展示已归档文章和本次采集的完整文章，可独立滚动阅读。
                {comparingArticle.handled
                  ? "该更新已归档，可查看两版文章。"
                  : "确认后创建新版本。"}
              </p>
              <div className="ops-diff">
                <section>
                  <header>
                    <span className="ops-diff-dot ops-diff-before" />
                    已归档文章 · V{comparison.base}
                  </header>
                  <div className="article-comparison-scroll">
                    {previousArticle ? (
                      <ArticleBody version={previousArticle} />
                    ) : (
                      <p>暂无已归档文章</p>
                    )}
                  </div>
                </section>
                <section>
                  <header>
                    <span className="ops-diff-dot ops-diff-after" />
                    本次采集文章 ·{" "}
                    {comparingArticle.handled
                      ? `已归档 V${incomingArticle?.number || comparingAsset.current}`
                      : "待确认"}
                  </header>
                  <div className="article-comparison-scroll">
                    {incomingArticle ? (
                      <ArticleBody version={incomingArticle} />
                    ) : (
                      <p>暂无采集文章</p>
                    )}
                  </div>
                </section>
              </div>
              {changed && !comparingArticle.handled ? (
                <div className="ops-confirmation">
                  <strong>
                    创建 V
                    {Math.max(...comparingAsset.versions.map((v) => v.number)) +
                      1}
                    ，内容 ID 保持不变
                  </strong>
                  <p>
                    旧正文、标签和审批快照保持不变。新版本使用更新后的正文，审批为待补充，标签待重新识别，解析任务排队。
                  </p>
                  <label className="ops-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => {
                        setConfirmed(e.target.checked);
                        setComparisonError("");
                      }}
                    />
                    已核对变化，明确确认创建新版本并重新补充审批
                  </label>
                </div>
              ) : (
                <Note>未变化的检查仅更新检查时间，不新增内容或版本。</Note>
              )}
              {comparisonError ? (
                <div role="alert">
                  <Note tone="red">{comparisonError}</Note>
                </div>
              ) : null}
            </>
          ) : (
            <Empty
              title="关联记录不再可见"
              description="请关闭比较窗口，并从当前可见文章列表重新选择。"
            />
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
