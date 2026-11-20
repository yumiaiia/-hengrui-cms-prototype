import { useEffect, useRef, useState } from "react";
import { Tags } from "lucide-react";
import { useCMS } from "../store";
import { availableTag, primaryTags } from "../taxonomy";
import { SearchBox } from "./ui";
export function TagFilter({
  scope,
  selected,
  onChange,
}: {
  scope: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node))
        root.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && root.current) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const { state } = useCMS();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const tags = state.tags.filter(
    (t) =>
      t.parentId &&
      availableTag(state.tags, t) &&
      (!category || t.parentId === category) &&
      t.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details
      ref={root}
      name="library-tag-filters"
      className="tag-filter-popover"
    >
      <summary>
        <Tags size={15} />
        {scope}
        {selected.length ? <b>{selected.length}</b> : null}
      </summary>
      <div className="tag-filter-body">
        <SearchBox value={query} onChange={setQuery} placeholder="查找标签" />
        <div className="tag-category-pills">
          <button
            className={!category ? "active" : ""}
            onClick={() => setCategory("")}
          >
            全部
          </button>
          {primaryTags(state.tags).map((t) => (
            <button
              key={t.id}
              className={category === t.id ? "active" : ""}
              onClick={() => setCategory(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="filter-tag-options">
          {tags.map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                onChange={() =>
                  onChange(
                    selected.includes(t.id)
                      ? selected.filter((id) => id !== t.id)
                      : [...selected, t.id],
                  )
                }
              />
              <span>
                {t.name}
                <small>
                  {state.tags.find((r) => r.id === t.parentId)?.name}
                </small>
              </span>
            </label>
          ))}
        </div>
        {!tags.length ? <p className="muted">没有匹配标签。</p> : null}

      </div>
    </details>
  );
}
