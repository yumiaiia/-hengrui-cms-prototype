import { captureBindingNames } from "../tagResults";
import { useTagCheck } from "../components/TagSimilarity";
import { requireTagCheck } from "../tagSimilarity";
import { useEffect, useRef, useState } from "react";
import { tagUsage, tagImpact } from "../tagMatching";
import { SyncTagsDialog } from "../components/SyncTagsDialog";
import {
  applyTagImport,
  previewTagImport,
  readTagWorkbook,
  writeTagWorkbook,
  type TagImportPreview,
} from "../tagTransfer";
import { download } from "../storage";
import { Pencil, Plus } from "lucide-react";
import { useCMS } from "../store";
import { uid, go, type Tag } from "../model";
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
  const { state, user, can, update, toast } = useCMS();
  const { checkTag, similarityDialog } = useTagCheck();
  const [tab, setTab] = useState("library");
  const [search, setSearch] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [matching, setMatching] = useState(false);
  const [transfer, setTransfer] = useState<TagImportPreview>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeBatch = state.uploadBatches?.find(
    (b) =>
      b.kind === "tags" && b.items.some((i) => !i.archived && !i.cancelled),
  );
  const previous = state.tags.find((t) => t.id === editor?.id);
  const impacts =
    previous && editor
      ? tagImpact(previous, { ...editor, id: previous.id })
      : [];
  async function exportTags(template = false) {
    if (template ? !can("taxonomy") : !can("export")) return;
    setBusy(true);
    try {
      download(
        await writeTagWorkbook(state.tags, template),
        template ? "标签导入模板.xlsx" : "标签库.xlsx",
      );
    } catch {
      toast("Excel 文件生成失败");
    } finally {
      setBusy(false);
    }
  }
  async function importTags(file?: File) {
    if (!file || !can("taxonomy")) return;
    setBusy(true);
    try {
      if (!file.name.endsWith(".xlsx")) throw new Error("请选择 .xlsx 文件");
      setTransfer(
        previewTagImport(
          state,
          await readTagWorkbook(await file.arrayBuffer()),
        ),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Excel 文件读取失败");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  useEffect(() => {
    setEditor(undefined);
    setTransfer(undefined);
    setMatching(false);
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
    if (
      previous &&
      previous.name === draft.name &&
      previous.parentId === draft.parentId
    ) {
      persistTag();
      return;
    }
    try {
      checkTag(draft, (choice) => persistTag(choice.receipt));
    } catch (e) {
      setError(e instanceof Error ? e.message : "检查失败");
    }
  }
  function persistTag(receipt?: string) {
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
      locked: editor.locked,
      manualOnly: editor.manualOnly,
    };
    try {
      const ok = update(
        (s) => {
          const validation = validateTag(s.tags, tag);
          if (validation) throw new Error(validation);
          const previous = s.tags.find((item) => item.id === tag.id);
          if (previous?.locked)
            throw new Error("系统预置标签为字典写死集合，不可编辑或停用。");
          if (
            !previous ||
            previous.name !== tag.name ||
            previous.parentId !== tag.parentId
          )
            requireTagCheck(s.tags, tag, receipt);
          if (editor.id && !previous)
            throw new Error("标签已不存在，请重新选择。");
          if (
            previous &&
            (previous.parentId === null) !== (tag.parentId === null)
          )
            throw new Error("不能改变标签级别。");
          if (
            previous &&
            (previous.name !== tag.name || previous.parentId !== tag.parentId)
          )
            captureBindingNames(s);
          if (previous) Object.assign(previous, tag);
          else s.tags.push(tag);
        },
        {
          action: editor.id ? "编辑标签" : "新增标签",
          object: tagLabel(state.tags, tag),
          category: "标签",
        },
        "taxonomy",
      );
      if (ok) {
        setPrimaryId(tag.parentId || tag.id);
        setSearch("");
        setEditor(undefined);
        toast("标签已保存");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "标签保存失败。");
    }
  }

  return (
    <div>
      <PageHeader
        title="标签管理"
        action={
          <>
            <Button
              disabled={!can("taxonomy") || !can("tags")}
              onClick={() => {
                if (activeBatch) go(`upload/${activeBatch.id}`);
                else setMatching(true);
              }}
            >
              同步最新标签到文件
            </Button>
            <Button
              disabled={!can("taxonomy") || busy}
              onClick={() => fileInput.current?.click()}
            >
              导入
            </Button>
            <Button
              disabled={!can("export") || busy}
              onClick={() => void exportTags()}
            >
              导出全部标签
            </Button>
            <Button
              disabled={!can("taxonomy") || busy}
              onClick={() => void exportTags(true)}
            >
              下载模板
            </Button>
          </>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx"
        hidden
        aria-label="导入标签文件"
        onChange={(e) => void importTags(e.target.files?.[0])}
      />
      {activeBatch ? (
        <section className="panel match-result">
          <div className="section-heading">
            <div>
              <strong>有一批标签同步正在处理</strong>
              <p className="muted">完成后查看结果，确认后更新。</p>
            </div>
            <Button
              variant="primary"
              onClick={() => go(`upload/${activeBatch.id}`)}
            >
              继续查看结果
            </Button>
          </div>
        </section>
      ) : null}
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
              {matchingRoots.map((root) => {
                const children = state.tags.filter(
                  (tag) => tag.parentId === root.id,
                );
                return (
                  <div
                    key={root.id}
                    className={`primary-row ${selected?.id === root.id ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected?.id === root.id}
                      onClick={() => setPrimaryId(root.id)}
                    >
                      <strong>
                        {root.name}
                        {children.some((tag) => tag.locked) ? (
                          <i className="primary-preset-mark" title="含系统预置标签">
                            系统预置
                          </i>
                        ) : null}
                        {children.some((tag) => tag.manualOnly) ? (
                          <i
                            className="primary-manual-mark"
                            title="含仅人工标注标签"
                          >
                            仅人工标注
                          </i>
                        ) : null}
                      </strong>
                      <span>
                        {children.length} 个标签
                        {children.some((tag) => tag.locked)
                          ? ` · 预置 ${children.filter((tag) => tag.locked).length}`
                          : ""}
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
                );
              })}
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
                      {!availableTag(state.tags, tag) ? (
                        <Badge>
                          {!tag.enabled ? "已停用" : "标签分类已停用"}
                        </Badge>
                      ) : null}
                      {tag.locked ? (
                        <Badge tone="gray">系统预置</Badge>
                      ) : null}
                      {tag.manualOnly ? (
                        <Badge tone="blue">仅人工标注</Badge>
                      ) : null}
                      {tag.external ? <span>对外展示</span> : null}
                    </div>
                    <div className="actions">
                      {tag.locked ? (
                        <small className="muted">系统预置标签不可编辑或停用</small>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            aria-label={`${tag.enabled ? "停用" : "启用"}标签 ${tag.name}`}
                            disabled={!can("taxonomy")}
                            onClick={() => {
                              openEditor(tag);
                              if (can("taxonomy"))
                                setEditor({ ...tag, enabled: !tag.enabled });
                            }}
                          >
                            {tag.enabled ? "停用" : "启用"}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!can("taxonomy")}
                            icon={<Pencil size={14} />}
                            aria-label={`编辑标签 ${tag.name}`}
                            onClick={() => openEditor(tag)}
                          >
                            编辑
                          </Button>
                        </>
                      )}
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
      {matching ? <SyncTagsDialog onClose={() => setMatching(false)} /> : null}
      {transfer ? (
        <Dialog
          wide
          title="标签导入预览"
          onClose={() => setTransfer(undefined)}
          footer={
            <>
              <Button onClick={() => setTransfer(undefined)}>取消</Button>
              <Button
                variant="primary"
                disabled={
                  !can("taxonomy") ||
                  transfer.rows.some(
                    (r) =>
                      r.error || (!!r.similar?.length && r.decision !== "keep"),
                  ) ||
                  !(transfer.added + transfer.updated)
                }
                onClick={() => {
                  try {
                    if (
                      update(
                        (s) => applyTagImport(s, transfer),
                        {
                          action: "导入标签",
                          object: `新增 ${transfer.added} 个，更新 ${transfer.updated} 个标签`,
                          category: "标签",
                        },
                        "taxonomy",
                      )
                    ) {
                      setTransfer(undefined);
                      toast("标签已导入");
                    }
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "导入失败");
                  }
                }}
              >
                确认导入
              </Button>
            </>
          }
        >
          <p>
            新增 {transfer.added} · 更新 {transfer.updated} · 无变化{" "}
            {transfer.unchanged} · 错误{" "}
            {transfer.rows.filter((r) => r.error).length} · 影响{" "}
            {transfer.affected} 个文件
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>名称</th>
                  <th>变更</th>
                  <th>影响</th>
                  <th>相似检查 / 处理</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {transfer.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.sheet} 第 {r.row} 行
                    </td>
                    <td>{r.name}</td>
                    <td>{r.action}</td>
                    <td>{r.changes || "—"}</td>
                    <td className="tag-import-choice">
                      {r.similar?.length ? (
                        <>
                          <small>
                            {r.similar
                              .map(
                                (t) =>
                                  `${t.name}（${transfer.tags.find((p) => p.id === t.parentId)?.name || "标签分类"}${t.enabled ? "" : " / 停用"}）`,
                              )
                              .join("、")}
                          </small>
                          <select
                            aria-label={`${r.name}相似处理`}
                            value={r.decision || ""}
                            onChange={(e) =>
                              setTransfer(
                                previewTagImport(state, transfer.input, {
                                  ...transfer.decisions,
                                  [`${r.sheet}-${r.row}`]: e.target.value as
                                    "keep" | "skip",
                                }),
                              )
                            }
                          >
                            <option value="">请选择</option>
                            <option value="keep">仍然入库</option>
                            <option value="skip">跳过该行</option>
                          </select>
                        </>
                      ) : r.decision === "skip" ? (
                        <Button
                          onClick={() => {
                            const decisions = { ...transfer.decisions };
                            delete decisions[`${r.sheet}-${r.row}`];
                            setTransfer(
                              previewTagImport(
                                state,
                                transfer.input,
                                decisions,
                              ),
                            );
                          }}
                        >
                          恢复该行
                        </Button>
                      ) : (
                        "无相似命中"
                      )}
                    </td>
                    <td className="error-text">{r.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      ) : null}
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
          {previous ? (
            <div className="tag-impact" role="status">
              <strong>已应用于 {tagUsage(state, [previous.id])} 个文件</strong>
              {impacts.map((x) => (
                <p key={x}>{x}</p>
              ))}
              <p>已有绑定保留，修改不会自动发布内容。</p>
            </div>
          ) : null}
        </Dialog>
      ) : null}
      {similarityDialog}
    </div>
  );
}
