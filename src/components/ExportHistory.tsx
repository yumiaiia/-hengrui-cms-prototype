import { useRef, useState } from "react";
import { useCMS } from "../store";
import { current, dateLabel, type Task } from "../model";
import { getFile, download } from "../storage";
import { Button, Dialog, Empty, Badge } from "./ui";
import { ExportDialog } from "../export";
const taskVisible = (
  task: Task,
  assets: ReturnType<typeof useCMS>["assets"],
  allowed: boolean,
) =>
  allowed &&
  task.type === "导出" &&
  task.items.length > 0 &&
  task.items.every((i) => assets.some((a) => a.id === i.assetId));
const itemVersion = (
  item: Task["items"][number],
  assets: ReturnType<typeof useCMS>["assets"],
) => {
  const a = assets.find((a) => a.id === item.assetId);
  return (
    a &&
    (item.version
      ? a.versions.find((v) => v.number === item.version)
      : current(a))
  );
};
const businessName = (task: Task, _assets: unknown) => task.name;
export function ExportHistory({ onClose }: { onClose: () => void }) {
  const cms = useCMS(),
    { state, assets, can } = cms;
  const live = useRef(cms);
  live.current = cms;
  const downloadLock = useRef(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [regenerate, setRegenerate] = useState<Task>();
  const rows = state.tasks.filter((t) => taskVisible(t, assets, can("export")));
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
        throw new Error("导出结果已变更，请重新打开导出记录。");
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

  if (regenerate)
    return (
      <ExportDialog
        assets={assets.filter((a) =>
          regenerate.items.some((i) => i.assetId === a.id),
        )}
        versions={Object.fromEntries(
          regenerate.items.map((i) => [i.assetId!, i.version!]),
        )}
        onClose={() => setRegenerate(undefined)}
      />
    );
  return (
    <Dialog wide title="导出记录" onClose={onClose}>
      {rows.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>文件包</th>
                <th>生成时间</th>
                <th>状态</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{dateLabel(t.createdAt)}</td>
                  <td>
                    <Badge>{t.status}</Badge>
                  </td>
                  <td>
                    {t.status === "完成" && t.artifactKey ? (
                      <Button
                        disabled={downloading !== null}
                        onClick={() => void downloadArtifact(t)}
                      >
                        {downloading === t.id ? "读取中…" : "下载文件包"}
                      </Button>
                    ) : (
                      <div>
                        {t.items.find((i) => i.error)?.error ||
                          (t.status === "完成"
                            ? "文件不可用，请重新导出"
                            : "等待生成结果")}
                        {["失败", "部分失败"].includes(t.status) ||
                        (t.status === "完成" && !t.artifactKey) ? (
                          <Button
                            disabled={
                              !can("export") ||
                              t.items.some(
                                (i) =>
                                  i.version === undefined ||
                                  !itemVersion(i, assets),
                              )
                            }
                            onClick={() => setRegenerate(t)}
                          >
                            重新导出
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="暂无导出记录" />
      )}
    </Dialog>
  );
}
