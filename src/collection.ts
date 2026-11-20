import {
  accounts,
  current,
  canRole,
  uid,
  type Article,
  type Asset,
  type State,
  type Task,
} from "./model";

export function collectedBody(article: Article, asset?: Asset) {
  const version =
    article.collectedVersion ||
    asset?.versions.find((v) => v.number === 1) ||
    (asset && current(asset));
  return version?.content.some((block) => block.trim()) ? version : undefined;
}

export function collectedArticles(articles: Article[], assets: Asset[]) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return articles.filter(
    (article) =>
      article.status !== "失败" &&
      (!article.assetId || byId.has(article.assetId)) &&
      !!collectedBody(article, byId.get(article.assetId || "")),
  );
}

export function collectionStatus(task: Task) {
  if (task.status === "排队中") return "等待执行";
  if (task.status === "完成") return "已完成";
  if (task.status === "失败" || task.status === "部分失败") return "失败";
  return "执行中";
}

export function collectionRecords(tasks: Task[], account = "all") {
  return tasks
    .filter(
      (task) =>
        task.type === "采集" &&
        task.collection &&
        (account === "all" || task.collection.account === account),
    )
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.collection!.number.localeCompare(a.collection!.number),
    );
}

export function collectionNumber(at: string, sequence: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(at));
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return (
    part("year") +
    part("month") +
    part("day") +
    "-" +
    part("hour") +
    part("minute") +
    part("second") +
    "-" +
    String(sequence).padStart(3, "0")
  );
}

// A new, explicitly fictional batch for reviewing this prototype's execution list.
export function sampleCollectionTasks(at: string): Task[] {
  return Array.from({ length: 12 }, (_, index) => {
    const account = accounts[index % accounts.length];
    const startedAt = new Date(
      Date.parse(at) - Math.floor(index / 4) * 86400000,
    ).toISOString();
    const number = collectionNumber(startedAt, (index % 4) + 1);
    return {
      id: "collection-sample-" + number,
      name: account + " · 采集",
      type: "采集",
      status: index === 0 ? "处理中" : index === 2 ? "失败" : "完成",
      items: [],
      createdAt: startedAt,
      attempts: 1,
      finishAt: index === 0 ? Date.parse(at) + 6000 : undefined,
      collection: {
        number,
        account,
        trigger: "定时采集",
        startedAt,
        addedArticles: index === 4 || index === 7 ? 1 : 0,
        simulated: true,
      },
    };
  });
}

// Only persisted task metadata can become execution history; article rows cannot.
export function prepareCollection(state: State): State {
  if ((state.collectionRevision || 0) >= 2) return state;
  if (state.collectionRevision === 1) return prepareCollectionQueue(state);
  const next = structuredClone(state);
  // Upgrade only the original demo corpus; never infer user task history from articles.
  const originalSamples = [
    ["article1", "免疫疾病诊疗资讯 · 公众号文章"],
    ["article2", "慢病管理学术资讯 · 采集样例"],
    ["article3", "学术交流文章 · 采集异常样例"],
    ["article4", "眼科研究进展 · 内容更新"],
  ];
  if (
    !next.tasks.some((task) => task.type === "采集") &&
    originalSamples.every(([id, title], index) =>
      next.articles.some(
        (article) =>
          article.id === id &&
          article.title === title &&
          article.account === accounts[index] &&
          (!article.sourceUrl ||
            article.sourceUrl === "/samples/wechat/" + id + ".html"),
      ),
    )
  )
    next.tasks.push(...sampleCollectionTasks(new Date().toISOString()));
  const used = new Set(
    next.tasks.flatMap((task) =>
      task.collection ? [task.collection.number] : [],
    ),
  );
  for (const task of next.tasks) {
    if (task.type !== "采集" || task.collection) continue;
    // Older tasks can contain several accounts. Preserve each account's outcome.
    for (const [index, item] of task.items.entries()) {
      if (!accounts.includes(item.label) || item.assetId) continue;
      const startedAt = task.createdAt;
      let sequence = index + 1;
      let number = collectionNumber(startedAt, sequence);
      while (used.has(number)) number = collectionNumber(startedAt, ++sequence);
      used.add(number);
      next.tasks.push({
        ...structuredClone(task),
        id: task.id + "-account-" + index,
        status: item.status,
        items: [structuredClone(item)],
        finishAt: undefined,
        collection: {
          number,
          account: item.label,
          trigger: "—",
          startedAt,
          addedArticles: item.added || 0,
        },
      });
    }
  }
  for (const article of next.articles) {
    const asset = next.assets.find((a) => a.id === article.assetId);
    const body = collectedBody(article, asset);
    if (article.status === "失败" || !body) continue;
    article.status = "成功";
    if (
      article.id === "article4" &&
      article.title === "眼科研究进展 · 内容更新" &&
      article.account === accounts[3] &&
      article.sourceUrl === "/samples/wechat/article4.html"
    )
      article.title = "眼科研究进展 · 公众号文章";
    article.collectedVersion ||= {
      ...structuredClone(body),
      title: article.title,
    };
    article.collectedAt ||= body.createdAt;
  }
  return prepareCollectionQueue(next);
}

