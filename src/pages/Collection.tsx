import { articleSource, articleSourceUrl } from "../collectionSources";
import {
  collectedArticles,
  collectedBody,
  collectionRecords,
  collectionStatus,
  enqueueCollection,
  pendingCollectionTasks,
} from "../collection";
import { useState } from "react";
import { Copy, Rss, Plus } from "lucide-react";
import { ApprovalEditor } from "../components/ApprovalEditor";
import { ArticleBody } from "../components/ArticleBody";
import { useCMS } from "../store";
import { accounts, current, dateLabel, go, safePublicUrl } from "../model";
import {
  Button,
  Badge,
  Dialog,
  Empty,
  PageHeader,
  Pagination,
  SearchBox,
} from "../components/ui";
import "./operations.css";
export default function Collection() {
  const { state, assets, can, update, toast } = useCMS();
  const [manualOpen, setManualOpen] = useState(false);
  const [chosenAccounts, setChosenAccounts] = useState<string[]>([]);
  const [manualError, setManualError] = useState("");
  const busyAccounts = new Set(
    pendingCollectionTasks(state).map((task) => task.collection!.account),
  );
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const [tab, setTab] = useState(
    params.get("tab") === "executions" ? "executions" : "articles",
  );
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
  const executions = collectionRecords(state.tasks, account);
  const total = tab === "articles" ? rows.length : executions.length;
  const active = Math.min(page, Math.max(1, Math.ceil(total / 8)));
  function changeView(nextTab: string, nextAccount = account) {
    setTab(nextTab);
    setAccount(nextAccount);
    setPage(1);
    const query = new URLSearchParams({ tab: nextTab, account: nextAccount });
    history.replaceState(null, "", "#/collection?" + query.toString());
  }
  function submitCollection() {
    let error = "";
    const saved = update(
      (draft) => {
        try {
          enqueueCollection(draft, chosenAccounts);
        } catch (cause) {
          error = cause instanceof Error ? cause.message : "创建采集任务失败";
        }
      },
      undefined,
      "edit",
    );
    if (error) return setManualError(error);
    if (!saved) return;
    setManualOpen(false);
    changeView("executions", "all");
    toast("已创建 " + chosenAccounts.length + " 个采集任务");
  }
  return (
    <div className="collection-page">
      <PageHeader
        title="公众号采集"
        action={
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            disabled={!can("edit")}
            onClick={() => {
              setChosenAccounts(
                account !== "all" && !busyAccounts.has(account)
                  ? [account]
                  : [],
              );
              setManualError("");
              setManualOpen(true);
            }}
          >
            手动采集
          </Button>
        }
      />
      <div className="collection-account-filter">
        {["all", ...accounts].map((name) => (
          <button
            key={name}
            className={account === name ? "active" : ""}
            aria-pressed={account === name}
            onClick={() => changeView(tab, name)}
          >
            {name === "all" ? "全部公众号" : name}
          </button>
        ))}
      </div>
      <section className="panel collection-article-panel">
        <div
          className="tabs collection-tabs"
          role="tablist"
          aria-label="公众号采集视图"
        >
          {[
            { id: "articles", name: "采集文章" },
            { id: "executions", name: "执行记录" },
          ].map((item, index) => (
            <button
              key={item.id}
              id={"collection-tab-" + item.id}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={"collection-panel-" + item.id}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? "active" : ""}
              onClick={() => changeView(item.id)}
              onKeyDown={(event) => {
                const target =
                  event.key === "Home"
                    ? "articles"
                    : event.key === "End"
                      ? "executions"
                      : event.key === "ArrowLeft" || event.key === "ArrowRight"
                        ? index === 0
                          ? "executions"
                          : "articles"
                        : undefined;
                if (!target) return;
                event.preventDefault();
                changeView(target);
                document.getElementById("collection-tab-" + target)?.focus();
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div
          id={"collection-panel-" + tab}
          role="tabpanel"
          aria-labelledby={"collection-tab-" + tab}
        >
          {tab === "articles" ? (
            <>
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
                        {rows
                          .slice((active - 1) * 8, active * 8)
                          .map((article) => {
                            const linked = assets.find(
                                (a) => a.id === article.assetId,
                              ),
                              v = collectedBody(article, linked);
                            const source = articleSource(article, linked);
                            const url = articleSourceUrl(
                              source,
                              location.origin,
                            );
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
                                        onClick={() =>
                                          go(`content/${linked.id}`)
                                        }
                                      >
                                        查看内容
                                      </Button>
                                    ) : null}
                                    {linked &&
                                    current(linked).approval.mode ===
                                      "pending" &&
                                    can("edit") ? (
                                      <Button
                                        variant="ghost"
                                        onClick={() =>
                                          setApprovalIds([linked.id])
                                        }
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
            </>
          ) : executions.length ? (
            <div className="table-wrap">
              <table className="data-table collection-execution-table">
                <thead>
                  <tr>
                    <th>任务编号</th>
                    <th>触发方式</th>
                    <th>开始时间</th>
                    <th>执行状态</th>
                    <th>新增文章</th>
                  </tr>
                </thead>
                <tbody>
                  {executions
                    .slice((active - 1) * 8, active * 8)
                    .map((task) => {
                      const run = task.collection!;
                      const status = collectionStatus(task);
                      return (
                        <tr key={task.id}>
                          <td>
                            <span className="collection-task-number">
                              {run.number}
                            </span>
                            {account === "all" ? (
                              <small className="collection-task-account">
                                {run.account}
                              </small>
                            ) : null}
                          </td>
                          <td>{run.trigger}</td>
                          <td>
                            {run.startedAt ? (
                              <time dateTime={run.startedAt}>
                                {new Intl.DateTimeFormat("sv-SE", {
                                  timeZone: "Asia/Shanghai",
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                  hour12: false,
                                }).format(new Date(run.startedAt))}
                              </time>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <Badge
                              tone={
                                status === "等待执行"
                                  ? "gray"
                                  : status === "执行中"
                                    ? "blue"
                                    : status === "已完成"
                                      ? "green"
                                      : "red"
                              }
                            >
                              {status}
                            </Badge>
                          </td>
                          <td>
                            {run.addedArticles > 0
                              ? "新增文章 " + run.addedArticles + " 篇"
                              : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="暂无执行记录" />
          )}
          {total > 0 ? (
            <Pagination total={total} page={active} onChange={setPage} />
          ) : null}
        </div>
      </section>
      {manualOpen ? (
        <Dialog
          title="手动采集"
          onClose={() => setManualOpen(false)}
          footer={
            <>
              <Button onClick={() => setManualOpen(false)}>取消</Button>
              <Button
                variant="primary"
                disabled={!can("edit") || !chosenAccounts.length}
                onClick={submitCollection}
              >
                加入队列
              </Button>
            </>
          }
        >
          <fieldset className="collection-account-picker">
            <legend>选择公众号</legend>
            {accounts.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={chosenAccounts.includes(name)}
                  disabled={busyAccounts.has(name)}
                  onChange={(event) => {
                    setManualError("");
                    setChosenAccounts((selected) =>
                      event.target.checked
                        ? [...selected, name]
                        : selected.filter((item) => item !== name),
                    );
                  }}
                />
                <span>{name}</span>
                {busyAccounts.has(name) ? <small>已有未结束任务</small> : null}
              </label>
            ))}
          </fieldset>
          {manualError ? (
            <p className="error-text" role="alert">
              {manualError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
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
