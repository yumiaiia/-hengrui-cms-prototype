import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  FolderOpen,
  Radio,
  Tags,
  Settings2,
  Bell,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  HelpCircle,
  ArrowUpRight,
  X,
  Send,
  CheckCheck,
} from "lucide-react";
import { useCMS } from "../store";
import { go, dateLabel } from "../model";
import { Dialog, Badge, Button, Empty } from "./ui";
const menu = [
  { id: "workbench", name: "工作台", icon: LayoutDashboard },
  { id: "library", name: "内容库", icon: FolderOpen },
  { id: "publishing", name: "发布管理", icon: Send },
  { id: "collection", name: "公众号采集", icon: Radio },
  { id: "tags", name: "标签管理", icon: Tags },
  { id: "admin", name: "系统管理", icon: Settings2 },
];
export default function Shell({
  children,
  route,
}: {
  children: ReactNode;
  route: string;
}) {
  const { state, user, role, update, assets } = useCMS();
  const [collapsed, setCollapsed] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const notices = state.notices.filter(
    (n) => !n.adminOnly || role?.permissions.includes("admin"),
  );
  const unread = notices.filter((n) => !n.read).length;
  const active =
    route === "content" || route === "upload"
      ? "library"
      : route === "publication-preview"
        ? "publishing"
        : route;
  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#/workbench"
          onClick={(e) => {
            e.preventDefault();
            go(
              role?.menus.includes("workbench")
                ? "workbench"
                : role?.menus[0] || "workbench",
            );
          }}
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name">恒瑞 CMS</span>
        </a>
        <div className="workspace-label">
          工作空间 <span>恒瑞医药</span>
        </div>
        <nav>
          {menu
            .filter((m) => role?.menus.includes(m.id))
            .map((m) => (
              <button
                key={m.id}
                title={collapsed ? m.name : undefined}
                className={`nav-item ${active === m.id ? "active" : ""}`}
                onClick={() => go(m.id)}
              >
                <m.icon size={19} strokeWidth={1.7} />
                <span>{m.name}</span>
                {m.id === "library" ? <b>{assets.length}</b> : null}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setHelp(true)}>
            <HelpCircle size={19} />
            <span>帮助中心</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-session">
            <span className="avatar avatar-dark">{user?.name.slice(0, 1)}</span>
            <span>
              {user?.name}
              <small>{role?.name}</small>
            </span>
            <span className="online-dot" />
          </div>
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "展开导航" : "收起导航"}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
            <span>收起导航</span>
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span>
            <strong>
              {menu.find((m) => m.id === active)?.name || "内容管理"}
            </strong>
          </div>
          <button
            className={`icon-btn top-icon ${noticeOpen ? "is-active" : ""}`}
            aria-label="消息通知"
            onClick={() => setNoticeOpen(!noticeOpen)}
          >
            <Bell size={19} />
            {unread ? <i className="notification-dot" /> : null}
          </button>
          <div className="profile-area">
            <button
              className="profile-button"
              onClick={() => setProfile(!profile)}
              aria-label="个人账号"
            >
              <span className="avatar">{user?.name.slice(0, 1)}</span>
              <ChevronDown size={14} />
            </button>
            {profile ? (
              <div className="profile-menu">
                <strong>{user?.name}</strong>
                <small>{role?.name}</small>
                <Button
                  variant="ghost"
                  icon={<LogOut size={15} />}
                  onClick={() => {
                    update(
                      (s) => {
                        s.userId = null;
                      },
                      {
                        action: "退出演示账号",
                        object: user?.account || "",
                        category: "系统",
                      },
                    );
                    go("login");
                  }}
                >
                  退出账号
                </Button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="page-content" key={route}>
          {children}
        </main>
      </div>
      {noticeOpen ? (
        <div className="notice-panel">
          <div className="section-heading">
            <h3>
              消息通知 <span>{unread} 条未读</span>
            </h3>
            <button
              className="icon-btn"
              aria-label="关闭通知"
              onClick={() => setNoticeOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <button
            className="text-link"
            onClick={() =>
              update((s) =>
                s.notices.forEach((n) => {
                  if (!n.adminOnly || role?.permissions.includes("admin"))
                    n.read = true;
                }),
              )
            }
          >
            <CheckCheck size={15} />
            全部标为已读
          </button>
          <div className="notice-list">
            {notices.length ? (
              notices.map((n) => (
                <button
                  key={n.id}
                  className={`notice-item ${n.read ? "" : "unread"}`}
                  onClick={() => {
                    update((s) => {
                      s.notices.find((i) => i.id === n.id)!.read = true;
                    });
                    go(n.route);
                    setNoticeOpen(false);
                  }}
                >
                  <span className="notice-item-dot" />
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.detail}</p>
                    <small>{dateLabel(n.at)}</small>
                  </div>
                </button>
              ))
            ) : (
              <Empty
                title="暂时没有通知"
                description="处理完成和需要核对的事项会显示在这里。"
              />
            )}
          </div>
        </div>
      ) : null}
      {help ? (
        <Dialog title="帮助中心" onClose={() => setHelp(false)} wide>
          <div className="help-grid">
            <section>
              <Badge tone="blue">内容管理</Badge>
              <h3>添加内容与审批登记</h3>
              <p>
                为本次所有文件统一选择审批规则。需要登记时只上传一张截图，填写一次编号和有效期；识别有差异时可人工核对后继续。
              </p>
            </section>
            <section>
              <Badge tone="green">后台处理</Badge>
              <h3>归档后继续工作</h3>
              <p>
                原文件保存后即归档，解析和打标在后台进行。失败项可在内容详情单独重试，正常标签无需逐条确认。
              </p>
            </section>
            <section>
              <Badge tone="amber">版本与有效期</Badge>
              <h3>旧版本始终可追溯</h3>
              <p>
                新版本归档后成为当前版本。到期前 30
                个自然日提醒，到期仅标记，不自动下架。
              </p>
            </section>
            <section>
              <Badge tone="gray">原型说明</Badge>
              <h3>本地演示与真实文件</h3>
              <p>
                示例资料为虚构数据。OCR、AI、采集、SSO
                为模拟流程；上传的原文件保存在当前浏览器，可实际下载和预览支持的格式。
              </p>
            </section>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
