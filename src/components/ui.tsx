import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import {
  X,
  Search,
  Inbox,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
} from "lucide-react";
import { loadBlob, putFiles } from "../storage";
import { uid } from "../model";
import { useCMS } from "../store";
export function Button({
  children,
  variant = "secondary",
  icon,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: ReactNode;
}) {
  return (
    <button {...props} className={`btn btn-${variant} ${className}`}>
      {icon}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "blue" | "green" | "amber" | "red" | "gray";
}) {
  const text = String(children);
  const automatic =
    /失败|过期|差异/.test(text) && !/即将/.test(text)
      ? "red"
      : /未匹配|待|即将|部分|更新/.test(text)
        ? "amber"
        : /完成|一致|生效|成功|登记|已发布/.test(text) && !/免登记/.test(text)
          ? "green"
          : /处理中|打标中/.test(text)
            ? "blue"
            : "gray";
  return (
    <span className={`badge badge-${tone || automatic}`}>
      <i />
      {children}
    </span>
  );
}
export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="header-actions">{action}</div>
    </div>
  );
}
export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className={`field ${error ? "field-error" : ""}`}>
      <span className="field-label">
        {label}
        {required ? <b>*</b> : null}
      </span>
      {children}
      {error ? (
        <small className="error-text">{error}</small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}
export function Empty({
  title = "没有找到内容",
  description = "试试调整筛选条件，或添加新的内容。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={30} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
  drawer = false,
  portal = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  drawer?: boolean;
  portal?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (
        [...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current
      )
        return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ) || [],
        ).filter((e) => e.offsetParent !== null);
        const first = elements[0];
        const last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", keyboard);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  const dialog = (
    <div
      className={`modal-backdrop ${drawer ? "drawer-backdrop" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog ${wide ? "dialog-wide" : ""} ${drawer ? "dialog-drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="关闭窗口" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
  return portal ? createPortal(dialog, document.body) : dialog;
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          role="tab"
          aria-selected={value === item.key}
          key={item.key}
          className={value === item.key ? "active" : ""}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined ? <span>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value ? (
        <button aria-label="清空搜索" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
export function Pagination({
  total,
  page,
  size = 8,
  onChange,
}: {
  total: number;
  page: number;
  size?: number;
  onChange: (page: number) => void;
}) {
  const max = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        共 <strong>{total}</strong> 条 · 每页 {size} 条
      </span>
      <div>
        <button
          className="icon-btn"
          disabled={page <= 1}
          aria-label="上一页"
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={`page-number ${n === page ? "active" : ""}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
        <button
          className="icon-btn"
          disabled={page >= max}
          aria-label="下一页"
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowRight size={14} />
    </button>
  );
}
export function Note({
  children,
  tone = "blue",
}: {
  children: ReactNode;
  tone?: "blue" | "amber" | "red";
}) {
  return <div className={`note note-${tone}`}>{children}</div>;
}
export function AssetImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [image, setImage] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!src?.startsWith("local:")) return;
    let active = true;
    let url = "";
    loadBlob(src.slice(6))
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setImage({ source: src, url });
      })
      .catch(() => {
        if (active) setImage(undefined);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);
  const resolved = src?.startsWith("local:")
    ? image?.source === src
      ? image.url
      : undefined
    : src;
  return resolved ? (
    <img src={resolved} alt={alt} className={className} />
  ) : (
    <span
      className={`image-placeholder ${className || ""}`}
      role="img"
      aria-label={alt}
    >
      图片待加载
    </span>
  );
}
export function CoverPicker({
  value,
  onChange,
  label = "上传图片",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const { toast } = useCMS();
  const [busy, setBusy] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("请选择有效的图片文件。");
    setBusy(true);
    try {
      const previewUrl = URL.createObjectURL(file);
      try {
        const image = new Image();
        image.src = previewUrl;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error("无效图片");
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
      const key = uid("cover");
      await putFiles([{ key, blob: file }]);
      onChange("local:" + key);
    } catch {
      toast("图片无法读取或保存，请重新选择。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="cover-upload-line">
        <label className="btn btn-secondary">
          <ImagePlus size={14} />
          {busy ? "保存图片…" : label}
          <input
            type="file"
            aria-label={label}
            accept="image/*"
            hidden
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {value ? (
          <button className="text-link" onClick={() => onChange("")}>
            清除图片
          </button>
        ) : null}
      </div>
      {value.startsWith("local:") ? (
        <AssetImage
          className="custom-cover-preview"
          src={value}
          alt="已上传自定义图片"
        />
      ) : null}
      <div className="cover-picker">
        {[1, 2, 3, 4].map((n) => (
          <button
            type="button"
            key={n}
            className={value === `/samples/cover-${n}.svg` ? "active" : ""}
            onClick={() => onChange(`/samples/cover-${n}.svg`)}
            aria-label={`选择示例图片${n}`}
          >
            <img src={`/samples/cover-${n}.svg`} alt={`示例图片${n}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
