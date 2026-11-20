import { prepareSimplification } from "./simplification";
import { advanceTagMatching, retryTagMatching } from "./tagMatching";
import { prepareRecommendations } from "./recommendations";
import { prepareAdministration } from "./administration";
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
import { migrateState } from "./migration";
import { prepareWorkspace } from "./workflow";
import { availableTag } from "./taxonomy";
import {
  canRole,
  primaryTagId,
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
  addTask: (task: Omit<Task, "id" | "createdAt" | "attempts">) => string;
}
const Context = createContext<API | null>(null);
let loadFailure = "";
function initial() {
  loadFailure = "";
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const original = JSON.parse(raw);
      const migrated = prepareSimplification(
        prepareRecommendations(
          prepareAdministration(prepareWorkspace(migrateState(original))),
        ),
      );
      if (original.schema === 1) {
        if (!localStorage.getItem(key + "-schema1-backup"))
          localStorage.setItem(key + "-schema1-backup", raw);
      }
      if (JSON.stringify(migrated) !== raw)
        localStorage.setItem(key, JSON.stringify(migrated));
      return migrated;
    }
  } catch (error) {
    loadFailure = error instanceof Error ? error.message : "原型数据无法读取";
  }
  return prepareSimplification(
    prepareRecommendations(
      prepareAdministration(prepareWorkspace(seedState())),
    ),
  );
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
      if (loadFailure) return false;
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
    if (t.type === "标签匹配") {
      update((s) => retryTagMatching(s, id));
      return;
    }
    if (!can(t.type === "导出" ? "export" : "edit"))
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
              if (v.pageStates)
                for (const page of Object.values(v.pageStates))
                  if (page.status === "失败") page.status = "打标中";
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
  useEffect(() => {
    const timer = setInterval(() => {
      const due = ref.current.tasks.filter(
        (t) => t.finishAt && t.finishAt <= Date.now() && t.status === "处理中",
      );
      if (!due.length) return;
      update((s) => {
        for (const previous of due) {
          const task = s.tasks.find((t) => t.id === previous.id)!;
          if (task.type === "标签匹配") {
            advanceTagMatching(s, task);
            continue;
          }
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
            if (v && task.type === "解析与打标") {
              if (task.type === "解析与打标") v.process = "完成";
              v.tagStatus = "已完成";
              if (!v.pageStates && ["PDF", "PPT", "Word"].includes(v.kind))
                v.pageStates = Object.fromEntries(
                  Array.from({ length: v.pages }, (_, i) => [
                    i + 1,
                    { status: "完成" },
                  ]),
                );
              if (v.pageStates)
                for (const page of Object.values(v.pageStates))
                  if (page.status === "打标中" || page.status === "待打标") {
                    page.status = "完成";
                    page.error = undefined;
                  }
              v.unmatched = undefined;
              if (!v.tags.some((t) => t.origin === "AI" && !t.page))
                for (const id of ["t3", "t5"]) {
                  const tag = s.tags.find((t) => t.id === id);
                  if (
                    tag &&
                    availableTag(s.tags, tag) &&
                    !v.tags.some((b) => b.tagId === id && !b.page)
                  )
                    v.tags.push({ tagId: id, origin: "AI" });
                }
              if (["PDF", "PPT", "Word"].includes(v.kind)) {
                const choices = s.tags.filter(
                  (t) =>
                    t.parentId === primaryTagId("页面类型") &&
                    availableTag(s.tags, t),
                );
                for (let page = 1; page <= v.pages; page++) {
                  const tag = choices[(page - 1) % Math.max(1, choices.length)];
                  if (tag && !v.tags.some((b) => b.page === page))
                    v.tags.push({ tagId: tag.id, origin: "AI", page });
                }
              }
              const parent = s.tags.find(
                (t) =>
                  t.parentId === null &&
                  t.id === primaryTagId("Key Message") &&
                  t.enabled,
              );
              if (parent) {
                const name = "研究要点提炼";
                const known = s.tags.find(
                  (t) =>
                    t.parentId === parent.id &&
                    t.name === name &&
                    availableTag(s.tags, t),
                );
                if (known) {
                  if (!v.tags.some((b) => b.tagId === known.id && !b.page))
                    v.tags.push({ tagId: known.id, origin: "AI" });
                } else {
                  let suggestion = s.suggestions.find(
                    (r) => r.parentId === parent.id && r.name === name,
                  );
                  if (!suggestion) {
                    suggestion = {
                      id: uid("suggestion"),
                      name,
                      parentId: parent.id,
                      mentions: 0,
                      assetIds: [],
                      contexts: [],
                      accepted: [],
                      status: "待处理",
                    };
                    s.suggestions.unshift(suggestion);
                  }
                  if (
                    !suggestion.contexts?.some(
                      (c) => c.assetId === asset!.id && c.version === v.number,
                    )
                  ) {
                    suggestion.contexts ||= [];
                    suggestion.contexts.push({
                      assetId: asset!.id,
                      version: v.number,
                    });
                    suggestion.mentions++;
                  }
                  if (!suggestion.assetIds.includes(asset!.id))
                    suggestion.assetIds.push(asset!.id);
                  v.tagStatus = "未匹配";
                  v.unmatched = "有新的标签建议待处理（原型模拟）。";
                }
              }
            }
          }
          s.notices.unshift({
            id: uid("notice"),
            title: `${task.name}已完成`,
            detail: "查看处理结果。",
            route: task.items[0]?.assetId
              ? `content/${task.items[0].assetId}`
              : "library",
            read: false,
            at: now(),
          });
        }
      });
    }, 500);
    return () => clearInterval(timer);
  }, [update]);
  if (loadFailure)
    return (
      <main className="empty">
        <h2>保存的内容未被覆盖</h2>
        <p>{loadFailure}。请保留当前浏览器资料并联系项目人员处理。</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          重新加载
        </button>
      </main>
    );
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