export function pendingCollectionTasks(state: State) {
  return state.tasks
    .filter(
      (task) =>
        task.type === "采集" &&
        task.collection &&
        (task.status === "处理中" || task.status === "排队中"),
    )
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.collection!.number.localeCompare(b.collection!.number),
    );
}

function prepareCollectionQueue(state: State) {
  const next = structuredClone(state);
  let running = false;
  for (const task of pendingCollectionTasks(next)) {
    const run = task.collection!;
    if (task.status === "排队中" || running) {
      task.status = "排队中";
      delete run.startedAt;
      delete task.finishAt;
    } else {
      running = true;
      if (task.id.startsWith("collection-sample-")) {
        run.simulated = true;
        task.finishAt = Date.now() + 6000;
      }
    }
  }
  next.collectionRevision = 2;
  return next;
}

export function enqueueCollection(
  state: State,
  selected: string[],
  at = new Date().toISOString(),
) {
  const actor = state.users.find((user) => user.id === state.userId);
  const role = state.roles.find((role) => role.id === actor?.roleId);
  if (
    !actor ||
    actor.enabled === false ||
    !role?.menus.includes("collection") ||
    !canRole(role, "edit")
  )
    throw new Error("当前账号没有手动采集权限。");
  const chosen = [...new Set(selected)];
  if (!chosen.length) throw new Error("请选择公众号。");
  if (chosen.some((account) => !accounts.includes(account)))
    throw new Error("公众号不存在。");
  const pending = pendingCollectionTasks(state);
  if (
    chosen.some((account) =>
      pending.some((task) => task.collection!.account === account),
    )
  )
    throw new Error("所选公众号已有未结束的采集任务。");
  const numbers = new Set(
    state.tasks.flatMap((task) =>
      task.collection ? [task.collection.number] : [],
    ),
  );
  let sequence = 1;
  for (const account of chosen) {
    let number = collectionNumber(at, sequence++);
    while (numbers.has(number)) number = collectionNumber(at, sequence++);
    numbers.add(number);
    state.tasks.push({
      id: uid("collection"),
      name: account + " · 采集",
      type: "采集",
      status: "排队中",
      items: [],
      createdAt: at,
      attempts: 1,
      collection: {
        number,
        account,
        trigger: "手动采集",
        addedArticles: 0,
        simulated: true,
      },
    });
  }
  advanceCollectionQueue(state, Date.parse(at));
}

// The prototype has no collector service. It simulates a completed scan with no
// new articles; only a real collector response may add article/content records.
export function advanceCollectionQueue(state: State, time = Date.now()) {
  const pending = pendingCollectionTasks(state);
  const active = pending.find((task) => task.status === "处理中");
  if (active) {
    if (
      !active.collection!.simulated ||
      !active.finishAt ||
      active.finishAt > time
    )
      return false;
    active.status = "完成";
    delete active.finishAt;
  }
  const next = pending.find((task) => task.status === "排队中");
  if (next) {
    next.status = "处理中";
    next.collection!.startedAt = new Date(time).toISOString();
    if (next.collection!.simulated) next.finishAt = time + 6000;
  }
  return !!active || !!next;
}

export function collectionQueueDue(state: State, time = Date.now()) {
  const pending = pendingCollectionTasks(state);
  const active = pending.find((task) => task.status === "处理中");
  return active
    ? !!active.collection!.simulated &&
        !!active.finishAt &&
        active.finishAt <= time
    : pending.some((task) => task.status === "排队中");
}
