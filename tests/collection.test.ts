import { describe, expect, it } from "vitest";
import { seedState } from "../src/seed";
import { accounts, current, type Task } from "../src/model";
import {
  collectedArticles,
  collectedBody,
  collectionNumber,
  collectionRecords,
  collectionStatus,
  prepareCollection,
  enqueueCollection,
  advanceCollectionQueue,
  collectionQueueDue,
  pendingCollectionTasks,
} from "../src/collection";

describe("公众号采集文章与执行记录", () => {
  it("每个公众号独立记录，仅有三种执行状态，零新增仍可完成", () => {
    const state = prepareCollection(seedState());
    const records = collectionRecords(state.tasks);
    expect(records).toHaveLength(12);
    expect(new Set(records.map(collectionStatus))).toEqual(
      new Set(["执行中", "已完成", "失败"]),
    );
    expect(new Set(records.map((task) => task.collection!.number)).size).toBe(
      12,
    );
    expect(
      records.some(
        (task) =>
          task.status === "完成" && task.collection!.addedArticles === 0,
      ),
    ).toBe(true);
    for (const account of accounts) {
      expect(collectionRecords(state.tasks, account)).toHaveLength(3);
      expect(
        collectionRecords(state.tasks, account).every(
          (task) => task.collection!.account === account,
        ),
      ).toBe(true);
    }
    expect(records.map((task) => task.collection!.startedAt)).toEqual(
      records
        .map((task) => task.collection!.startedAt)
        .sort()
        .reverse(),
    );
    expect(collectionNumber("2026-11-20T06:30:25Z", 1)).toBe(
      "20261120-143025-001",
    );
  });

  it("只有获取正文的文章进入列表，失败、空正文和不可见关联内容排除", () => {
    const state = seedState();
    const article = state.articles[0];
    state.articles.push(
      { ...article, id: "failed", status: "失败" },
      {
        ...article,
        id: "empty",
        assetId: undefined,
        collectedVersion: undefined,
      },
      {
        ...article,
        id: "blank",
        collectedVersion: { ...current(state.assets[8]), content: ["  ", ""] },
      },
      { ...article, id: "hidden", assetId: "not-visible" },
    );
    expect(
      collectedArticles(state.articles, state.assets).map((row) => row.id),
    ).toEqual(["article1", "article4"]);
    expect(state.articles).toHaveLength(6);
  });

  it("归档正文不随内容库新版本改变，迁移不改内容归属和历史", () => {
    const state = seedState();
    const beforeAssets = structuredClone(state.assets);
    const next = prepareCollection(state);
    expect(next.assets).toEqual(beforeAssets);
    const article = next.articles[0];
    const asset = next.assets.find((item) => item.id === article.assetId)!;
    const original = structuredClone(collectedBody(article, asset));
    asset.versions.push({
      ...structuredClone(current(asset)),
      number: 2,
      content: ["后来编辑的正文"],
    });
    asset.current = 2;
    expect(collectedBody(article, asset)).toEqual(original);
    expect(prepareCollection(next)).toBe(next);
    expect(JSON.parse(JSON.stringify(next)).tasks).toEqual(next.tasks);
  });

  it("旧任务按明确的公众号项迁移，保留原记录、不推断触发方式或新增数", () => {
    const state = seedState();
    state.tasks = [
      {
        id: "legacy",
        name: "采集任务",
        type: "采集",
        status: "部分失败",
        createdAt: "2026-11-20T06:30:25Z",
        attempts: 1,
        items: [
          { label: accounts[0], status: "完成", added: 2 },
          { label: accounts[1], status: "失败", error: "网络异常" },
          { label: "无法确认公众号的项", status: "完成" },
        ],
      },
    ];
    const original = structuredClone(state.tasks[0]);
    const next = prepareCollection(state);
    expect(next.tasks[0]).toEqual(original);
    const records = collectionRecords(next.tasks);
    expect(records).toHaveLength(2);
    expect(
      records.find((task) => task.collection!.account === accounts[0])
        ?.collection,
    ).toMatchObject({
      trigger: "—",
      addedArticles: 2,
      startedAt: original.createdAt,
    });
    expect(
      collectionStatus(
        records.find((task) => task.collection!.account === accounts[1])!,
      ),
    ).toBe("失败");
    expect(prepareCollection(next).tasks).toEqual(next.tasks);
  });

  it("用户文章不生成虚构执行记录，不删除不完整的旧记录", () => {
    const state = seedState();
    state.tasks = [];
    state.articles = [
      {
        ...state.articles[0],
        id: "user-article",
        title: "用户文章",
        assetId: undefined,
        sourceUrl: "https://mp.weixin.qq.com/s/user-source",
        status: "失败",
        error: "历史错误",
      },
    ];
    const before = structuredClone(state.articles);
    const next = prepareCollection(state);
    expect(next.articles).toEqual(before);
    expect(collectionRecords(next.tasks)).toEqual([]);
    expect(collectedArticles(next.articles, next.assets)).toEqual([]);
  });

  it("原型旧示例可升级查看执行记录，用户资产、账号和任务不被重置", () => {
    const state = seedState();
    state.tasks = state.tasks.filter((task) => task.type !== "采集");
    state.articles[1].title = "眼科研究进展 · 内容更新";
    state.articles.splice(
      1,
      0,
      {
        id: "article2",
        title: "慢病管理学术资讯 · 采集样例",
        account: accounts[1],
        sourceUrl: "/samples/wechat/article2.html",
        publishedAt: "",
        checkedAt: "2026-11-20T06:30:25Z",
        status: "成功",
      },
      {
        id: "article3",
        title: "学术交流文章 · 采集异常样例",
        account: accounts[2],
        sourceUrl: "/samples/wechat/article3.html",
        publishedAt: "",
        checkedAt: "2026-11-20T06:30:25Z",
        status: "失败",
      },
    );
    const assets = structuredClone(state.assets),
      users = structuredClone(state.users),
      tasks = structuredClone(state.tasks);
    const next = prepareCollection(state);
    expect(next.assets).toEqual(assets);
    expect(next.users).toEqual(users);
    expect(next.tasks.filter((task) => task.type !== "采集")).toEqual(tasks);
    expect(collectionRecords(next.tasks)).toHaveLength(12);
    expect(collectedArticles(next.articles, next.assets)).toHaveLength(2);
    expect(next.articles).toHaveLength(4);
    expect(prepareCollection(next)).toBe(next);
  });
});

