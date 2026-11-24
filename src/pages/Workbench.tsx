import { visibleBatches, activeItem } from "../uploadReview";
import { PhaseTwoNote } from "../components/PhaseTwoNote";
import { useState } from "react";
import {
  ArrowUpRight,
  Plus,
  ShieldCheck,
  CalendarClock,
  FileWarning,
  ArrowRight,
  Send,
  CheckCircle2,
} from "lucide-react";
import { useCMS } from "../store";
import { current, go, dateLabel } from "../model";
import { Badge, Button, PageHeader, Empty, Pagination } from "../components/ui";
import { contentAttention, type AttentionCategory } from "../workbench";
export default function Workbench() {
  const { assets, state, role, can } = useCMS();
  const [category, setCategory] = useState<AttentionCategory | "all">("all"),
    [page, setPage] = useState(1);
  const contentAllowed = !!role?.menus.includes("library"),
    publishAllowed = !!role?.menus.includes("publishing");
  const attention = contentAllowed ? contentAttention(assets) : [];
  const visibleIds = new Set(assets.map((a) => a.id));
  const publications = publishAllowed
    ? (state.publications || []).filter((p) => visibleIds.has(p.assetId))
    : [];
  const failed = publications.filter((p) => p.status === "发布失败");
  const upcoming = publications
    .filter((p) => p.status === "待发布" && p.plannedAt)
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
    .slice(0, 4);
  const filtered =
    category === "all"
      ? attention
      : attention.filter((i) =>
          i.issues.some((issue) => issue.category === category),
        );
  const pendingUploads = visibleBatches(state).flatMap((b) =>
    b.items.filter(activeItem),
  );
  const cards = [
    {
      id: "approval" as const,
      name: "审批待补充",
      caption: "补充编号和截图，或选择无需登记",
      icon: ShieldCheck,
      tone: "blue",
    },
    {
      id: "processing" as const,
      name: "解析与标签异常",
      caption: "文件解析失败及推荐标签待处理",
      icon: FileWarning,
      tone: "rose",
    },
    {
      id: "expiry" as const,
      name: "30 天内到期或已过期",
      caption: "已过期及未来 30 天内到期的内容",
      icon: CalendarClock,
      tone: "amber",
    },
  ];
  function select(value: AttentionCategory | "all") {
    setCategory(value);
    setPage(1);
  }
  return (
    <div className="workbench-focused">
      <PageHeader
        title="工作台"
        action={
          can("upload") && contentAllowed ? (
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => go("upload")}
            >
              上传内容
            </Button>
          ) : undefined
        }
      />
      {contentAllowed && (can("upload") || (can("taxonomy") && can("tags"))) ? (
        <section className="panel workbench-pending">
          <div>
            <strong>
              待确认结果{" "}
              {pendingUploads.filter((i) => i.v.process === "完成").length} 份
            </strong>
            <p>
              另有{" "}
              {pendingUploads.filter((i) => i.v.process === "处理中").length}{" "}
              份解析中 ·{" "}
              {
                pendingUploads.filter(
                  (i) =>
                    i.v.process === "失败" ||
                    i.v.tagStatus === "失败" ||
                    i.archiveError,
                ).length
              }{" "}
              份异常需处理
            </p>
          </div>
          <Button onClick={() => go("library?tab=pending")}>
            处理待确认结果
          </Button>
        </section>
      ) : null}
      <div
        className={`queue-grid workbench-attention-grid ${!publishAllowed ? "without-publications" : ""}`}
      >
        {contentAllowed
          ? cards.map((item) => (
              <button
                key={item.id}
                aria-pressed={category === item.id}
                className={`queue-card queue-${item.tone} ${category === item.id ? "is-selected" : ""}`}
                onClick={() => select(category === item.id ? "all" : item.id)}
              >
                <div className="queue-top">
                  <span className="queue-icon">
                    <item.icon size={20} />
                  </span>
                  <ArrowUpRight size={15} />
                </div>
                <div className="queue-count">
                  {
                    attention.filter((i) =>
                      i.issues.some((issue) => issue.category === item.id),
                    ).length
                  }
                  <small>份内容</small>
                </div>
                <strong>{item.name}</strong>
              </button>
            ))
          : null}
        {publishAllowed ? (
          <button
            className="queue-card queue-cyan"
            onClick={() => go("publishing?status=发布失败")}
          >
            <div className="queue-top">
              <span className="queue-icon">
                <Send size={20} />
              </span>
              <ArrowUpRight size={15} />
            </div>
            <div className="queue-count">
              {failed.length}
              <small>条记录</small>
            </div>
            <strong>
              发布失败
              <PhaseTwoNote />
            </strong>
          </button>
        ) : null}
      </div>
      <div
        className={`workbench-columns ${!publishAllowed ? "workbench-one-column" : ""}`}
      >
        {contentAllowed ? (
          <section className="panel todo-panel">
            <div className="panel-heading">
              <div>
                <h2>
                  待处理内容{" "}
                  <span className="count-pill">{filtered.length}</span>
                </h2>
              </div>
              {category !== "all" ? (
                <Button variant="ghost" onClick={() => select("all")}>
                  显示全部
                </Button>
              ) : null}
            </div>
            {filtered.length ? (
              <>
                <div className="todo-list">
                  {filtered.slice((page - 1) * 6, page * 6).map((item) => {
                    const a = item.asset,
                      v = current(a),
                      target =
                        category === "all"
                          ? item.issues[0]
                          : item.issues.find((i) => i.category === category)!;
                    return (
                      <div className="todo-row" key={a.id}>
                        <span
                          className={`file-icon type-${v.kind === "PDF" ? "pdf" : "other"}`}
                        >
                          <small>{v.kind}</small>
                        </span>
                        <div className="todo-main">
                          <button
                            className="title-link"
                            onClick={() => go(`content/${a.id}`)}
                          >
                            {v.title}
                          </button>
                          <p>
                            {a.code} · V{v.number}.0
                          </p>
                          <div className="workbench-issue-tags">
                            {item.issues.map((issue) => (
                              <Badge
                                key={issue.category}
                                tone={
                                  issue.priority === 0
                                    ? "red"
                                    : issue.category === "expiry"
                                      ? "amber"
                                      : "blue"
                                }
                              >
                                {issue.label}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => go(target.route)}
                        >
                          去处理 <ArrowRight size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <Pagination
                  total={filtered.length}
                  page={page}
                  size={6}
                  onChange={setPage}
                />
              </>
            ) : (
              <Empty
                title="当前分类暂无待处理内容"
                description={
                  category === "all"
                    ? "需要补充、核对或重试的内容会显示在这里。"
                    : "可以切换分类，查看其他待处理内容。"
                }
                action={
                  <Button
                    onClick={() =>
                      category === "all" ? go("library") : select("all")
                    }
                  >
                    {category === "all" ? "进入内容库" : "查看全部分类"}
                  </Button>
                }
              />
            )}
          </section>
        ) : null}
        {publishAllowed ? (
          <aside className="panel workbench-schedule">
            <div className="panel-heading">
              <div>
                <h2>
                  近期发布
                  <PhaseTwoNote />
                </h2>
              </div>
              <CalendarClock size={19} />
            </div>
            {upcoming.length ? (
              upcoming.map((p) => (
                <button
                  className="workbench-schedule-item"
                  key={p.id}
                  onClick={() => go(`publishing?open=${p.id}`)}
                >
                  <small>
                    <CalendarClock size={13} />
                    {dateLabel(p.plannedAt)}
                  </small>
                  <strong>{p.title}</strong>
                  <span>
                    V{p.version}.0 <Badge>{p.status}</Badge>
                  </span>
                </button>
              ))
            ) : (
              <div className="workbench-schedule-empty">
                <CheckCircle2 size={27} />
                <p>暂无待发布安排</p>
              </div>
            )}
            <button className="task-bottom" onClick={() => go("publishing")}>
              进入发布管理
              <PhaseTwoNote /> <ArrowRight size={14} />
            </button>
          </aside>
        ) : null}
      </div>
      {!contentAllowed && !publishAllowed ? (
        <Empty
          title="当前角色暂无内容工作权限"
          description="可通过左侧菜单进入已授权的模块。"
        />
      ) : null}
    </div>
  );
}
