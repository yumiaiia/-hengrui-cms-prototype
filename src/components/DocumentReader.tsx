import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Maximize,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type Version } from "../model";
import { loadBlob } from "../storage";
import { AssetImage, Button, Empty } from "./ui";
import { paginated, pageState } from "../workflow";
const documents = new Map<string, Promise<PDFDocumentProxy>>();
function sourceKey(v: Version) {
  return v.previewUrl || v.fileKey || v.fileUrl || "";
}
export function getPdf(v: Version) {
  const key = sourceKey(v);
  if (!documents.has(key)) {
    const promise = (async () => {
      if (!key) throw new Error("尚无可预览的文件。");
      const blob = await loadBlob(
        v.previewUrl ? undefined : v.fileKey,
        v.previewUrl || v.fileUrl,
      );
      const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
      GlobalWorkerOptions.workerSrc = workerUrl;
      return getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
        .promise;
    })();
    documents.set(key, promise);
    promise.catch(() => documents.delete(key));
  }
  return documents.get(key)!;
}
export function PageCanvas({
  version,
  page,
  thumbnail = false,
}: {
  version: Version;
  page: number;
  thumbnail?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "350px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current || !host.current) return;
    let disposed = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    const paint = async () => {
      try {
        const pdf = await getPdf(version);
        const sheet = await pdf.getPage(page);
        if (disposed || !canvas.current || !host.current) return;
        const raw = sheet.getViewport({ scale: 1 });
        const scale =
          (host.current.clientWidth || (thumbnail ? 130 : 720)) / raw.width;
        const viewport = sheet.getViewport({
          scale: scale * Math.min(devicePixelRatio || 1, 2),
        });
        const target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        target.style.aspectRatio = `${viewport.width}/${viewport.height}`;
        render = sheet.render({ canvas: target, viewport });
        await render.promise;
        if (!disposed) {
          setReady(true);
          setError("");
        }
      } catch (e) {
        if (
          !disposed &&
          !(e instanceof Error && e.name === "RenderingCancelledException")
        )
          setError("当前格式暂不能在线预览，可下载原文件查看。");
      }
    };
    void paint();
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [visible, sourceKey(version), page]);
  if (!paginated(version))
    return (
      <div className="sheet-nondoc">
        <AssetImage src={version.cover} alt={version.title} />
        <FileText size={28} />
        <small>{version.kind}</small>
      </div>
    );
  return (
    <div
      ref={host}
      className={`page-canvas ${thumbnail ? "is-thumbnail" : ""}`}
    >
      <canvas ref={canvas} aria-label={`${version.title} 第 ${page} 页`} />
      {!ready && !error ? (
        <div className="canvas-loading">
          <Loader2 size={thumbnail ? 15 : 24} className="spin" />
          {!thumbnail && "正在载入页面"}
        </div>
      ) : null}
      {error ? (
        <div className="canvas-error">
          <FileText size={24} />
          <small>{error}</small>
        </div>
      ) : null}
    </div>
  );
}
export function DocumentReader({
  version,
  page,
  onPage,
  onCount,
}: {
  version: Version;
  page: number;
  onPage: (page: number) => void;
  onCount?: (count: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const active = useRef(0);
  const [count, setCount] = useState(version.pages);
  const [zoom, setZoom] = useState(100);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [media, setMedia] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    let url = "";
    setError("");
    if (paginated(version))
      void getPdf(version)
        .then((pdf) => {
          if (!disposed) {
            setCount(pdf.numPages);
            onCount?.(pdf.numPages);
          }
        })
        .catch((e) => {
          if (!disposed) setError(e.message || "文件预览失败");
        });
    else if (version.kind !== "网页")
      void loadBlob(version.fileKey, version.fileUrl)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (!disposed) setMedia(url);
        })
        .catch(() => {
          if (!disposed) setError("原文件暂不可用，可重新上传。");
        });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sourceKey(version), retry]);
  useEffect(() => {
    if (active.current === page) return;
    const target = Math.max(1, Math.min(count, page));
    if (target !== page) {
      onPage(target);
      return;
    }
    const sheet = root.current?.querySelector<HTMLElement>(
      `[data-sheet="${page}"]`,
    );
    if (sheet && root.current) {
      active.current = page;
      root.current.scrollTo({ top: sheet.offsetTop - 16, behavior: "instant" });
    }
  }, [page, count]);
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let disposed = false;
    const timer = setTimeout(async () => {
      try {
        const pdf = await getPdf(version);
        const found: number[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const text = await (await pdf.getPage(n)).getTextContent();
          if (
            text.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase())
          )
            found.push(n);
        }
        if (!disposed) setHits(found);
      } catch {
        if (!disposed) setHits([]);
      }
    }, 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [query, sourceKey(version)]);
  const scroll = () => {
    if (!root.current) return;
    const container = root.current;
    const sheets = [...container.querySelectorAll<HTMLElement>("[data-sheet]")];
    const middle = container.scrollTop + container.clientHeight / 2;
    const nearest = sheets.reduce<HTMLElement | undefined>(
      (best, el) =>
        !best ||
        Math.abs(el.offsetTop + el.offsetHeight / 2 - middle) <
          Math.abs(best.offsetTop + best.offsetHeight / 2 - middle)
          ? el
          : best,
      undefined,
    );
    if (nearest) {
      const n = Number(nearest.dataset.sheet);
      if (n !== active.current) {
        active.current = n;
        onPage(n);
      }
    }
  };
  return (
    <section className="reader" ref={view}>
      <div className="reader-toolbar">
        {paginated(version) ? (
          <>
            <div className="reader-page-tools">
              <Button
                aria-label="前一页"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
                icon={<ChevronLeft size={16} />}
              />
              <input
                aria-label="跳转页码"
                type="number"
                min={1}
                max={count}
                value={page}
                onChange={(e) =>
                  onPage(
                    Math.max(1, Math.min(count, Number(e.target.value) || 1)),
                  )
                }
              />
              <span>/ {count}</span>
              <Button
                aria-label="后一页"
                disabled={page >= count}
                onClick={() => onPage(page + 1)}
                icon={<ChevronRight size={16} />}
              />
            </div>
            <div className="reader-search">
              <Search size={15} />
              <input
                aria-label="文内搜索"
                placeholder="在文件中查找"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? <span>{hits.length} 页命中</span> : null}
            </div>
            <Button
              aria-label="缩小预览"
              onClick={() => setZoom((z) => Math.max(60, z - 10))}
              icon={<ZoomOut size={16} />}
            />
            <span>{zoom}%</span>
            <Button
              aria-label="放大预览"
              onClick={() => setZoom((z) => Math.min(180, z + 10))}
              icon={<ZoomIn size={16} />}
            />
          </>
        ) : (
          <span className="media-preview-label">{version.kind}预览</span>
        )}
        <Button
          aria-label="全屏预览"
          onClick={() => void view.current?.requestFullscreen()}
          icon={<Maximize size={16} />}
        />
      </div>
      {hits.length ? (
        <div className="search-page-hits">
          匹配页：
          {hits.map((n) => (
            <button
              key={n}
              className={page === n ? "active" : ""}
              onClick={() => onPage(n)}
            >
              第 {n} 页
            </button>
          ))}
        </div>
      ) : null}
      <div className="reader-scroll" ref={root} onScroll={scroll}>
        {error ? (
          <Empty
            title="文件暂不能预览"
            description={error}
            action={
              <Button onClick={() => setRetry((n) => n + 1)}>重新加载</Button>
            }
          />
        ) : paginated(version) ? (
          Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <div
              data-sheet={n}
              key={`${sourceKey(version)}-${n}`}
              className={`reader-sheet ${hits.includes(n) ? "search-match" : ""}`}
              style={{ width: `${zoom}%` }}
            >
              <PageCanvas version={version} page={n} />
              <span className="sheet-caption">
                第 {n} 页
                {pageState(version, n).status === "失败" ? " · 打标失败" : ""}
              </span>
            </div>
          ))
        ) : version.kind === "视频" ? (
          <video controls src={media} />
        ) : version.kind === "图片" ? (
          <img className="reader-image" src={media} alt={version.title} />
        ) : (
          <article className="reader-article">
            <h1>{version.title}</h1>
            <p className="muted">
              {version.author} {version.source}
            </p>
            {version.cover ? (
              <AssetImage src={version.cover} alt="文章封面" />
            ) : null}
            {version.content.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
            {!version.content.length ? (
              <p>尚无转存正文，可通过来源链接查看原文。</p>
            ) : null}
            {version.sourceUrl ? (
              <a href={version.sourceUrl} target="_blank" rel="noreferrer">
                查看原文
              </a>
            ) : null}
          </article>
        )}
      </div>
    </section>
  );
}