describe("手动采集串行队列", () => {
  const at = "2026-11-20T06:30:25Z";
  const time = Date.parse(at);
  const setup = () => {
    const state = prepareCollection(seedState());
    state.tasks = state.tasks.filter((task) => task.type !== "采集");
    return state;
  };

  it("多选生成独立任务，只有一个执行，等待任务没有开始时间", () => {
    const state = setup();
    enqueueCollection(state, accounts, at);
    const pending = pendingCollectionTasks(state);
    expect(pending).toHaveLength(4);
    expect(pending.map(collectionStatus)).toEqual([
      "执行中",
      "等待执行",
      "等待执行",
      "等待执行",
    ]);
    expect(pending[0].collection?.startedAt).toBe(new Date(time).toISOString());
    expect(
      pending
        .slice(1)
        .every((task) => !task.collection?.startedAt && !task.finishAt),
    ).toBe(true);
    expect(
      pending.every((task) => task.collection?.trigger === "手动采集"),
    ).toBe(true);
    expect(collectionQueueDue(state, time + 5999)).toBe(false);
    expect(advanceCollectionQueue(state, time + 5999)).toBe(false);
  });

  it("按入队顺序逐个启动，持久化恢复后不重跑完成项或产生重复文章", () => {
    let state = setup();
    const before = structuredClone(state.articles),
      assets = structuredClone(state.assets);
    enqueueCollection(state, accounts, at);
    for (let index = 0; index < accounts.length; index++) {
      state = prepareCollection(JSON.parse(JSON.stringify(state)));
      expect(
        pendingCollectionTasks(state).filter(
          (task) => task.status === "处理中",
        ),
      ).toHaveLength(1);
      expect(
        pendingCollectionTasks(state).find((task) => task.status === "处理中")
          ?.collection?.account,
      ).toBe(accounts[index]);
      expect(collectionQueueDue(state, time + (index + 1) * 6000)).toBe(true);
      advanceCollectionQueue(state, time + (index + 1) * 6000);
    }
    expect(pendingCollectionTasks(state)).toHaveLength(0);
    expect(
      collectionRecords(state.tasks).every(
        (task) => collectionStatus(task) === "已完成",
      ),
    ).toBe(true);
    expect(collectionQueueDue(state, time + 99999)).toBe(false);
    expect(state.articles).toEqual(before);
    expect(state.assets).toEqual(assets);
  });

  it("已有执行或等待任务禁止重复提交，校验失败不创建部分任务", () => {
    const state = setup();
    enqueueCollection(state, [accounts[0], accounts[0], accounts[1]], at);
    expect(pendingCollectionTasks(state)).toHaveLength(2);
    const before = structuredClone(state.tasks);
    expect(() =>
      enqueueCollection(state, [accounts[2], accounts[1]], at),
    ).toThrow("未结束");
    expect(state.tasks).toEqual(before);
    expect(() => enqueueCollection(state, [], at)).toThrow("请选择");
    expect(() => enqueueCollection(state, ["不存在"], at)).toThrow("不存在");
    advanceCollectionQueue(state, time + 6000);
    enqueueCollection(
      state,
      [accounts[0]],
      new Date(time + 6000).toISOString(),
    );
    expect(
      pendingCollectionTasks(state).filter((task) => task.status === "处理中"),
    ).toHaveLength(1);
    expect(
      pendingCollectionTasks(state).find((task) => task.status === "处理中")
        ?.collection?.account,
    ).toBe(accounts[1]);
  });

  it("失败项保留历史，后续任务继续执行；不把外部任务自动报为成功", () => {
    const state = setup();
    enqueueCollection(state, [accounts[0], accounts[1]], at);
    const failed = pendingCollectionTasks(state)[0];
    failed.status = "失败";
    expect(collectionQueueDue(state, time + 1000)).toBe(true);
    advanceCollectionQueue(state, time + 1000);
    expect(collectionStatus(failed)).toBe("失败");
    const active = pendingCollectionTasks(state)[0];
    active.collection!.simulated = false;
    expect(advanceCollectionQueue(state, time + 99999)).toBe(false);
    expect(collectionStatus(active)).toBe("执行中");
  });

  it("校验采集访问权限、编辑权限及账号启停，编号不会在同秒重用", () => {
    const state = setup();
    enqueueCollection(state, [accounts[0]], at);
    pendingCollectionTasks(state)[0].status = "完成";
    enqueueCollection(state, [accounts[0]], at);
    const numbers = collectionRecords(state.tasks).map(
      (task) => task.collection!.number,
    );
    expect(new Set(numbers).size).toBe(2);
    const role = state.roles.find((role) => role.id === "admin")!;
    role.permissions = role.permissions.filter(
      (permission) => permission !== "edit",
    );
    expect(() => enqueueCollection(state, [accounts[2]], at)).toThrow("权限");
    role.permissions.push("edit");
    role.menus = role.menus.filter((menu) => menu !== "collection");
    expect(() => enqueueCollection(state, [accounts[2]], at)).toThrow("权限");
    role.menus.push("collection");
    state.users.find((user) => user.id === state.userId)!.enabled = false;
    expect(() => enqueueCollection(state, [accounts[2]], at)).toThrow("权限");
  });

  it("旧数据迁移为单任务执行，其他执行项转等待，重复迁移不改变结果", () => {
    const state = setup();
    enqueueCollection(state, [accounts[0], accounts[1]], at);
    const pending = pendingCollectionTasks(state);
    pending[1].status = "处理中";
    pending[1].collection!.startedAt = at;
    state.collectionRevision = 1;
    const before = structuredClone(state.assets);
    const migrated = prepareCollection(state);
    expect(pendingCollectionTasks(migrated).map(collectionStatus)).toEqual([
      "执行中",
      "等待执行",
    ]);
    expect(
      pendingCollectionTasks(migrated)[1].collection!.startedAt,
    ).toBeUndefined();
    expect(prepareCollection(migrated)).toBe(migrated);
    expect(migrated.assets).toEqual(before);
  });
});
