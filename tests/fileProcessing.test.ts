import { describe, expect, it } from "vitest";
import { current } from "../src/model";
import { seedState } from "../src/seed";
import { prepareWorkspace } from "../src/workflow";
import { prepareFileProcessing, reparseFile } from "../src/fileProcessing";

describe("文件级解析与重试", () => {
  it("迁移旧页级与材料失败为文件解析失败，保留标签、历史版本和发布快照", () => {
    const state = prepareWorkspace(seedState());
    const asset = state.assets[0];
    current(asset).pageStates = { 2: { status: "失败", error: "旧页面错误" } };
    const other = state.assets[1];
    current(other).tagStatus = "失败";
    const original = structuredClone(state);
    const next = prepareFileProcessing(state);
    expect(current(next.assets[0]).process).toBe("失败");
    expect(current(next.assets[1]).process).toBe("失败");
    expect(current(next.assets[0]).tags).toEqual(
      current(original.assets[0]).tags,
    );
    expect(next.assets[0].versions[0]).toEqual(original.assets[0].versions[0]);
    expect(next.publications).toEqual(original.publications);
    expect(next.tasks).toEqual(original.tasks);
    expect(prepareFileProcessing(next)).toBe(next);
  });

  it("整份重试重置所有页面处理状态，保留所有标签和审批，仅创建一个文件任务", () => {
    const state = prepareWorkspace(seedState());
    const asset = state.assets[0],
      version = current(asset);
    version.process = "失败";
    version.pageStates = {
      1: { status: "完成" },
      2: { status: "失败" },
      3: { status: "人工完成" },
    };
    version.tags.push({ tagId: "manual-tag", origin: "人工", page: 2 });
    const tags = structuredClone(version.tags),
      approval = structuredClone(version.approval),
      oldVersion = structuredClone(asset.versions[0]),
      publications = structuredClone(state.publications),
      count = state.tasks.length;
    reparseFile(state, asset.id, version.number);
    expect(version.process).toBe("处理中");
    expect(
      Object.values(version.pageStates).every(
        (page) => page.status === "待打标",
      ),
    ).toBe(true);
    expect(version.tags).toEqual(tags);
    expect(version.approval).toEqual(approval);
    expect(asset.versions[0]).toEqual(oldVersion);
    expect(state.publications).toEqual(publications);
    expect(state.tasks).toHaveLength(count + 1);
    expect(state.tasks[0].items).toEqual([
      {
        assetId: asset.id,
        version: version.number,
        label: version.title,
        status: "处理中",
      },
    ]);
    expect(() => reparseFile(state, asset.id, version.number)).toThrow(
      "正在解析",
    );
    expect(state.tasks).toHaveLength(count + 1);
  });

  it("历史版本、作废文件、正常文件和无权限账号不能重试", () => {
    const state = prepareWorkspace(seedState()),
      asset = state.assets[0];
    const version = current(asset);
    version.process = "完成";
    version.tagStatus = "已完成";
    version.pageStates = {};
    expect(() => reparseFile(state, asset.id, version.number)).toThrow("无需");
    version.process = "失败";
    expect(() => reparseFile(state, asset.id, 1)).toThrow("当前版本");
    asset.lifecycle = "已作废";
    expect(() => reparseFile(state, asset.id, version.number)).toThrow(
      "正常内容",
    );
    asset.lifecycle = "正常";
    const actor = state.users.find((user) => user.id === state.userId)!;
    const role = state.roles.find((role) => role.id === actor.roleId)!;
    role.permissions = role.permissions.filter(
      (permission) => permission !== "edit",
    );
    expect(() => reparseFile(state, asset.id, version.number)).toThrow("权限");
  });
});
