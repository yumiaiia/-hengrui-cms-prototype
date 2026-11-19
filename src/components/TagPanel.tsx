import { useState } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import { useCMS } from "../store";
import { current, now, type Version } from "../model";
import {
  availableTag,
  bindTag,
  pendingSuggestions,
  primaryTags,
  suggestionContexts,
} from "../taxonomy";
import { Badge, Button, Dialog, SearchBox } from "./ui";
import { SuggestionSources } from "./SuggestionSources";
export function TagPanel({
  assetId,
  versionNumber,
  page,
  suppliedVersion,
  readOnly = false,
  allSuggestions = false,
}: {
  assetId: string;
  versionNumber?: number;
  page?: number;
  suppliedVersion?: Version;
  readOnly?: boolean;
  allSuggestions?: boolean;
}) {
  const { state, assets, can, update, toast } = useCMS();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const asset = assets.find((a) => a.id === assetId);
  const number = versionNumber ?? asset?.current;
  const version =
    suppliedVersion || asset?.versions.find((v) => v.number === number);
  if (!asset || !version) return <p className="muted">当前内容不可访问。</p>;
  const editable =
    !readOnly &&
    asset.current === number &&
    asset.lifecycle === "正常" &&
    can("tags");
  const roots = primaryTags(state.tags);
  const bindings = version.tags.filter((b) => b.page === page);
  const suggestions = allSuggestions
    ? state.suggestions.filter((s) =>
        suggestionContexts(s, state.assets).some(
          (c) =>
            c.assetId === assetId &&
            c.version === number &&
            pendingSuggestions(state, asset, number, c.page).some(
              (pending) => pending.id === s.id,
            ),
        ),
      )
    : pendingSuggestions(state, asset, number, page);
  function toggle(id: string) {
    try {
      const ok = update(
        (s) => {
          const a = s.assets.find((a) => a.id === assetId);
          if (!a || a.current !== number || a.lifecycle !== "正常")
            throw new Error("当前内容已变化，请重新打开。");
          const v = current(a);
          if (v.tags.some((b) => b.tagId === id && b.page === page))
            v.tags = v.tags.filter((b) => !(b.tagId === id && b.page === page));
          else bindTag(s, assetId, number!, id, page);
          a.updatedAt = now();
        },
        undefined,
        "tags",
      );
      if (ok) toast("标签已更新。");
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败");
    }
  }
  const options = state.tags.filter(
    (t) =>
      t.parentId &&
      availableTag(state.tags, t) &&
      (!category || t.parentId === category) &&
      t.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="tag-panel compact-tag-panel">
      {bindings.length ? (
        roots.map((root) => {
          const list = bindings.filter(
            (b) =>
              state.tags.find((t) => t.id === b.tagId)?.parentId === root.id,
          );
          return list.length ? (
            <section className="tag-family" key={root.id}>
              <h4>{root.name}</h4>
              <div className="tag-chips">
                {list.map((b) => (
                  <span
                    className={`tag-chip ${b.origin === "人工" ? "manual" : ""}`}
                    key={b.tagId}
                    title={b.origin === "人工" ? "人工校正" : "AI 识别"}
                  >
                    {state.tags.find((t) => t.id === b.tagId)?.name}
                    {editable ? (
                      <button
                        aria-label={`移除标签${state.tags.find((t) => t.id === b.tagId)?.name}`}
                        onClick={() => toggle(b.tagId)}
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </section>
          ) : null;
        })
      ) : (
        <div className="empty-tags">
          <p>暂未添加标签</p>
          <small>可从标准标签库中选择。</small>
        </div>
      )}
      {editable ? (
        <Button
          className="add-tags-button"
          icon={<Plus size={15} />}
          onClick={() => setPicking(true)}
        >
          添加标签
        </Button>
      ) : null}
      {suggestions.length ? (
        <section className="compact-suggestions">
          <h4>
            <Sparkles size={14} />
            推荐标签 <Badge>{suggestions.length}</Badge>
          </h4>
          {suggestions.map((s) => (
            <div className="recommendation-inline" key={s.id}>
              <div className="recommendation-inline-title">
                <strong>{s.name}</strong>
                <small>
                  {state.tags.find((t) => t.id === s.parentId)?.name}
                </small>
              </div>
              <SuggestionSources
                suggestion={s}
                scope={{
                  assetId,
                  version: number!,
                  page,
                  allPages: allSuggestions,
                }}
                readOnly={!editable}
                compact
              />
            </div>
          ))}
        </section>
      ) : null}
      {!editable ? (
        <p className="permission-note">
          {asset.current !== number
            ? "历史版本标签只读"
            : "当前内容或账号不可编辑标签"}
        </p>
      ) : null}
      {picking ? (
        <Dialog
          title={page ? `为第 ${page} 页添加标签` : "编辑材料标签"}
          onClose={() => setPicking(false)}
          footer={
            <Button variant="primary" onClick={() => setPicking(false)}>
              完成
            </Button>
          }
        >
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="搜索标签名称"
          />
          <div className="tag-category-pills">
            <button
              className={!category ? "active" : ""}
              onClick={() => setCategory("")}
            >
              全部
            </button>
            {roots
              .filter((t) => t.enabled)
              .map((t) => (
                <button
                  className={category === t.id ? "active" : ""}
                  key={t.id}
                  onClick={() => setCategory(t.id)}
                >
                  {t.name}
                </button>
              ))}
          </div>
          {roots.map((root) => {
            const list = options.filter((t) => t.parentId === root.id);
            return list.length ? (
              <section className="tag-picker-group" key={root.id}>
                <h4>{root.name}</h4>
                <div className="tag-picker-options">
                  {list.map((t) => (
                    <button
                      key={t.id}
                      aria-pressed={bindings.some((b) => b.tagId === t.id)}
                      className={
                        bindings.some((b) => b.tagId === t.id) ? "selected" : ""
                      }
                      onClick={() => toggle(t.id)}
                    >
                      {bindings.some((b) => b.tagId === t.id) ? (
                        <Check size={13} />
                      ) : (
                        <Plus size={13} />
                      )}{" "}
                      {t.name}
                    </button>
                  ))}
                </div>
              </section>
            ) : null;
          })}
          {!options.length ? (
            <p className="muted">没有匹配的标签，换一个关键词试试。</p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
