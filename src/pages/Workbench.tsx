import {
  ArrowUpRight,
  Plus,
  ShieldCheck,
  Tag,
  CalendarClock,
  FileWarning,
  Clock3,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
} from "lucide-react";
import { useCMS } from "../store";
import { current, expiryStatus, go, dateLabel } from "../model";
import { AssetImage, Badge, Button, PageHeader, Empty } from "../components/ui";
export default function Workbench() {
  const { assets: allAssets, state, user, can } = useCMS();
  const assets = allAssets.filter((a) => a.lifecycle === "正常");
  const pending = assets.filter((a) => current(a).approval.mode === "pending");
  const unmatched = assets.filter((a) => current(a).tagStatus === "未匹配");
  const expiring = assets.filter(
    (a) => expiryStatus(current(a)) === "即将过期",
  );
  const failures = assets.filter((a) =>
    ["失败", "部分失败"].includes(current(a).process),
  );
  const items = [
    {
      name: "审批信息待补充",
      count: pending.length,
      icon: ShieldCheck,
      tone: "blue",
      route: "library?approval=pending",
      caption: "选择凭证或免登记",
    },
    {
      name: "标签未匹配",
      count: unmatched.length,
      icon: Tag,
      tone: "cyan",
      route: "library?tagStatus=未匹配",
      caption: "核对标签与原文",
    },
    {
      name: "即将过期",
      count: expiring.length,
      icon: CalendarClock,
      tone: "amber",
      route: "library?expiry=即将过期",
      caption: "未来 30 天内到期",
    },
    {
      name: "处理异常",
      count: failures.length,
      icon: FileWarning,
      tone: "rose",
      route: "library?process=异常",
      caption: "查看原因并重试",
    },
  ];
  const todo = [
    ...pending.map((a) => ({
      a,
      reason: "补充审批信息",
      badge: "待补充",
      tab: "approval",
    })),
    ...unmatched.map((a) => ({
      a,
      reason: "核对未匹配标签",
      badge: "未匹配",
      tab: "tags",
    })),
    ...failures.map((a) => ({
      a,
      reason: "查看处理失败原因",
      badge: "处理失败",
      tab: "basic",
    })),
  ];
  const visible = new Set(assets.map((a) => a.id));
  const tasks = state.tasks
    .filter(
      (t) =>
        t.items.length > 0 &&
        t.items.every((i) => i.assetId && visible.has(i.assetId)),
    )
    .slice(0, 3);
  return (
    <>
      <PageHeader
        eyebrow="工作空间 / OVERVIEW"
        title={`${new Date().getHours() < 12 ? "上午好" : new Date().getHours() < 18 ? "下午好" : "晚上好"}，${user?.name || "欢迎回来"}`}
        description="让每一份内容，都有清晰的来处与去向。"
        action={
          can("upload") ? (
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() => go("upload")}
            >
              新增内容
            </Button>
          ) : null
        }
      />
      <div className="workspace-intro">
        <span>
          <i />
          内容工作空间
        </span>
        <small>
          {new Date().toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </small>
      </div>
      <div className="queue-grid">
        {items.map((item) => (
          <button
            key={item.name}
            className={`queue-card queue-${item.tone}`}
            onClick={() => go(item.route)}
          >
            <div className="queue-top">
              <span className="queue-icon">
                <item.icon size={21} strokeWidth={1.7} />
              </span>
              <ArrowUpRight size={16} />
            </div>
            <div className="queue-count">
              {item.count}
              <small>份内容</small>
            </div>
            <strong>{item.name}</strong>
            <p>{item.caption}</p>
          </button>
        ))}
      </div>
      <div className="workbench-columns">
        <section className="panel todo-panel">
          <div className="panel-heading">
            <div>
              <h2>
                待处理事项 <span className="count-pill">{todo.length}</span>
              </h2>
              <p>从需要你关注的内容开始</p>
            </div>
            <Button variant="ghost" onClick={() => go("library")}>
              查看全部
              <ArrowRight size={15} />
            </Button>
          </div>
          {todo.length ? (
            <div className="todo-list">
              {todo.slice(0, 5).map((item, i) => (
                <div className="todo-row" key={item.a.id + item.reason}>
                  <span
                    className={`file-icon type-${current(item.a).kind === "PDF" ? "pdf" : "other"}`}
                  >
                    {current(item.a).kind === "PDF" ? "PDF" : "DOC"}
                  </span>
                  <div className="todo-main">
                    <strong>{current(item.a).title}</strong>
                    <p>
                      {item.reason}
                      <span>· {item.a.code}</span>
                    </p>
                  </div>
                  <Badge>{item.badge}</Badge>
                  <button
                    className="round-arrow"
                    aria-label={`处理${current(item.a).title}`}
                    onClick={() => go(`content/${item.a.id}?tab=${item.tab}`)}
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="全部工作已处理"
              description="没有需要处理的事项，可以继续添加内容。"
              action={<Button onClick={() => go("library")}>查看内容库</Button>}
            />
          )}
        </section>
        <section className="panel task-preview">
          <div className="panel-heading">
            <div>
              <h2>处理动态</h2>
              <p>后台任务，无需停留等待</p>
            </div>
            <Clock3 size={18} className="muted" />
          </div>
          {tasks.map((task) => (
            <button
              key={task.id}
              className="mini-task"
              onClick={() => go("tasks")}
            >
              <span
                className={`task-timeline-dot ${task.status === "完成" ? "success" : ""}`}
              />
              <div>
                <strong>{task.name}</strong>
                <small>{dateLabel(task.createdAt)}</small>
                <Badge>{task.status}</Badge>
              </div>
            </button>
          ))}
          {!tasks.length ? (
            <p className="muted empty-small">暂时没有处理任务</p>
          ) : null}
          <button className="task-bottom" onClick={() => go("tasks")}>
            打开任务中心
            <ArrowRight size={15} />
          </button>
          <div className="quiet-note">
            <CheckCircle2 size={15} />
            原文件已归档，AI 处理独立进行
          </div>
        </section>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <div>
            <h2>最近的内容</h2>
            <p>继续查看或维护你的内容资产</p>
          </div>
          <Button variant="ghost" onClick={() => go("library")}>
            进入内容库
            <ArrowRight size={15} />
          </Button>
        </div>
        <div className="recent-grid">
          {[...assets]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 4)
            .map((a) => {
              const v = current(a);
              return (
                <button
                  className="recent-card"
                  key={a.id}
                  onClick={() => go("content/" + a.id)}
                >
                  <div className="recent-cover">
                    {v.cover ? (
                      <AssetImage src={v.cover} alt="内容封面" />
                    ) : (
                      <FolderOpen size={36} />
                    )}
                    <span>{v.kind}</span>
                  </div>
                  <div className="recent-body">
                    <h3>{v.title}</h3>
                    <div>
                      <small>
                        {a.code} · V{a.current}.0
                      </small>
                      <Badge>{expiryStatus(v)}</Badge>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </section>
    </>
  );
}
