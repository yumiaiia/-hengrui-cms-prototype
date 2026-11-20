import { describe, expect, it } from "vitest";
import { seedState } from "../src/seed";
import { current, type Task } from "../src/model";
import {
  collectedArticles,
  collectedBody,
  prepareCollection,
} from "../src/collection";

describe("公众号采集文章", () => {
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
    expect(next.tasks).toEqual([]);
    expect(collectedArticles(next.articles, next.assets)).toEqual([]);
  });

  it("移除任务功能后不生成执行记录，保留已保存的任务和文章数据，迁移幂等", () => {
    const state = seedState();
    expect(state.tasks.every((task) => task.type !== "采集")).toBe(true);
    const task: Task = {
      id: "saved-collection",
      name: "历史采集",
      type: "采集",
      status: "排队中",
      items: [],
      createdAt: "2026-11-20T06:30:25Z",
      attempts: 1,
      collection: {
        number: "20261120-143025-001",
        account: "自免医时空",
        trigger: "手动采集",
        addedArticles: 0,
        simulated: true,
      },
    };
    state.tasks.push(task);
    state.collectionRevision = 2;
    const before = structuredClone(state);
    const next = prepareCollection(state);
    expect(next.tasks).toEqual(before.tasks);
    expect(next.assets).toEqual(before.assets);
    expect(next.users).toEqual(before.users);
    expect(next.articles).toHaveLength(before.articles.length);
    expect(prepareCollection(next)).toBe(next);
  });
});
