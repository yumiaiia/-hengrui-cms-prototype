import { useState } from "react";
import { Download, Package, Check } from "lucide-react";
import { useCMS } from "./store";
import { current, now, uid, type Asset } from "./model";
import { loadBlob, putFiles } from "./storage";
import { Dialog, Field, Button, Note } from "./components/ui";
const clean = (name: string) =>
  name.replace(/[\\/\x00-\x1f<>:"|?*]/g, "_").replace(/^\.+/, "_");
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function ExportDialog({
  assets,
  onClose,
  versions,
}: {
  assets: Asset[];
  onClose: () => void;
  versions?: Record<string, number>;
}) {
  const {
    can,
    state,
    update,
    notify,
    toast,
    assets: visible,
  } = useCMS();
  const [evidence, setEvidence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    if (
      !can("export") ||
      assets.some((a) => !visible.some((v) => v.id === a.id))
    )
      return setError("没有导出所选内容的权限。");
    setBusy(true);
    setError("");
    const id = uid("export");
    const chosen = assets.map((a) => ({
      asset: a,
      version:
        a.versions.find((v) => v.number === versions?.[a.id]) || current(a),
    }));
    update((s) =>
      s.tasks.unshift({
        id,
        name: `${assets.length} 份内容 · 结构化导出`,
        type: "导出",
        status: "处理中",
        items: chosen.map(({ asset, version }) => ({
          assetId: asset.id,
          version: version.number,
          label: version.title,
          status: "处理中",
        })),
        createdAt: now(),
        attempts: 1,
      }),
    );
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      const missing: string[] = [];
      for (const { asset, version: v } of chosen) {
        const folder = `${clean(asset.code)}/V${v.number}.0/`;
        if (v.fileKey || v.fileUrl)
          files[folder + "original/" + clean(v.fileName)] = new Uint8Array(
            await (await loadBlob(v.fileKey, v.fileUrl)).arrayBuffer(),
          );
        else if (v.kind === "网页") {
          files[folder + "content.html"] = strToU8(
            `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(v.title)}</title><h1>${escape(v.title)}</h1>${v.content.map((t) => `<p style="white-space:pre-wrap">${escape(t)}</p>`).join("")}</html>`,
          );
          if (v.sourceUrl)
            missing.push(
              `${asset.code}：公开链接仅登记来源，网页文件为安全文本内容，不是原站完整快照。`,
            );
        } else missing.push(`${asset.code}：示例视频未提供原视频文件。`);
        const { evidence: images, ...credential } = v.approval.snapshot || {
          evidence: [],
        };
        const metadata = {
          code: asset.code,
          version: v.number,
          title: v.title,
          kind: v.kind,
          source: v.source,
          sourceUrl: v.sourceUrl,
          sourcePublished: v.sourcePublished,
          summary: v.summary,
          author: v.author,
          createdAt: v.createdAt,
          expiry: v.approval.snapshot?.expiry || v.expiry,
          approval: {
            mode: v.approval.mode,
            credentialId: v.approval.credentialId,
            credential: v.approval.snapshot ? credential : undefined,
            evidenceCount: images.length,
          },
          tags: v.tags.map((binding) => ({
            ...state.tags.find((t) => t.id === binding.tagId),
            origin: binding.origin,
            page: binding.page,
          })),
        };
        files[folder + "metadata.json"] = strToU8(
          JSON.stringify(metadata, null, 2),
        );
        for (const [name, url] of [
          ["cover", v.cover],
          ["thumbnail", v.thumbnail],
        ])
          if (url?.startsWith("/samples/") || url?.startsWith("local:")) {
            const image = await loadBlob(
              url.startsWith("local:") ? url.slice(6) : undefined,
              url.startsWith("/samples/") ? url : undefined,
            );
            const extension =
              image.type === "image/png"
                ? "png"
                : image.type === "image/jpeg"
                  ? "jpg"
                  : image.type === "image/webp"
                    ? "webp"
                    : image.type === "image/gif"
                      ? "gif"
                      : image.type === "image/svg+xml"
                        ? "svg"
                        : "bin";
            files[folder + `media/${name}.${extension}`] = new Uint8Array(
              await image.arrayBuffer(),
            );
          }
        if (evidence && can("evidence"))
          for (const [i, image] of images.entries()) {
            files[
              folder +
                `approval/${i + 1}-${clean(image.name)}.${image.url?.endsWith(".svg") ? "svg" : "bin"}`
            ] = new Uint8Array(
              await (await loadBlob(image.fileKey, image.url)).arrayBuffer(),
            );
          }
      }
      files["manifest.json"] = strToU8(
        JSON.stringify(
          {
            createdAt: now(),
            count: assets.length,
            evidenceIncluded: evidence && can("evidence"),
            notes: ["示例资料为虚构演示文件。", ...missing],
          },
          null,
          2,
        ),
      );
      const data = zipSync(files);
      const blob = new Blob([new Uint8Array(data)], {
        type: "application/zip",
      });
      const artifactKey = uid("zip");
      const artifactName = `恒瑞CMS_内容资产_${new Date().toISOString().slice(0, 10)}.zip`;
      await putFiles([{ key: artifactKey, blob }]);
      update(
        (s) => {
          const t = s.tasks.find((t) => t.id === id)!;
          t.status = "完成";
          t.items.forEach((i) => (i.status = "完成"));
          t.artifactKey = artifactKey;
          t.artifactName = artifactName;
        },
        {
          action: "导出内容资产",
          object: `${assets.length} 份内容`,
          detail: evidence ? "按权限包含审批截图。" : "不包含审批截图。",
        },
        "export",
      );
      notify({
        title: "内容资产导出包已生成",
        detail: missing.length
          ? "包含导出清单，部分示例资产无原文件，详见 manifest.json。"
          : "文件与结构化字段已打包，可在内容库的导出记录下载。",
        route: "library?exports=1",
      });
      toast("导出包已生成，可在导出记录下载。");
      onClose();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "文件包生成失败";
      setError(reason);
      update((s) => {
        const t = s.tasks.find((t) => t.id === id);
        if (t) {
          t.status = "失败";
          t.items.forEach((i) => {
            i.status = "失败";
            i.error = reason;
          });
        }
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="导出内容资产"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            icon={<Package size={16} />}
            onClick={generate}
          >
            {busy ? "正在生成文件包…" : "生成导出包"}
          </Button>
        </>
      }
    >
      <div className="export-summary">
        <span className="empty-icon">
          <Download size={28} />
        </span>
        <div>
          <h3>导出 {assets.length} 份内容</h3>
          <p>按所选版本生成文件与结构化信息</p>
        </div>
      </div>
      <ul className="check-list">
        {[
          "原文件或转存网页、引用图片",
          "封面、缩略图、摘要与来源信息",
          "CMS 编号、版本及材料级 / 页面级标签",
          "审批编号、有效期及凭证修订信息",
        ].map((text) => (
          <li key={text}>
            <Check size={16} />
            {text}
          </li>
        ))}
      </ul>
      <Field label="审批截图">
        <span className="checkbox-label">
          <input
            type="checkbox"
            checked={evidence}
            disabled={!can("evidence")}
            onChange={(e) => setEvidence(e.target.checked)}
          />
          包含审批截图{!can("evidence") ? "（当前角色无此权限）" : ""}
        </span>
      </Field>
      <Note>
        导出文件可从内容库的导出记录下载。示例文件及无法获取的原始资源会在导出清单中明确标注。
      </Note>
      {error ? <Note tone="red">{error}</Note> : null}
    </Dialog>
  );
}
