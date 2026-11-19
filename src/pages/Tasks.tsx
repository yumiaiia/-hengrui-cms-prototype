import { useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  ListChecks,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Note,
  PageHeader,
  Pagination,
  SearchBox,
} from "../components/ui";
import {
  current,
  dateLabel,
  go,
  type Asset,
  type Permission,
  type Process,
  type Task,
  type TaskItem,
} from "../model";
import { getFile, download } from "../storage";
import { useCMS } from "../store";
import "./admin.css";

const types: Task["type"][] = ["OCR", "采集", "解析与打标", "标签重跑", "导出"];
const statuses: Process[] = ["排队中", "处理中", "完成", "部分失败", "失败"];
const failed = (item: TaskItem) =>
  item.status === "失败" || item.status === "部分失败";
const retryPermission = (task: Task): Permission =>
  task.type === "标签重跑" ? "rerun" : task.type === "导出" ? "export" : "edit";
const taskVisible = (task: Task, assets: Asset[], canExport: boolean) =>
  types.includes(task.type) &&
  (task.type !== "导出" || canExport) &&
  task.items.length > 0 &&
  task.items.every(
    (item) =>
      !!item.assetId && assets.some((asset) => asset.id === item.assetId),
  ) &&
  (task.conflicts || []).every((conflict) =>
    assets.some((asset) => asset.id === conflict.assetId),
  );
const itemVersion = (item: TaskItem, assets: Asset[]) => {
  const asset = assets.find((asset) => asset.id === item.assetId);
  return asset
    ? item.version === undefined
      ? current(asset)
      : asset.versions.find((version) => version.number === item.version)
    : undefined;
};
const missingVideo = (item: TaskItem, assets: Asset[]) => {
  const version = itemVersion(item, assets);
  return version?.kind === "视频" && !version.fileKey && !version.fileUrl;
};
const businessName = (task: Task, assets: Asset[]) =>
  task.items.some((item) => missingVideo(item, assets))
    ? `${task.items.length === 1 ? itemVersion(task.items[0], assets)?.title || task.items[0].label : `${task.items.length} 份内容`} · ${task.type}（演示）`
    : task.name;

