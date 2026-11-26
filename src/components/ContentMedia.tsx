import { useEffect, useRef, useState } from "react";
import { Film, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { uid, type SupplementaryVideo, type Version } from "../model";
import { loadBlob, putFiles } from "../storage";
import { AssetImage, Button, CoverPicker, Field } from "./ui";

export type ContentMetadata = Pick<
  Version,
  "title" | "summary" | "cover" | "thumbnail" | "videos"
>;
export const mediaSize = (bytes: number) =>
  bytes < 1048576
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
export function VideoPreview({ video }: { video: SupplementaryVideo }) {
  const [source, setSource] = useState<{ key: string; url: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      url = "";
    setError("");
    loadBlob(video.fileKey)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setSource({ key: video.fileKey, url });
      })
      .catch(() => {
        if (active) setError("视频文件暂不可用，请联系管理员核查。");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [video.fileKey]);
  return (
    <div className="content-video-preview">
      {source?.key === video.fileKey ? (
        <video
          key={source.url}
          src={source.url}
          controls
          controlsList="nodownload"
          preload="metadata"
          aria-label={`补充视频：${video.fileName}`}
          onError={() =>
            setError("当前浏览器无法播放此视频，请上传 MP4 或 WebM 格式。")
          }
        />
      ) : !error ? (
        <div className="media-placeholder">
          <Loader2 size={20} className="spin" />
          正在加载视频…
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="media-error">
          {error}
        </p>
      ) : null}
      <div className="content-video-caption">
        <Film size={15} />
        <span>{video.fileName}</span>
        <small>{mediaSize(video.size)}</small>
      </div>
    </div>
  );
}
export function ContentMedia({
  value,
}: {
  value: Pick<Version, "cover" | "thumbnail" | "videos">;
}) {
  const videos = value.videos || [];
  return (
    <div className="content-media-grid">
      <MediaImage label="封面" value={value.cover} />
      <MediaImage label="缩略图" value={value.thumbnail} />
      <section className="content-media-card content-media-video">
        <h4>
          <Film size={15} />
          补充视频 {videos.length ? `${videos.length}/3` : ""}
        </h4>
        {videos.length ? (
          videos.map((video) => (
            <VideoPreview key={video.fileKey} video={video} />
          ))
        ) : (
          <div className="media-placeholder">
            <Film size={25} />
            <span>未上传补充视频</span>
          </div>
        )}
      </section>
    </div>
  );
}
function MediaImage({ label, value }: { label: string; value?: string }) {
  return (
    <section className="content-media-card">
      <h4>
        <ImageIcon size={15} />
        {label}
      </h4>
      {value ? (
        <AssetImage
          src={value}
          alt={label}
          className={`content-media-image ${label === "缩略图" ? "is-thumbnail" : ""}`}
        />
      ) : (
        <div className="media-placeholder">
          <ImageIcon size={25} />
          <span>未上传{label}</span>
        </div>
      )}
    </section>
  );
}
export function VideoListEditor({
  videos,
  onChange,
  onBusyChange,
  compact = false,
}: {
  videos?: SupplementaryVideo[];
  onChange: (videos: SupplementaryVideo[] | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
  compact?: boolean;
}) {
  const [videoBusy, setVideoBusy] = useState(false),
    [error, setError] = useState("");
  const videoLock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef<number | null>(null);
  const list = videos || [];
  function commit(next: SupplementaryVideo[]) {
    onChange(next.length ? next : undefined);
  }
  async function uploadVideo(file?: File) {
    if (!file || videoLock.current) return;
    setError("");
    if (
      !file.size ||
      (!file.type.startsWith("video/") && !/\.(mp4|webm|mov)$/i.test(file.name))
    ) {
      setError("请选择非空的 MP4、WebM 或 MOV 视频文件。");
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setError("单个补充视频不能超过 1 GB。");
      return;
    }
    if (replaceIndex.current === null && list.length >= 3) {
      setError("最多上传 3 个补充视频。");
      return;
    }
    videoLock.current = true;
    setVideoBusy(true);
    onBusyChange?.(true);
    try {
      const fileKey = uid("video");
      await putFiles([{ key: fileKey, blob: file }]);
      const item: SupplementaryVideo = {
        fileKey,
        fileName: file.name,
        size: file.size,
        type: file.type || "video/mp4",
      };
      const index = replaceIndex.current;
      commit(
        index === null
          ? [...list, item]
          : list.map((v) => (v.fileKey === list[index].fileKey ? item : v)),
      );
    } catch {
      setError("视频未保存，请检查浏览器存储后重试。");
    } finally {
      replaceIndex.current = null;
      videoLock.current = false;
      setVideoBusy(false);
      onBusyChange?.(false);
      if (input.current) input.current.value = "";
    }
  }
  function pick(index: number | null) {
    replaceIndex.current = index;
    input.current?.click();
  }
  return (
    <section
      className="metadata-video-editor"
      data-media-busy={videoBusy || undefined}
    >
      {!compact ? (
        <>
          <div className="metadata-video-heading">
            <h3>
              补充视频<small>选填</small>
            </h3>
            <span>共 {list.length}/3 · 仅关联当前文件</span>
          </div>
          <p>可补充讲解或演示视频，与源文件分别保存。支持 MP4、WebM、MOV。</p>
        </>
      ) : (
        <div className="metadata-video-heading">
          <h3>
            补充视频<small>选填</small>
          </h3>
          <span>共 {list.length}/3</span>
        </div>
      )}
      {list.length ? (
        list.map((video, index) => (
          <div className="metadata-video-item" key={video.fileKey}>
            <VideoPreview video={video} />
            <div className="actions">
              <Button
                type="button"
                disabled={videoBusy}
                onClick={() => pick(index)}
              >
                更换
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={videoBusy}
                icon={<X size={14} />}
                onClick={() => commit(list.filter((v) => v !== video))}
              >
                移除
              </Button>
            </div>
          </div>
        ))
      ) : (
        <div className="media-placeholder">
          <Film size={28} />
          <span>为这份内容添加视频（最多 3 个）</span>
        </div>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        aria-label="上传补充视频"
        disabled={videoBusy}
        onChange={(e) => void uploadVideo(e.target.files?.[0])}
      />
      <div className="actions">
        <Button
          type="button"
          disabled={videoBusy || list.length >= 3}
          icon={
            videoBusy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Upload size={15} />
            )
          }
          onClick={() => pick(null)}
        >
          {videoBusy ? "正在保存视频…" : "上传补充视频"}
        </Button>
        {list.length >= 3 ? (
          <small className="muted">最多上传 3 个补充视频</small>
        ) : null}
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
export function ContentMetadataForm({
  value,
  onChange,
  onBusyChange,
}: {
  value: ContentMetadata;
  onChange: (patch: Partial<ContentMetadata>) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const mediaBusy = useRef(new Set<string>());
  function setMediaBusy(key: string, busy: boolean) {
    if (busy) mediaBusy.current.add(key);
    else mediaBusy.current.delete(key);
    onBusyChange?.(mediaBusy.current.size > 0);
  }
  return (
    <div className="content-metadata-form">
      <Field label="内容标题" required>
        <input
          className="input"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <Field label="摘要">
        <textarea
          rows={3}
          value={value.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder="补充这份内容的简要说明"
        />
      </Field>
      <div className="metadata-images">
        {(["cover", "thumbnail"] as const).map((key) => (
          <section className="metadata-image-editor" key={key}>
            <h3>
              {key === "cover" ? "封面" : "缩略图"}
              <small>选填</small>
            </h3>
            <CoverPicker
              value={value[key] || ""}
              label={key === "cover" ? "上传封面" : "上传缩略图"}
              onChange={(v) => onChange({ [key]: v })}
              onBusyChange={(busy) => setMediaBusy(key, busy)}
            />
          </section>
        ))}
      </div>
      <VideoListEditor
        videos={value.videos}
        onChange={(videos) => onChange({ videos })}
        onBusyChange={(busy) => setMediaBusy("videos", busy)}
      />
    </div>
  );
}
