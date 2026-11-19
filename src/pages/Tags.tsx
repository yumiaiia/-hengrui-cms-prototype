import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useCMS } from "../store";
import { uid, type Tag } from "../model";
import { availableTag, primaryTags, tagLabel, validateTag } from "../taxonomy";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  PageHeader,
  SearchBox,
  Tabs,
} from "../components/ui";

import { RecommendedTags } from "../components/RecommendedTags";

type Editor = Omit<Tag, "id"> & { id?: string };

export default function Tags() {
  const { state, assets, user, can, update, toast } = useCMS();
  const [tab, setTab] = useState("library");
  const [search, setSearch] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  useEffect(() => {
    setEditor(undefined);
  }, [user?.id]);

  const roots = primaryTags(state.tags);
  const query = search.trim().toLocaleLowerCase();
  const matches = (tag: Tag) => tag.name.toLocaleLowerCase().includes(query);
  const matchingRoots = roots.filter(
    (root) =>
      matches(root) ||
      state.tags.some((tag) => tag.parentId === root.id && matches(tag)),
  );
  const selected =
    matchingRoots.find((tag) => tag.id === primaryId) || matchingRoots[0];
  const children = selected
    ? state.tags.filter((tag) => tag.parentId === selected.id)
    : [];
  const shownChildren =
    selected && matches(selected) ? children : children.filter(matches);
  function openEditor(tag?: Tag, parentId: string | null = null) {
    if (!can("taxonomy")) return;
    setEditor(
      tag ? { ...tag } : { name: "", parentId, enabled: true, external: false },
    );
    setError("");
  }

  function saveTag() {
    if (!editor || !can("taxonomy")) return;
    const draft = { ...editor, name: editor.name.trim() };
    if (draft.parentId !== null && !draft.parentId)
      return setError("请选择所属标签分类。");
    const message = validateTag(state.tags, draft);
    if (message) return setError(message);
    const tag: Tag = {
      id: editor.id || uid("tag"),
      name: draft.name,
      parentId: draft.parentId,
      enabled: draft.enabled,
      external: draft.external,
    };
    try {
      const ok = update(
        (s) => {
          const validation = validateTag(s.tags, tag);
          if (validation) throw new Error(validation);
          const previous = s.tags.find((item) => item.id === tag.id);
          if (editor.id && !previous)
            throw new Error("标签已不存在，请重新选择。");
          if (
            previous &&
            (previous.parentId === null) !== (tag.parentId === null)
          )
            throw new Error("不能改变标签级别。");
          if (previous) Object.assign(previous, tag);
          else s.tags.push(tag);
        },
        {
          action: editor.id ? "编辑标签" : "新增标签",
          object: tagLabel(state.tags, tag),
          detail: `${tag.enabled ? "启用" : "停用"}；${tag.external ? "对外展示" : "仅内部"}；已有内容绑定保留。原定义：${JSON.stringify(state.tags.find((item) => item.id === tag.id) || null)}`,
          category: "标签",
        },
        "taxonomy",
      );
      if (ok) {
        setPrimaryId(tag.parentId || tag.id);
        setSearch("");
        setEditor(undefined);
        toast("标签已保存，已有内容绑定保留。");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "标签保存失败。");
    }
  }

  function toggleEnabled(tag: Tag) {
    try {
      const ok = update(
        (s) => {
          const target = s.tags.find((item) => item.id === tag.id);
          if (!target) throw new Error("标签已不存在。");
          target.enabled = !target.enabled;
        },
        {
          action: tag.enabled ? "停用标签" : "启用标签",
          object: tagLabel(state.tags, tag),
          detail: "已有内容绑定保留，不删除标签。",
          category: "标签",
        },
        "taxonomy",
      );
      if (ok)
        toast(tag.enabled ? "标签已停用，已有绑定保留。" : "标签已启用。");
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "操作失败。");
    }
  }

  return (
    <div>
      <PageHeader
        title="标签管理"
        description={`${roots.length} 个标签分类 · ${state.tags.filter((tag) => tag.parentId !== null).length} 个标签`}
      />
      <Tabs
        items={[
          { key: "library", label: "标签库" },
          {
            key: "recommended",
            label: "推荐标签",
            count: state.suggestions.filter((s) => s.status !== "已忽略")
              .length,
          },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "recommended" ? (
        <RecommendedTags key={user?.id} />
      ) : (
        <>
          <div className="taxonomy-toolbar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="搜索一级或标签名称"
            />
          </div>
          {!can("taxonomy") ? (
            <p className="permission-note">
              当前角色仅可查看标签，新增、编辑与启停需要标签管理权限。
            </p>
          ) : null}
          <div className="taxonomy-layout">
            <section className="primary-list panel" aria-label="标签分类">
              <div className="section-heading">
                <h2>标签分类</h2>
              </div>
              <Button
                icon={<Plus size={16} />}
                disabled={!can("taxonomy")}
                onClick={() => openEditor()}
              >
                新增标签分类
              </Button>
              {matchingRoots.map((root) => (
                <div
                  key={root.id}
                  className={`primary-row ${selected?.id === root.id ? "active" : ""}`}
                >
                  <button
                    type="button"
                    aria-pressed={selected?.id === root.id}
                    onClick={() => setPrimaryId(root.id)}
                  >
                    <strong>{root.name}</strong>
                    <span>
                      {
                        state.tags.filter((tag) => tag.parentId === root.id)
                          .length
                      }{" "}
                      个标签
                    </span>
                    {!root.enabled ? <Badge>已停用</Badge> : null}
                  </button>
                  {selected?.id === root.id ? (
                    <Button
                      variant="ghost"
                      aria-label={`编辑标签分类 ${root.name}`}
                      title="编辑标签分类"
                      disabled={!can("taxonomy")}
                      icon={<Pencil size={16} />}
                      onClick={() => openEditor(root)}
                    />
                  ) : null}
                </div>
              ))}
              {!matchingRoots.length ? (
                <Empty
                  title={query ? "没有匹配标签" : "暂无标签分类"}
                  description={
                    query ? "换个名称试试。" : "先新增标签分类，再添加标签。"
                  }
                />
              ) : null}
            </section>
            <section className="secondary-panel panel" aria-label="标签">
              <div className="section-heading">
                <div>
                  <h2>{selected?.name || "标签"}</h2>
                  <p>{children.length} 个标签</p>
                </div>
                <Button
                  variant="primary"
                  icon={<Plus size={16} />}
                  disabled={!selected || !can("taxonomy")}
                  onClick={() => selected && openEditor(undefined, selected.id)}
                >
                  新增标签
                </Button>
              </div>
              {selected && !selected.enabled ? (
                <p className="note">
                  此标签分类已停用，下属标签不能新增到内容；已有绑定保留。
                </p>
              ) : null}
              <div className="secondary-grid">
                {shownChildren.map((tag) => (
                  <article className="secondary-card" key={tag.id}>
                    <h3>{tag.name}</h3>
                    <div className="actions">
                      <Badge
                        tone={availableTag(state.tags, tag) ? "green" : "gray"}
                      >
                        {!tag.enabled
                          ? "已停用"
                          : selected?.enabled
                            ? "已启用"
                            : "标签分类已停用"}
                      </Badge>
                      <Badge tone="gray">
                        {tag.external ? "对外展示" : "仅内部"}
                      </Badge>
                    </div>
                    <div className="actions">
                      <Button
                        variant="ghost"
                        disabled={!can("taxonomy")}
                        onClick={() => toggleEnabled(tag)}
                      >
                        {tag.enabled ? "停用" : "启用"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!can("taxonomy")}
                        icon={<Pencil size={14} />}
                        onClick={() => openEditor(tag)}
                      >
                        编辑
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              {!shownChildren.length ? (
                <Empty
                  title={
                    children.length
                      ? "没有匹配的标签"
                      : selected
                        ? "还没有标签"
                        : "请选择标签分类"
                  }
                  description={
                    children.length
                      ? "换个名称试试。"
                      : selected
                        ? "在这个标签分类下添加标签，供内容选用。"
                        : "先在左侧选择或新增标签分类。"
                  }
                  action={
                    selected && !children.length && can("taxonomy") ? (
                      <Button
                        onClick={() => openEditor(undefined, selected.id)}
                      >
                        新增标签
                      </Button>
                    ) : undefined
                  }
                />
              ) : null}
            </section>
          </div>
        </>
      )}
      {editor ? (
        <Dialog
          title={`${editor.id ? "编辑" : "新增"}${editor.parentId === null ? "一级" : "二级"}标签`}
          onClose={() => setEditor(undefined)}
          footer={
            <>
              <Button onClick={() => setEditor(undefined)}>取消</Button>
              <Button
                variant="primary"
                disabled={!can("taxonomy")}
                onClick={saveTag}
              >
                保存标签
              </Button>
            </>
          }
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              saveTag();
            }}
          >
            <Field label="标签名称" required error={error}>
              <input
                className="input"
                autoFocus
                value={editor.name}
                onChange={(event) => {
                  setEditor({ ...editor, name: event.target.value });
                  setError("");
                }}
              />
            </Field>
            {editor.parentId !== null ? (
              <Field label="所属标签分类" required>
                <select
                  className="select"
                  value={editor.parentId}
                  onChange={(event) => {
                    setEditor({ ...editor, parentId: event.target.value });
                    setError("");
                  }}
                >
                  <option value="" disabled>
                    请选择标签分类
                  </option>
                  {roots.map((root) => (
                    <option key={root.id} value={root.id}>
                      {root.name}
                      {root.enabled ? "" : "（已停用）"}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <label className="actions">
              <input
                type="checkbox"
                checked={editor.enabled}
                onChange={(event) =>
                  setEditor({ ...editor, enabled: event.target.checked })
                }
              />
              启用此标签
            </label>
            <label className="actions">
              <input
                type="checkbox"
                checked={editor.external}
                onChange={(event) =>
                  setEditor({ ...editor, external: event.target.checked })
                }
              />
              允许对外展示
            </label>
            <button type="submit" hidden />
          </form>
          <p className="note">修改或停用标签不会删除已有内容绑定。</p>
        </Dialog>
      ) : null}
    </div>
  );
}
