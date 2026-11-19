import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { seedState } from "./seed";
import {
  canRole,
  current,
  now,
  uid,
  visibleFor,
  type State,
  type Permission,
  type Audit,
  type Notice,
  type Task,
} from "./model";
const key = "hengrui-cms-state-v1";
type Log = {
  action: string;
  object: string;
  detail?: string;
  category?: Audit["category"];
};
interface API {
  state: State;
  user: State["users"][number] | undefined;
  role: State["roles"][number] | undefined;
  assets: State["assets"];
  can: (p: Permission) => boolean;
  update: (
    recipe: (draft: State) => void,
    log?: Log,
    permission?: Permission,
  ) => boolean;
  toast: (message: string) => void;
  notify: (notice: Omit<Notice, "id" | "read" | "at">) => void;
  retryTask: (id: string) => void;
  reprocess: (ids: string[], protect?: boolean) => void;
  addTask: (task: Omit<Task, "id" | "createdAt" | "attempts">) => string;
}
const Context = createContext<API | null>(null);
function initial() {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value = JSON.parse(raw);
      if (value.schema === 1 && Array.isArray(value.assets))
        return value as State;
    }
  } catch {}
  return seedState();
}
export function CMSProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const ref = useRef(state);
  ref.current = state;
  const [message, setMessage] = useState("");
  const toast = useCallback((text: string) => setMessage(text), []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(t);
  }, [message]);
  const update = useCallback(
    (recipe: (draft: State) => void, log?: Log, permission?: Permission) => {
      const before = ref.current;
      const person = before.users.find((u) => u.id === before.userId);
      const role = before.roles.find((r) => r.id === person?.roleId);
      if (permission && !canRole(role, permission)) {
        toast("当前角色没有执行此操作的权限。");
        return false;
      }
      const draft = structuredClone(before);
      recipe(draft);
      if (log)
        draft.audits.unshift({
          id: uid("log"),
          at: now(),
          user: person?.name || "演示登录",
          action: log.action,
          object: log.object,
          detail: log.detail || "",
          category: log.category || "内容",
        });
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        toast("浏览器存储空间不足，操作未保存。请导出已有内容后释放空间。");
        return false;
      }
      ref.current = draft;
      setState(draft);
      return true;
    },
    [toast],
  );
  const notify = useCallback(
    (notice: Omit<Notice, "id" | "read" | "at">) => {
      update((s) => {
        const existing = s.notices.find(
          (n) =>
            n.title === notice.title && n.route === notice.route && !n.read,
        );
        if (existing) {
          existing.detail = notice.detail;
          existing.at = now();
        } else
          s.notices.unshift({
            ...notice,
            id: uid("notice"),
            at: now(),
            read: false,
          });
      });
    },
    [update],
  );
  const addTask = useCallback(
    (task: Omit<Task, "id" | "createdAt" | "attempts">) => {
      const id = uid("task");
      update((s) =>
        s.tasks.unshift({ ...task, id, createdAt: now(), attempts: 1 }),
      );
      return id;
    },
    [update],
  );
  const user = state.users.find((u) => u.id === state.userId);
  const role = state.roles.find((r) => r.id === user?.roleId);
  const assets = visibleFor(state, user, role);
  const can = (p: Permission) => canRole(role, p);
  const retryTask = (id: string) => {
    const t = state.tasks.find((t) => t.id === id);
    if (!t) return;
    if (
      !can(
        t.type === "标签重跑" ? "rerun" : t.type === "导出" ? "export" : "edit",
      )
    )
      return toast("当前角色不能重试该任务。");
    if (t.type === "导出")
      return toast("请从导出窗口重新生成文件包，原错误已保留。");
    update(
      (s) => {
        const task = s.tasks.find((t) => t.id === id)!;
        task.status = "处理中";
        task.finishAt = Date.now() + 1800;
        task.attempts++;
        for (const item of task.items)
          if (item.status === "失败" || item.status === "部分失败") {
            item.status = "处理中";
            const a = s.assets.find((a) => a.id === item.assetId);
            const v = a?.versions.find((v) => v.number === item.version);
            if (v) {
              v.process = "处理中";
              v.tagStatus = "打标中";
            }
          }
      },
      {
        action: "重试失败任务",
        object: t.name,
        detail: "仅重新执行失败项，成功项保留。",
      },
    );
    toast("失败项正在重新处理。");
  };
  const reprocess = (ids: string[], protect = true) => {
    if (!can("rerun")) return toast("当前角色没有批量重跑权限。");
    const permitted = assets.filter((a) => ids.includes(a.id));
    const conflicts = protect
      ? permitted
          .flatMap((a) =>
            current(a)
              .tags.filter((t) => t.origin === "人工")
              .map((t) => ({
                assetId: a.id,
                version: a.current,
                tagId: t.tagId,
                proposedId:
                  state.tags.find(
                    (candidate) =>
                      candidate.enabled &&
                      candidate.id !== t.tagId &&
                      candidate.group ===
                        state.tags.find((tag) => tag.id === t.tagId)?.group,
                  )?.id || t.tagId,
              })),
          )
          .filter((conflict) => conflict.tagId !== conflict.proposedId)
      : [];
    update(
      (s) => {
        for (const a of s.assets.filter((a) =>
          permitted.some((p) => p.id === a.id),
        )) {
          const v = current(a);
          v.process = "处理中";
          v.tagStatus = "打标中";
          if (!protect) v.tags = v.tags.filter((t) => t.origin !== "人工");
        }
        s.tasks.unshift({
          id: uid("task"),
          name: `${permitted.length} 份内容 · 标签重跑`,
          type: "标签重跑",
          status: "处理中",
          items: permitted.map((a) => ({
            assetId: a.id,
            version: a.current,
            label: current(a).title,
            status: "处理中",
          })),
          conflicts,
          attempts: 1,
          createdAt: now(),
          finishAt: Date.now() + 2200,
        });
      },
      {
        action: "批量重跑标签",
        object: `${permitted.length} 份内容`,
        detail: protect
          ? "保护人工标签，冲突待人工处理。"
          : "已明确选择覆盖人工结果。",
        category: "标签",
      },
      "rerun",
    );
    toast("重跑任务已开始，可以离开页面。");
  };
  useEffect(() => {
    const timer = setInterval(() => {
      const due = ref.current.tasks.filter(
        (t) => t.finishAt && t.finishAt <= Date.now() && t.status === "处理中",
      );
      if (!due.length) return;
      update((s) => {
        for (const previous of due) {
          const task = s.tasks.find((t) => t.id === previous.id)!;
          task.finishAt = undefined;
          task.status = task.items.some(
            (i) => i.status === "失败" || i.status === "部分失败",
          )
            ? "部分失败"
            : "完成";
          for (const item of task.items) {
            if (item.status !== "处理中" && item.status !== "排队中") continue;
            item.status = "完成";
            item.error = undefined;
            const asset = s.assets.find((a) => a.id === item.assetId);
            const v = asset?.versions.find((v) => v.number === item.version);
            if (v && (task.type === "解析与打标" || task.type === "标签重跑")) {
              v.process = "完成";
              v.tagStatus = "已完成";
              v.unmatched = undefined;
              if (!v.tags.some((t) => t.origin === "AI" && !t.page))
                v.tags.push(
                  { tagId: "t3", origin: "AI" },
                  { tagId: "t5", origin: "AI" },
                );
            }
          }
          s.notices.unshift({
            id: uid("notice"),
            title: `${task.name}已完成`,
            detail: task.conflicts?.length
              ? `人工标签已保留，有 ${task.conflicts.length} 项差异可核对。`
              : "查看处理结果。",
            route: "tasks",
            read: false,
            at: now(),
          });
        }
      });
    }, 500);
    return () => clearInterval(timer);
  }, [update]);
  return (
    <Context.Provider
      value={{
        state,
        user,
        role,
        assets,
        can,
        update,
        toast,
        notify,
        retryTask,
        reprocess,
        addTask,
      }}
    >
      {children}
      {message ? (
        <div className="toast" role="status">
          <span className="toast-mark">✓</span>
          {message}
          <button aria-label="关闭提示" onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      ) : null}
    </Context.Provider>
  );
}
export function useCMS() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("CMSProvider required");
  return ctx;
}