export default function Tasks() {
  const cms = useCMS();
  const { state, user, role, assets, can, retryTask, toast } = cms;
  const live = useRef(cms);
  live.current = cms;
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadLock = useRef(false);

  if (!user || !role)
    return (
      <div className="cms-tasks-page">
        <PageHeader title="任务中心" />
        <Empty
          title="请先选择演示账号"
          description="任务结果按当前账号的内容范围展示。"
          action={<Button onClick={() => go("login")}>前往演示登录</Button>}
        />
      </div>
    );

  const visibleTasks = state.tasks
    .filter((task) => taskVisible(task, assets, can("export")))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const rows = visibleTasks.filter(
    (task) =>
      (!type || task.type === type) &&
      (!status || task.status === status) &&
      `${businessName(task, assets)} ${task.items.map((item) => `${item.label} ${item.error || ""}`).join(" ")}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = visibleTasks.find((task) => task.id === selectedId);
  const activePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const summary = [
    {
      label: "可见任务",
      value: visibleTasks.length,
      icon: <ListChecks size={20} />,
      className: "",
    },
    {
      label: "排队 / 处理中",
      value: visibleTasks.filter(
        (task) => task.status === "排队中" || task.status === "处理中",
      ).length,
      icon: <RotateCcw size={20} />,
      className: "cms-stat-blue",
    },
    {
      label: "已完成",
      value: visibleTasks.filter((task) => task.status === "完成").length,
      icon: <CheckCircle2 size={20} />,
      className: "cms-stat-green",
    },
    {
      label: "失败 / 部分失败",
      value: visibleTasks.filter(
        (task) => task.status === "失败" || task.status === "部分失败",
      ).length,
      icon: <TriangleAlert size={20} />,
      className: "cms-stat-amber",
    },
  ];

  function canRetry(task: Task) {
    return (
      task.type !== "导出" &&
      (task.status === "失败" || task.status === "部分失败") &&
      task.items.some(failed) &&
      can(retryPermission(task)) &&
      !task.items.some(
        (item) =>
          failed(item) &&
          (!itemVersion(item, assets) || missingVideo(item, assets)),
      )
    );
  }

  function retryFailed(task: Task) {
    const latest = live.current;
    const actual = latest.state.tasks.find((item) => item.id === task.id);
    if (!actual || !taskVisible(actual, latest.assets, latest.can("export")))
      return latest.toast("任务已不在当前账号的可见范围内。");
    if (!latest.can(retryPermission(actual)))
      return latest.toast("当前角色没有重新处理此任务的权限。");
    if (actual.type === "导出")
      return latest.toast("请从内容库重新生成导出，原失败记录保留。");
    if (
      !["失败", "部分失败"].includes(actual.status) ||
      !actual.items.some(failed)
    )
      return latest.toast("没有可重新处理的失败项。");
    if (
      actual.items.some(
        (item) =>
          failed(item) &&
          (!itemVersion(item, latest.assets) ||
            missingVideo(item, latest.assets)),
      )
    )
      return latest.toast(
        "失败项的原版本或媒体文件不可用，请先在内容详情补充文件。",
      );
    latest.retryTask(actual.id);
  }

  function artifactIssue(task: Task, api: typeof cms) {
    if (!api.user || !api.can("export") || !taskVisible(task, api.assets, true))
      return "当前账号没有导出权限，或文件包包含当前不可见的内容。";
    if (task.type !== "导出" || task.status !== "完成" || !task.artifactKey)
      return "该任务没有已完成的导出文件，请从内容库重新生成。";
    if (
      task.items.some(
        (item) => item.version === undefined || !itemVersion(item, api.assets),
      )
    )
      return "文件包关联的内容版本未记录或已不可用，请重新生成导出。";
    return "";
  }

  async function downloadArtifact(task: Task) {
    if (downloadLock.current) return;
    const latest = live.current;
    const actual = latest.state.tasks.find((item) => item.id === task.id);
    if (!actual) return latest.toast("任务已不存在。");
    const issue = artifactIssue(actual, latest);
    if (issue) return latest.toast(issue);
    downloadLock.current = true;
    setDownloading(actual.id);
    try {
      const key = actual.artifactKey!;
      const [blob, { unzipSync, strFromU8 }] = await Promise.all([
        getFile(key),
        import("fflate"),
      ]);
      if (!blob || !blob.size)
        throw new Error("本地导出文件不存在或为空，请在内容库重新生成。");
      // Read the saved package's manifest and version metadata, not the latest credential.
      const entries: string[] = [];
      const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
        filter: (file) => {
          entries.push(file.name);
          const inspect =
            file.name === "manifest.json" ||
            file.name.endsWith("/metadata.json");
          if (inspect && file.originalSize > 2 * 1024 * 1024)
            throw new Error("导出清单过大，无法核对，请重新生成导出。");
          return inspect;
        },
      });
      if (!archive["manifest.json"])
        throw new Error(
          "旧文件包缺少导出清单，无法核对范围与截图权限，请重新生成。",
        );
      const manifest = JSON.parse(strFromU8(archive["manifest.json"])) as {
        count?: unknown;
        evidenceIncluded?: unknown;
      };
      if (typeof manifest.evidenceIncluded !== "boolean")
        throw new Error("文件包没有明确记录截图包含情况，请重新生成。");
      const metadata = Object.entries(archive)
        .filter(([name]) => name.endsWith("/metadata.json"))
        .map(([name, data]) => ({
          folder: name.slice(0, -"metadata.json".length),
          value: JSON.parse(strFromU8(data)) as {
            code?: unknown;
            version?: unknown;
          },
        }));
      const newest = live.current;
      const taskNow = newest.state.tasks.find((item) => item.id === actual.id);
      if (!taskNow || taskNow.artifactKey !== key)
        throw new Error("导出结果已变更，请重新打开任务。");
      const latestIssue = artifactIssue(taskNow, newest);
      if (latestIssue) throw new Error(latestIssue);
      const expected = new Set(
        taskNow.items.map(
          (item) =>
            `${newest.assets.find((asset) => asset.id === item.assetId)!.code}\u0000${item.version}`,
        ),
      );
      const actualVersions = new Set(
        metadata.map((item) => `${item.value.code}\u0000${item.value.version}`),
      );
      if (
        manifest.count !== taskNow.items.length ||
        metadata.length !== expected.size ||
        actualVersions.size !== expected.size ||
        [...actualVersions].some((item) => !expected.has(item)) ||
        entries.some(
          (name) =>
            name !== "manifest.json" &&
            !metadata.some((item) => name.startsWith(item.folder)),
        )
      ) {
        throw new Error("文件包清单与当前可见任务项目不一致，请重新生成导出。");
      }
      const includesEvidence =
        manifest.evidenceIncluded ||
        entries.some((name) => name.includes("/approval/"));
      if (includesEvidence && !newest.can("evidence"))
        throw new Error(
          "此文件包包含审批截图，当前角色没有截图下载权限。请在内容库重新生成不含截图的导出。",
        );
      download(blob, taskNow.artifactName || "内容导出.zip");
      newest.update(
        () => {},
        {
          action: "下载已完成导出",
          object: businessName(taskNow, newest.assets),
          detail: `${taskNow.items.length} 份可见内容；下载生成时保存的本地文件，不改写审批快照。`,
          category: "内容",
        },
        "export",
      );
      newest.toast("已下载保存的导出文件。");
    } catch (error) {
      live.current.toast(
        error instanceof Error
          ? error.message
          : "本地文件读取失败，请重新生成导出。",
      );
    } finally {
      downloadLock.current = false;
      setDownloading(null);
    }
  }

  function taskActions(task: Task) {
    const failures = task.items.filter(failed).length;
    return (
      <div className="actions cms-task-actions">
        {canRetry(task) ? (
          <Button
            icon={<RotateCcw size={14} />}
            onClick={() => retryFailed(task)}
          >
            仅重试失败项（{failures}）
          </Button>
        ) : null}
        {task.type === "导出" && task.status === "完成" && task.artifactKey ? (
          <Button
            icon={<Download size={14} />}
            disabled={downloading !== null}
            onClick={() => void downloadArtifact(task)}
          >
            {downloading === task.id ? "读取文件…" : "下载导出文件"}
          </Button>
        ) : null}
        {task.type === "导出" &&
        (task.status === "失败" ||
          task.status === "部分失败" ||
          (task.status === "完成" && !task.artifactKey)) &&
        role?.menus.includes("library") &&
        can("export") ? (
          <Button onClick={() => go("library")}>从内容库重新导出</Button>
        ) : null}
        {task.type === "标签重跑" &&
        task.conflicts?.some((conflict) => !conflict.resolved) &&
        role?.menus.includes("tags") &&
        can("rerun") ? (
          <Button
            icon={<ArrowUpRight size={14} />}
            onClick={() => go("tags?tab=rerun")}
          >
            核对标签冲突
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cms-tasks-page">
      <PageHeader
        eyebrow="BUSINESS TASKS"
        title="任务中心"
        description="查看可见内容的处理结果，定位失败项并获取已生成的文件。"
      />
      <div className="cms-task-summary">
        {summary.map((item) => (
          <section
            className={`cms-task-stat ${item.className}`}
            key={item.label}
          >
            <span>
              {item.icon}
              {item.label}
            </span>
            <strong>{item.value}</strong>
          </section>
        ))}
      </div>
      <Note>
        这里只展示全部关联内容都在当前可见范围内的业务任务；无法确认归属的任务不展示。处理状态为本地原型演示，不代表真实
        OCR、采集、解析或媒体处理结果。
      </Note>
      <section className="panel">
        <div className="toolbar cms-task-toolbar">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="搜索任务、内容或失败原因"
          />
          <div className="cms-task-selects">
            <label>
              任务类型
              <select
                aria-label="任务类型"
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部类型</option>
                {types.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              任务状态
              <select
                aria-label="任务状态"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部状态</option>
                {statuses.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>业务任务</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>逐项进展</th>
                    <th>执行次数</th>
                    <th>创建时间</th>
                    <th>查看</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice((activePage - 1) * 8, activePage * 8)
                    .map((task) => {
                      const complete = task.items.filter(
                        (item) => item.status === "完成",
                      ).length;
                      const failureCount = task.items.filter(failed).length;
                      const noMedia = task.items.some((item) =>
                        missingVideo(item, assets),
                      );
                      return (
                        <tr key={task.id}>
                          <td>
                            <strong>{businessName(task, assets)}</strong>
                            {noMedia ? (
                              <div className="muted">
                                未提供原视频文件 · 仅状态演示
                              </div>
                            ) : null}
                            {task.type === "标签重跑" &&
                            task.conflicts?.some(
                              (conflict) => !conflict.resolved,
                            ) ? (
                              <div className="muted">有人工标签差异待核对</div>
                            ) : null}
                          </td>
                          <td>{task.type}</td>
                          <td>
                            <Badge>{task.status}</Badge>
                          </td>
                          <td>
                            <span>
                              完成 {complete} / {task.items.length}
                            </span>
                            {failureCount ? (
                              <div className="cms-task-failure">
                                失败或部分失败 {failureCount} 项
                              </div>
                            ) : null}
                          </td>
                          <td>{task.attempts} 次</td>
                          <td>{dateLabel(task.createdAt)}</td>
                          <td>
                            <Button
                              variant="ghost"
                              onClick={() => setSelectedId(task.id)}
                            >
                              查看全部项目
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <Pagination
              total={rows.length}
              page={activePage}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title="没有可见的匹配任务"
            description="调整类型、状态或关键词。账号只能查看全部项目都属于其可见内容范围的任务。"
          />
        )}
      </section>

      {selected ? (
        <Dialog
          wide
          title="业务任务详情"
          onClose={() => setSelectedId(null)}
          footer={<Button onClick={() => setSelectedId(null)}>关闭</Button>}
        >
          <div className="section-heading">
            <h3>{businessName(selected, assets)}</h3>
            <Badge>{selected.status}</Badge>
          </div>
          <dl className="cms-definition cms-task-meta">
            <div>
              <dt>任务类型</dt>
              <dd>{selected.type}</dd>
            </div>
            <div>
              <dt>执行次数</dt>
              <dd>{selected.attempts} 次（含首次执行）</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{dateLabel(selected.createdAt)}</dd>
            </div>
            <div>
              <dt>项目进展</dt>
              <dd>
                完成{" "}
                {selected.items.filter((item) => item.status === "完成").length}{" "}
                / {selected.items.length}；失败或部分失败{" "}
                {selected.items.filter(failed).length} 项
              </dd>
            </div>
          </dl>
          {selected.items.some((item) => missingVideo(item, assets)) ? (
            <Note tone="amber">
              示例视频没有原始媒体文件。下方状态仅用于流程演示，即使状态变为完成，也不表示生成了可播放视频或实际执行了编码。
            </Note>
          ) : null}
          {selected.items.some(failed) ? (
            <Note tone="amber">
              失败原因逐项保留。重新处理只针对失败或部分失败项，不重新执行成功项，也不以等待时间估算进度。
              {selected.type === "导出"
                ? "导出失败需在内容库重新生成文件。"
                : !can(retryPermission(selected))
                  ? "当前角色无重新处理权限。"
                  : ""}
            </Note>
          ) : null}
          {selected.type === "导出" ? (
            <Note>
              下载读取本地保存的文件包与生成时的版本审批快照，不以当前凭证改写历史结果。下载前核对包内清单、全部项目的当前可见范围，以及是否实际包含审批截图；含截图的包还需截图权限。此检查仅是本地原型的界面边界，不是服务端安全保证。
            </Note>
          ) : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>内容 / 项目</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>失败原因 / 结果</th>
                  <th>内容详情</th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map((item, index) => {
                  const asset = assets.find(
                    (asset) => asset.id === item.assetId,
                  );
                  const version = itemVersion(item, assets);
                  return (
                    <tr key={`${item.assetId}-${item.version}-${index}`}>
                      <td>
                        <strong>{item.label}</strong>
                        <div className="muted">{asset?.code}</div>
                      </td>
                      <td>
                        {item.version === undefined
                          ? "未记录版本"
                          : `V${item.version}`}
                      </td>
                      <td>
                        <Badge>{item.status}</Badge>
                      </td>
                      <td className="cms-task-reason">
                        {failed(item)
                          ? item.error ||
                            "任务未记录具体原因，请核对原文件与审批材料。"
                          : item.status === "完成"
                            ? missingVideo(item, assets)
                              ? "状态演示完成；未生成实际媒体文件。"
                              : "该项已完成（本地演示）"
                            : item.error
                              ? `保留的上次失败原因：${item.error}`
                              : missingVideo(item, assets)
                                ? "未提供原视频文件，仅演示处理状态。"
                                : "等待结果；不显示估算进度。"}
                        {!version ? (
                          <div className="cms-task-failure">
                            该版本已不可用，不能重新处理。
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {asset && role.menus.includes("library") ? (
                          <Button
                            variant="ghost"
                            icon={<ArrowUpRight size={14} />}
                            onClick={() =>
                              go(
                                `content/${encodeURIComponent(asset.id)}${item.version === undefined ? "" : `?version=${item.version}`}`,
                              )
                            }
                          >
                            查看内容
                          </Button>
                        ) : (
                          <span className="muted">无内容菜单权限</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected.type === "标签重跑" && selected.conflicts?.length ? (
            <p className="muted">
              人工标签差异：
              {
                selected.conflicts.filter((conflict) => !conflict.resolved)
                  .length
              }{" "}
              项待处理 / {selected.conflicts.length}{" "}
              项；人工结果保留，可前往标签重跑核对。
            </p>
          ) : null}
          {taskActions(selected)}
        </Dialog>
      ) : null}
    </div>
  );
}
