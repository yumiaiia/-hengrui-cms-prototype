import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  GitCompareArrows,
  RefreshCw,
  Rss,
  TriangleAlert,
} from "lucide-react";
import { useCMS } from "../store";
import {
  accounts,
  current,
  dateLabel,
  go,
  now,
  uid,
  visibleFor,
  type Article,
  type Asset,
  type State,
  type Task,
  type Version,
} from "../model";
import { makeDemoVersion } from "../seed";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Note,
  PageHeader,
  Pagination,
  SearchBox,
  Tabs,
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
function nextCode(state: State) {
  const maximum = state.assets.reduce(
    (max, asset) =>
      Math.max(max, Number(asset.code.match(/^CMS-(\d+)$/)?.[1]) || 0),
    0,
  );
  return `CMS-${String(maximum + 1).padStart(5, "0")}`;
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
  const [tab, setTab] = useState("articles");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [comparison, setComparison] = useState<{ id: string; base: number }>();
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
      if (!api.can("edit")) return;
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
        "edit",
      );
    }, 650);
    timers.current.add(timer);
  };
  useEffect(() => {
    const visibleIds = new Set(latest.current.assets.map((a) => a.id));
    if (latest.current.can("edit"))
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
  const failed = articles.filter((a) => a.status === "失败");
  const pending = assets.filter(
    (a) =>
      accounts.includes(current(a).source) &&
      current(a).approval.mode === "pending",
  );
  const rows = articles.filter(
    (a) =>
      (account === "all" || a.account === account) &&
      (filter === "all" || a.status === filter) &&
      `${a.title} ${a.account}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()) &&
      (tab !== "failures" || a.status === "失败"),
  );
  const pageNumber = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const collectionTasks = state.tasks
    .filter((t) => t.type === "采集" || t.name.startsWith(taskPrefix))
    .flatMap((t) => {
      const permittedItems = t.items.filter((item) =>
        item.assetId
          ? visibleIds.has(item.assetId)
          : articles.some((a) => !a.assetId && a.title === item.label),
      );
      const items = permittedItems.filter((item) => {
        const article = articles.find(
          (a) =>
            a.assetId === item.assetId ||
            (!a.assetId && a.title === item.label),
        );
        const source = item.assetId
          ? assetMap
              .get(item.assetId)
              ?.versions.find((v) => v.number === item.version)?.source
          : article?.account;
        return (
          (account === "all" || source === account) &&
          item.label
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
        );
      });
      return items.length
        ? [
            {
              task: t,
              items,
              completeScope: permittedItems.length === t.items.length,
            },
          ]
        : [];
    });
  const comparingArticle = articles.find((a) => a.id === comparison?.id);
  const comparingAsset = comparingArticle?.assetId
    ? assetMap.get(comparingArticle.assetId)
    : undefined;
  const before =
    comparingArticle?.before ||
    (comparingAsset ? current(comparingAsset).content.join("\n\n") : "");
  const after = comparingArticle?.after || "";
  const changed = !!after && before.trim() !== after.trim();

  const checkUnchanged = (id: string) => {
    if (!can("edit")) return toast("当前角色无本地采集操作权限。");
    const article = articles.find((a) => a.id === id);
    if (
      !article ||
      article.status === "失败" ||
      (article.status === "发现更新" && !article.handled)
    )
      return;
    const ok = update(
      (s) => {
        const record = s.articles.find((a) => a.id === id)!;
        record.checkedAt = now();
      },
      {
        action: "本地采集检查",
        object: article.title,
        detail:
          "本地演示结果：正文未变化，仅更新 checkedAt，不重复创建内容或版本。",
        category: "内容",
      },
      "edit",
    );
    if (ok) toast("本地检查完成：未发现新变化，仅更新检查时间。");
  };
  const retryArticle = (id: string) => {
    if (!user || !can("edit")) return toast("当前角色无本地采集重试权限。");
    const article = articles.find((a) => a.id === id);
    if (!article || article.status !== "失败") return;
    if (article.assetId)
      return toast(
        "该记录已有内容关联，请从处理记录重试对应失败任务，避免重复归档。",
      );
    let taskId = "";
    const ok = update(
      (s) => {
        const actor = s.users.find((u) => u.id === s.userId);
        const record = s.articles.find((a) => a.id === id)!;
        const permitted = new Set(
          visibleFor(
            s,
            actor,
            s.roles.find((r) => r.id === actor?.roleId),
          ).map((a) => a.id),
        );
        if (
          !actor ||
          !articleVisible(record, permitted) ||
          record.status !== "失败" ||
          record.assetId
        )
          return;
        const version: Version = {
          ...makeDemoVersion(8),
          title: record.title,
          source: record.account,
          sourcePublished: record.publishedAt,
          sourceUrl: undefined,
          fileName: `${record.title}.html`,
          fileKey: undefined,
          fileUrl: undefined,
          previewUrl: undefined,
          createdAt: now(),
          process: "排队中",
          tagStatus: "待打标",
          tags: [],
          approval: { mode: "pending" },
          expiry: undefined,
          changeNote: "本地采集重试：虚构文章示例，非真实网络获取。",
        };
        const asset: Asset = {
          id: uid("asset"),
          code: nextCode(s),
          ownerId: actor.id,
          current: 1,
          versions: [version],
          lifecycle: "正常",
          updatedAt: now(),
        };
        const task = queuedTask(asset);
        taskId = task.id;
        s.assets.unshift(asset);
        s.tasks.unshift(task);
        record.assetId = asset.id;
        record.status = "成功";
        record.checkedAt = now();
        record.error = undefined;
        record.handled = true;
        s.tasks.unshift({
          id: uid("collection-task"),
          name: `${taskPrefix}重试采集`,
          type: "采集",
          status: "完成",
          items: [
            {
              assetId: asset.id,
              version: 1,
              label: record.title,
              status: "完成",
            },
          ],
          createdAt: now(),
          attempts: 2,
        });
      },
      {
        action: "重试本地采集",
        object: article.title,
        detail: `本地演示结果：使用 makeDemoVersion(8) 的虚构正文归档，所属账号 ${article.account}。创建稳定内容 ID、V1、待补充审批和排队解析任务；未进行 HTTP 采集。原失败信息：${article.error || "未记录"}。`,
        category: "内容",
      },
      "edit",
    );
    if (ok && taskId) {
      beginQueue(taskId);
      toast("本地重试成功：示例正文已归档，审批待补充，解析任务已排队。");
    }
  };
  const openComparison = (article: Article) => {
    const asset = article.assetId ? assetMap.get(article.assetId) : undefined;
    if (!asset) return toast("关联内容不在当前可见范围内。");
    setComparison({ id: article.id, base: asset.current });
    setConfirmed(false);
    setComparisonError("");
  };
  const confirmVersion = () => {
    if (!comparison || !comparingArticle || !comparingAsset || !can("edit"))
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
        "edit",
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
      "edit",
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
        description="固定四个账号，按文章检查结果归档内容；发现变化后由人工决定是否创建新版本。"
        action={
          <Button
            icon={<ArrowRight size={16} />}
            onClick={() => go("library?approval=pending")}
          >
            待补充审批 <span className="ops-count">{pending.length}</span>
          </Button>
        }
      />
      <Note>
        <strong>本地采集演示</strong> · 此页面不连接公众号，也不进行实际 HTTP
        抓取。重试使用虚构样例正文，检查与变化对比仅用于验证归档流程。未关联内容的样例记录对当前角色开放，关联结果仅按内容可见范围展示。
      </Note>
      <div className="ops-accounts">
        {accounts.map((name, i) => {
          const records = articles.filter((a) => a.account === name);
          const failureCount = records.filter(
            (a) => a.status === "失败",
          ).length;
          const changeCount = records.filter(
            (a) => a.status === "发现更新" && !a.handled,
          ).length;
          return (
            <button
              className={`ops-account-card ${account === name ? "is-active" : ""}`}
              key={name}
              onClick={() => setAccountFilter(account === name ? "all" : name)}
              aria-pressed={account === name}
            >
              <div className="ops-row">
                <span className={`ops-account-avatar ops-account-${i}`}>
                  <Rss size={20} />
                </span>
                <Badge
                  tone={failureCount ? "red" : changeCount ? "amber" : "green"}
                >
                  {failureCount
                    ? "有失败记录"
                    : changeCount
                      ? "发现更新"
                      : records.length
                        ? "检查正常"
                        : "暂无可见记录"}
                </Badge>
              </div>
              <h3>{name}</h3>
              <div className="ops-account-metrics">
                <span>
                  <strong>{records.length}</strong> 可见文章
                </span>
                <span className="muted">
                  {changeCount} 更新 · {failureCount} 失败
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <section className="panel">
        <Tabs
          items={[
            { key: "articles", label: "文章列表", count: articles.length },
            {
              key: "records",
              label: "处理记录",
              count: collectionTasks.length,
            },
            { key: "failures", label: "采集失败", count: failed.length },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
            setFilter("all");
          }}
        />
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="搜索文章标题或账号"
          />
          <select
            className="select"
            aria-label="筛选公众号"
            value={account}
            onChange={(e) => setAccountFilter(e.target.value)}
          >
            <option value="all">全部四个账号</option>
            {accounts.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          {tab === "articles" ? (
            <select
              className="select"
              aria-label="筛选文章检查结果"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">全部检查结果</option>
              <option>成功</option>
              <option>失败</option>
              <option>发现更新</option>
              <option>未变化</option>
            </select>
          ) : null}
          <span className="muted ops-caption">固定账号 · 无账号或频率配置</span>
        </div>
        {tab === "records" ? (
          collectionTasks.length ? (
            <div className="ops-task-list">
              {collectionTasks.map(({ task, items, completeScope }) => (
                <article className="ops-task-card" key={task.id}>
                  <div className="ops-row">
                    <div>
                      <h3>
                        {completeScope
                          ? task.name
                          : `本地采集 · ${items.length} 份可见内容`}
                      </h3>
                      <p className="muted ops-caption">
                        {dateLabel(task.createdAt)} · 尝试 {task.attempts} 次 ·{" "}
                        {task.type}
                      </p>
                    </div>
                    <Badge>{task.status}</Badge>
                  </div>
                  <div className="ops-task-items">
                    {items.map((item, index) => (
                      <div
                        className="ops-row"
                        key={`${item.assetId || index}:${item.version}`}
                      >
                        <div>
                          {item.assetId && visibleIds.has(item.assetId) ? (
                            <button
                              className="text-link"
                              onClick={() =>
                                go(
                                  `content/${item.assetId}?version=${item.version}`,
                                )
                              }
                            >
                              {item.label} · V{item.version}
                            </button>
                          ) : (
                            <span>{item.label}</span>
                          )}
                          {item.error ? (
                            <p className="ops-danger-text ops-caption">
                              {item.error}
                            </p>
                          ) : null}
                        </div>
                        <Badge>{item.status}</Badge>
                      </div>
                    ))}
                  </div>
                  {items.some(
                    (item) =>
                      item.status === "失败" || item.status === "部分失败",
                  ) ? (
                    <div className="actions">
                      <Button
                        disabled={!can("edit") || !completeScope}
                        icon={<RefreshCw size={15} />}
                        onClick={() => {
                          if (completeScope && can("edit"))
                            cms.retryTask(task.id);
                        }}
                      >
                        仅重试失败处理项
                      </Button>
                      {!completeScope ? (
                        <span className="muted ops-caption">
                          包含不可见项，请由有完整范围权限的人员重试。
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="暂无可见处理记录"
              description="重试失败的本地采集样例，或确认文章更新后，这里会展示采集结果和解析进度。"
            />
          )
        ) : rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>文章 / 账号</th>
                    <th>文章日期</th>
                    <th>最近检查</th>
                    <th>检查结果</th>
                    <th>归档 / 审批</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice((pageNumber - 1) * 8, pageNumber * 8)
                    .map((article) => {
                      const asset = article.assetId
                        ? assetMap.get(article.assetId)
                        : undefined;
                      const v = asset ? current(asset) : undefined;
                      return (
                        <tr key={article.id}>
                          <td>
                            <strong>{article.title}</strong>
                            <p className="muted ops-caption">
                              {article.account}
                            </p>
                            {article.error ? (
                              <p className="ops-danger-text ops-caption">
                                <TriangleAlert size={13} /> {article.error}
                              </p>
                            ) : null}
                          </td>
                          <td>{article.publishedAt}</td>
                          <td>{dateLabel(article.checkedAt)}</td>
                          <td>
                            <Badge>{article.status}</Badge>
                            {article.handled && article.before ? (
                              <p className="muted ops-caption">
                                变化已人工确认
                              </p>
                            ) : null}
                          </td>
                          <td>
                            {asset && v ? (
                              <>
                                <button
                                  className="text-link ops-code"
                                  onClick={() => go(`content/${asset.id}`)}
                                >
                                  {asset.code} · V{asset.current}
                                </button>
                                <div>
                                  <Badge>
                                    {v.approval.mode === "pending"
                                      ? "待补充审批"
                                      : v.approval.mode === "exempt"
                                        ? "免登记"
                                        : "已登记"}
                                  </Badge>
                                </div>
                              </>
                            ) : (
                              <span className="muted">尚未归档</span>
                            )}
                          </td>
                          <td>
                            <div className="ops-table-actions">
                              {article.status === "失败" ? (
                                <Button
                                  disabled={!can("edit")}
                                  icon={<RefreshCw size={15} />}
                                  onClick={() => retryArticle(article.id)}
                                >
                                  重试本地采集
                                </Button>
                              ) : article.status === "发现更新" &&
                                !article.handled ? (
                                <Button
                                  icon={<GitCompareArrows size={15} />}
                                  onClick={() => openComparison(article)}
                                >
                                  比较变化
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  disabled={!can("edit")}
                                  icon={<Check size={15} />}
                                  onClick={() => checkUnchanged(article.id)}
                                >
                                  检查未变化
                                </Button>
                              )}
                              {asset && v?.approval.mode === "pending" ? (
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    go(`content/${asset.id}?tab=approval`)
                                  }
                                >
                                  补充审批 <ArrowRight size={14} />
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
            <Pagination
              total={rows.length}
              page={pageNumber}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title={
              tab === "failures" ? "当前范围没有采集失败" : "没有匹配的文章"
            }
            description="切换账号或调整搜索条件。只展示当前可见内容的关联记录。"
          />
        )}
      </section>
      {comparison ? (
        <Dialog
          wide
          title="比较文章变化"
          onClose={closeComparison}
          footer={
            <>
              <Button onClick={() => setComparison(undefined)}>取消</Button>
              <Button
                variant="primary"
                disabled={
                  !can("edit") ||
                  !comparingArticle ||
                  !comparingAsset ||
                  comparingArticle.handled
                }
                onClick={confirmVersion}
              >
                {changed ? "确认创建新版本" : "确认未变化"}
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
                <Badge>{changed ? "正文发生变化" : "正文未变化"}</Badge>
              </div>
              <Note>
                本地采集演示：以下为预设样例的前后正文对比，不代表真实公众号更新。仅点击“确认创建新版本”后归档变化。
              </Note>
              <div className="ops-diff">
                <section>
                  <header>
                    <span className="ops-diff-dot ops-diff-before" />
                    更新前 · V{comparison.base}
                  </header>
                  <p>{before || "无旧正文"}</p>
                </section>
                <section>
                  <header>
                    <span className="ops-diff-dot ops-diff-after" />
                    更新后 · 待确认
                  </header>
                  <p>{after || "未提供新正文"}</p>
                </section>
              </div>
              {changed ? (
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
