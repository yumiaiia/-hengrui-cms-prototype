import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Tags as TagsIcon,
  X,
} from "lucide-react";
import { useCMS } from "../store";
import {
  current,
  dateLabel,
  go,
  groups,
  uid,
  type Binding,
  type Tag,
} from "../model";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Note,
  PageHeader,
  Pagination,
  SearchBox,
  Tabs,
} from "../components/ui";
import "./operations.css";

const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const tagKey = (name: string, group: string) =>
  `${normalize(group)}::${normalize(name)}`;
function descendants(id: string, tags: Tag[]) {
  const result = new Set<string>([id]);
  let previous = 0;
  while (previous !== result.size) {
    previous = result.size;
    for (const tag of tags)
      if (tag.parent && result.has(tag.parent)) result.add(tag.id);
  }
  return result;
}
function ancestors(tag: Tag, tags: Map<string, Tag>) {
  const result: Tag[] = [];
  const seen = new Set<string>([tag.id]);
  let parent = tag.parent ? tags.get(tag.parent) : undefined;
  while (parent && !seen.has(parent.id)) {
    result.unshift(parent);
    seen.add(parent.id);
    parent = parent.parent ? tags.get(parent.parent) : undefined;
  }
  return result;
}
type TagEditor = {
  id?: string;
  name: string;
  group: string;
  parent: string;
  synonyms: string;
  enabled: boolean;
  external: boolean;
};
type ConflictChoice = {
  taskId: string;
  index: number;
  mode: "keep" | "overwrite";
  bindingIndex: number;
};

export default function Tags() {
  const cms = useCMS();
  const { state, assets, user, can, update, toast, reprocess } = cms;
  const [tab, setTab] = useState(
    () =>
      new URLSearchParams(location.hash.split("?")[1]).get("tab") || "library",
  );
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [layout, setLayout] = useState("tree");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<TagEditor>();
  const [editorError, setEditorError] = useState("");
  const [suggestionStatus, setSuggestionStatus] = useState("待处理");
  const [selection, setSelection] = useState<string[]>([]);
  const [review, setReview] = useState<"accept" | "ignore">();
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [assetSelection, setAssetSelection] = useState<string[]>([]);
  const [protect, setProtect] = useState(true);
  const [rerunConfirm, setRerunConfirm] = useState(false);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState("");
  const [conflictChoice, setConflictChoice] = useState<ConflictChoice>();
  const [conflictConfirmed, setConflictConfirmed] = useState("");
  const [conflictError, setConflictError] = useState("");
  const [assetPage, setAssetPage] = useState(1);
  const closeEditor = useCallback(() => setEditor(undefined), []);
  const closeReview = useCallback(() => setReview(undefined), []);
  const closeRerun = useCallback(() => setRerunConfirm(false), []);
  const closeConflict = useCallback(() => setConflictChoice(undefined), []);
  useEffect(() => {
    setEditor(undefined);
    setReview(undefined);
    setSelection([]);
    setAssetSelection([]);
    setRerunConfirm(false);
    setConflictChoice(undefined);
  }, [user?.id]);
  const tagMap = new Map(state.tags.map((t) => [t.id, t]));
  const visibleIds = new Set(assets.map((a) => a.id));
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const query = search.trim().toLocaleLowerCase();
  const filteredTags = state.tags.filter(
    (t) =>
      (group === "all" || t.group === group) &&
      (enabledFilter === "all" ||
        t.enabled === (enabledFilter === "enabled")) &&
      `${t.name} ${t.group} ${t.synonyms.join(" ")}`
        .toLocaleLowerCase()
        .includes(query),
  );
  const filteredTagIds = new Set(filteredTags.map((t) => t.id));
  const treeIds = new Set(filteredTagIds);
  if (layout === "tree")
    for (const tag of filteredTags)
      for (const parent of ancestors(tag, tagMap)) treeIds.add(parent.id);
  const displayTags = state.tags.filter((t) => treeIds.has(t.id));
  const groupNames = [
    ...new Set([...groups, ...state.tags.map((t) => t.group)]),
  ];
  const treeRows = (groupName: string) => {
    const pool = displayTags.filter((t) => t.group === groupName);
    if (layout === "flat")
      return pool
        .filter((t) => filteredTagIds.has(t.id))
        .map((t) => ({ tag: t, depth: 0, hasChildren: false }));
    const rows: { tag: Tag; depth: number; hasChildren: boolean }[] = [];
    const visited = new Set<string>();
    const walk = (tag: Tag, depth: number) => {
      if (visited.has(tag.id)) return;
      visited.add(tag.id);
      const children = pool.filter((t) => t.parent === tag.id);
      rows.push({ tag, depth, hasChildren: children.length > 0 });
      if (query || !collapsed.has(tag.id))
        children.forEach((child) => walk(child, depth + 1));
      else for (const id of descendants(tag.id, pool)) visited.add(id);
    };
    pool
      .filter((t) => !t.parent || !pool.some((p) => p.id === t.parent))
      .forEach((tag) => walk(tag, 0));
    // Defensive fallback for older persisted taxonomies with invalid parent links.
    pool.filter((t) => !visited.has(t.id)).forEach((tag) => walk(tag, 0));
    return rows;
  };
  const visibleSuggestions = state.suggestions.filter((s) =>
    s.assetIds.some((id) => visibleIds.has(id)),
  );
  const suggestions = visibleSuggestions.filter(
    (s) =>
      (suggestionStatus === "all" || s.status === suggestionStatus) &&
      (group === "all" || s.group === group) &&
      `${s.name} ${s.group}`.toLocaleLowerCase().includes(query),
  );
  const pendingSelected = visibleSuggestions.filter(
    (s) => selection.includes(s.id) && s.status === "待处理",
  );
  const eligibleAssets = assets.filter((a) => a.lifecycle === "正常");
  const selectedAssets = eligibleAssets.filter((a) =>
    assetSelection.includes(a.id),
  );
  const matchingAssets = eligibleAssets.filter((a) =>
    `${a.code} ${current(a).title}`.toLocaleLowerCase().includes(query),
  );
  const actualAssetPage = Math.min(
    assetPage,
    Math.max(1, Math.ceil(matchingAssets.length / 8)),
  );
  const rerunTasks = state.tasks
    .filter((t) => t.type === "标签重跑")
    .flatMap((task) => {
      const items = task.items.filter(
        (item) => item.assetId && visibleIds.has(item.assetId),
      );
      const conflicts = (task.conflicts || [])
        .map((conflict, index) => ({ conflict, index }))
        .filter(({ conflict }) => visibleIds.has(conflict.assetId));
      return items.length || conflicts.length
        ? [
            {
              task,
              items,
              conflicts,
              completeScope:
                items.length === task.items.length &&
                conflicts.length === (task.conflicts?.length || 0),
            },
          ]
        : [];
    });
  const unresolvedCount = rerunTasks.reduce(
    (count, t) =>
      count + t.conflicts.filter((c) => !c.conflict.resolved).length,
    0,
  );
  const conflictTask = conflictChoice
    ? state.tasks.find(
        (t) => t.id === conflictChoice.taskId && t.type === "标签重跑",
      )
    : undefined;
  const conflict = conflictChoice
    ? conflictTask?.conflicts?.[conflictChoice.index]
    : undefined;
  const conflictAsset = conflict ? assetMap.get(conflict.assetId) : undefined;
  const conflictVersion = conflictAsset?.versions.find(
    (v) => v.number === conflict?.version,
  );
  const manualBindings =
    conflictVersion?.tags.flatMap((binding, index) =>
      binding.origin === "人工" && binding.tagId === conflict?.tagId
        ? [{ binding, index }]
        : [],
    ) || [];
  const proposedTag = conflict ? tagMap.get(conflict.proposedId) : undefined;
  const chosenBinding = conflictChoice
    ? conflictVersion?.tags[conflictChoice.bindingIndex]
    : undefined;
  const conflictScopeKey = JSON.stringify([
    conflictChoice?.taskId,
    conflictChoice?.index,
    conflictChoice?.bindingIndex,
    conflict?.version,
    conflict?.proposedId,
    chosenBinding,
  ]);
  const manualCount = selectedAssets.reduce(
    (sum, a) => sum + current(a).tags.filter((t) => t.origin === "人工").length,
    0,
  );
  const rerunScopeKey = JSON.stringify(
    selectedAssets.map((a) => [
      a.id,
      a.current,
      current(a).tags.filter((t) => t.origin === "人工"),
    ]),
  );
  const toggleSelection = (id: string) =>
    setSelection((previous) =>
      previous.includes(id)
        ? previous.filter((x) => x !== id)
        : [...previous, id],
    );
  const toggleAsset = (id: string) =>
    setAssetSelection((previous) =>
      previous.includes(id)
        ? previous.filter((x) => x !== id)
        : [...previous, id],
    );

  const openEditor = (tag?: Tag) => {
    if (!can("taxonomy")) return toast("当前角色没有标签库维护权限。");
    setEditor(
      tag
        ? {
            id: tag.id,
            name: tag.name,
            group: tag.group,
            parent: tag.parent || "",
            synonyms: tag.synonyms.join("，"),
            enabled: tag.enabled,
            external: tag.external,
          }
        : {
            name: "",
            group: group === "all" ? groups[0] : group,
            parent: "",
            synonyms: "",
            enabled: true,
            external: false,
          },
    );
    setEditorError("");
  };
  const saveTag = () => {
    if (!editor || !can("taxonomy")) return;
    const name = editor.name.trim().replace(/\s+/g, " ");
    if (!name || !editor.group) return setEditorError("标签名称和分组必填。");
    if (
      state.tags.some(
        (t) =>
          t.id !== editor.id &&
          tagKey(t.name, t.group) === tagKey(name, editor.group),
      )
    )
      return setEditorError(
        "同一分组已存在该名称，请编辑已有标签或使用同义词。",
      );
    const excluded = editor.id
      ? descendants(editor.id, state.tags)
      : new Set<string>();
    const parent = editor.parent ? tagMap.get(editor.parent) : undefined;
    if (
      editor.parent &&
      (!parent || parent.group !== editor.group || excluded.has(parent.id))
    )
      return setEditorError("父标签必须属于同一分组，不能选择自身或后代。");
    const synonyms = [
      ...new Map(
        editor.synonyms
          .split(/[,，;；\n]/)
          .map((s) => s.trim())
          .filter((s) => s && normalize(s) !== normalize(name))
          .map((s) => [normalize(s), s]),
      ).values(),
    ];
    const tag: Tag = {
      id: editor.id || uid("tag"),
      name,
      group: editor.group,
      parent: editor.parent || undefined,
      synonyms,
      enabled: editor.enabled,
      external: editor.external,
    };
    const previous = editor.id ? tagMap.get(editor.id) : undefined;
    if (editor.id && !previous)
      return setEditorError("该标签已不存在，请重新选择。");
    if (
      previous &&
      previous.group !== tag.group &&
      state.tags.some((t) => t.parent === previous.id && t.group !== tag.group)
    )
      return setEditorError(
        "该标签仍有子标签，请先调整子标签归属，再修改父标签分组。",
      );
    const ok = update(
      (s) => {
        if (editor.id)
          Object.assign(
            s.tags.find((t) => t.id === editor.id)!,
            tag,
          );
        else s.tags.push(tag);
      },
      {
        action: editor.id ? "编辑标准标签" : "新增标准标签",
        object: `${tag.group} / ${tag.name}`,
        detail: `父标签：${parent?.name || "无"}；同义词：${synonyms.join("、") || "无"}；${tag.enabled ? "启用" : "停用"}；${tag.external ? "对外展示" : "仅内部"}。仅维护标准库，不自动改写内容绑定。${previous ? `原定义：${JSON.stringify(previous)}` : ""}`,
        category: "标签",
      },
      "taxonomy",
    );
    if (ok) {
      setEditor(undefined);
      toast("标签已保存，不会自动修改已有内容的标签绑定。");
    }
  };
  const toggleEnabled = (tag: Tag) => {
    if (!can("taxonomy")) return;
    const ok = update(
      (s) => {
        const target = s.tags.find((t) => t.id === tag.id);
        if (target) target.enabled = !target.enabled;
      },
      {
        action: tag.enabled ? "停用标准标签" : "启用标准标签",
        object: `${tag.group} / ${tag.name}`,
        detail:
          "不删除标签，不改变已有版本绑定。停用标签不应作为新的识别候选。",
        category: "标签",
      },
      "taxonomy",
    );
    if (ok)
      toast(tag.enabled ? "标签已停用，已有版本绑定保留。" : "标签已启用。");
  };
  const openReview = (mode: "accept" | "ignore") => {
    if (!can("taxonomy")) return toast("处理建议需要标签库维护权限。");
    if (!pendingSelected.length) return toast("请选择待处理建议。");
    setReview(mode);
    setReviewConfirmed(false);
  };
  const applySuggestions = () => {
    if (
      !review ||
      !can("taxonomy") ||
      !pendingSelected.length ||
      !reviewConfirmed
    )
      return;
    if (pendingSelected.some((s) => !s.name.trim() || !s.group.trim()))
      return toast("建议名称或分组缺失，请先核对，不能创建空标签。");
    const ids = new Set(pendingSelected.map((s) => s.id));
    const newCount = new Set(
      pendingSelected
        .filter(
          (s) =>
            !state.tags.some(
              (t) => tagKey(t.name, t.group) === tagKey(s.name, s.group),
            ),
        )
        .map((s) => tagKey(s.name, s.group)),
    ).size;
    const ok = update(
      (s) => {
        const keys = new Set(s.tags.map((t) => tagKey(t.name, t.group)));
        for (const suggestion of s.suggestions.filter(
          (item) =>
            ids.has(item.id) &&
            item.status === "待处理" &&
            item.assetIds.some((id) => visibleIds.has(id)),
        )) {
          if (review === "ignore") {
            suggestion.status = "已忽略";
            continue;
          }
          const key = tagKey(suggestion.name, suggestion.group);
          if (!keys.has(key)) {
            s.tags.push({
              id: uid("tag"),
              name: suggestion.name.trim().replace(/\s+/g, " "),
              group: suggestion.group,
              synonyms: [],
              enabled: true,
              external: false,
            });
            keys.add(key);
          }
          suggestion.status = "已采纳";
        }
      },
      {
        action: review === "accept" ? "人工批量采纳标签建议" : "忽略标签建议",
        object: `${pendingSelected.length} 项建议`,
        detail: `${pendingSelected.map((s) => `${s.group}/${s.name}`).join("；")}。${review === "accept" ? `按名称 + 分组去重，新增 ${newCount} 个标准标签，已有定义保留；仅标记建议为已采纳，不自动关联内容。` : "仅标记建议为已忽略，不创建标准标签。"}`,
        category: "标签",
      },
      "taxonomy",
    );
    if (ok) {
      setSelection((previous) => previous.filter((id) => !ids.has(id)));
      setReview(undefined);
      toast(
        review === "accept"
          ? `建议已采纳，新增 ${newCount} 个标签，重复项复用已有定义。`
          : "建议已忽略，未新增标签。",
      );
    }
  };
  const startRerun = () => {
    if (!can("rerun") || !selectedAssets.length) return;
    if (!protect && overwriteConfirmed !== rerunScopeKey)
      return toast("覆盖人工标签需要明确确认。");
    reprocess(
      selectedAssets.map((a) => a.id),
      protect,
    );
    setRerunConfirm(false);
    setAssetSelection([]);
    setOverwriteConfirmed("");
  };
  const openConflict = (
    taskId: string,
    index: number,
    mode: "keep" | "overwrite",
  ) => {
    if (!can("rerun")) return toast("处理重跑差异需要重跑权限。");
    const task = state.tasks.find((t) => t.id === taskId);
    const c = task?.conflicts?.[index];
    const version = c
      ? assetMap.get(c.assetId)?.versions.find((v) => v.number === c.version)
      : undefined;
    if (
      !c ||
      c.resolved ||
      !version ||
      task?.status === "处理中" ||
      task?.status === "排队中"
    )
      return;
    const bindingIndex = version.tags.findIndex(
      (b) => b.tagId === c.tagId && b.origin === "人工",
    );
    setConflictChoice({ taskId, index, mode, bindingIndex });
    setConflictConfirmed("");
    setConflictError("");
  };
  const resolveConflict = () => {
    if (
      !conflictChoice ||
      !conflict ||
      !conflictTask ||
      !conflictAsset ||
      !conflictVersion ||
      !can("rerun")
    )
      return;
    if (conflict.resolved)
      return setConflictError("该差异已处理，请关闭窗口查看最新结果。");
    if (conflictTask.status === "处理中" || conflictTask.status === "排队中")
      return setConflictError("任务尚未结束，请等待完成后再处理差异。");
    const overwrite = conflictChoice.mode === "overwrite";
    if (
      overwrite &&
      (conflictConfirmed !== conflictScopeKey ||
        !proposedTag?.enabled ||
        !chosenBinding ||
        chosenBinding.origin !== "人工" ||
        chosenBinding.tagId !== conflict.tagId)
    )
      return setConflictError(
        "请选择需要覆盖的具体人工绑定，确认覆盖，且新标签必须存在并启用。",
      );
    const original: Binding | undefined = chosenBinding
      ? { ...chosenBinding }
      : undefined;
    const scope = chosenBinding?.page
      ? `第 ${chosenBinding.page} 页`
      : "文档级";
    const ok = update(
      (s) => {
        const task = s.tasks.find((t) => t.id === conflictChoice.taskId)!;
        const target = task.conflicts![conflictChoice.index];
        if (overwrite) {
          const v = s.assets
            .find((a) => a.id === target.assetId)!
            .versions.find((v) => v.number === target.version)!;
          const replacement: Binding = {
            ...v.tags[conflictChoice.bindingIndex],
            tagId: target.proposedId,
            origin: "AI",
          };
          if (
            v.tags.some(
              (b, index) =>
                index !== conflictChoice.bindingIndex &&
                b.tagId === replacement.tagId &&
                b.page === replacement.page,
            )
          )
            v.tags.splice(conflictChoice.bindingIndex, 1);
          else v.tags[conflictChoice.bindingIndex] = replacement;
        }
        target.resolved = true;
      },
      {
        action: overwrite ? "明确覆盖重跑差异" : "保留人工标签",
        object: `${conflictAsset.code} / V${conflict.version}`,
        detail: overwrite
          ? `${scope}；仅替换选定绑定 ${JSON.stringify(original)} → ${proposedTag!.name} (${proposedTag!.id})，其他版本与其他绑定不变，差异标记已处理。`
          : `保留当前人工结果，不修改任何标签绑定；差异 ${conflict.tagId} → ${conflict.proposedId} 标记已处理。`,
        category: "标签",
      },
      "rerun",
    );
    if (ok) {
      setConflictChoice(undefined);
      toast(
        overwrite
          ? "已仅覆盖指定版本的选定标签绑定。"
          : "已保留人工结果，差异标记为已处理。",
      );
    }
  };

  return (
    <div className="ops-page">
      <PageHeader
        eyebrow="CONTROLLED TAXONOMY"
        title="标签管理"
        description="维护标准标签，人工审阅候选建议；重跑默认保护已有人工结果。"
        action={
          can("taxonomy") ? (
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() => openEditor()}
            >
              新增标准标签
            </Button>
          ) : (
            <Badge tone="gray">标签库只读</Badge>
          )
        }
      />
      <div className="ops-scope-strip">
        <TagsIcon size={18} />
        <span>
          AI
          仅从标准标签库识别，未匹配词进入建议池；只有经人工采纳的建议才会成为标准标签。
        </span>
      </div>
      <section className="panel">
        <Tabs
          items={[
            { key: "library", label: "标准标签库", count: state.tags.length },
            {
              key: "suggestions",
              label: "未匹配建议",
              count: visibleSuggestions.filter((s) => s.status === "待处理")
                .length,
            },
            { key: "rerun", label: "批量重跑与差异", count: unresolvedCount },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value);
            setSearch("");
            setGroup("all");
            setSelection([]);
          }}
        />
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setAssetPage(1);
            }}
            placeholder={
              tab === "rerun"
                ? "搜索可见内容标题或编号"
                : "搜索名称、分组或同义词"
            }
          />
          {tab !== "rerun" ? (
            <select
              className="select"
              value={group}
              aria-label="筛选标签分组"
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="all">全部分组</option>
              {groupNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          ) : null}
          {tab === "library" ? (
            <>
              <select
                className="select"
                value={enabledFilter}
                aria-label="筛选标签状态"
                onChange={(e) => setEnabledFilter(e.target.value)}
              >
                <option value="all">启用与停用</option>
                <option value="enabled">仅启用</option>
                <option value="disabled">仅停用</option>
              </select>
              <div className="ops-view-toggle">
                <Button
                  variant={layout === "tree" ? "secondary" : "ghost"}
                  aria-pressed={layout === "tree"}
                  icon={<GitBranch size={16} />}
                  onClick={() => setLayout("tree")}
                >
                  树形
                </Button>
                <Button
                  variant={layout === "flat" ? "secondary" : "ghost"}
                  aria-pressed={layout === "flat"}
                  icon={<List size={16} />}
                  onClick={() => setLayout("flat")}
                >
                  平铺
                </Button>
              </div>
            </>
          ) : tab === "suggestions" ? (
            <select
              className="select"
              value={suggestionStatus}
              aria-label="筛选建议状态"
              onChange={(e) => setSuggestionStatus(e.target.value)}
            >
              <option>待处理</option>
              <option>已采纳</option>
              <option>已忽略</option>
              <option value="all">全部建议</option>
            </select>
          ) : (
            <Badge tone="gray">仅选择可见且正常的内容</Badge>
          )}
        </div>
        {tab === "library" ? (
          filteredTags.length ? (
            <div className="ops-taxonomy">
              {groupNames
                .filter(
                  (name) =>
                    (group === "all" || name === group) &&
                    filteredTags.some((t) => t.group === name),
                )
                .map((name) => (
                  <section className="ops-tag-group" key={name}>
                    <header className="ops-row">
                      <h3>{name}</h3>
                      <span className="muted ops-caption">
                        {filteredTags.filter((t) => t.group === name).length}{" "}
                        个匹配标签
                      </span>
                    </header>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>标签 / 层级</th>
                            <th>同义词</th>
                            <th>可见当前内容</th>
                            <th>类型</th>
                            <th>状态</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {treeRows(name).map(({ tag, depth, hasChildren }) => (
                            <tr
                              key={tag.id}
                              className={
                                !filteredTagIds.has(tag.id)
                                  ? "ops-ancestor-row"
                                  : ""
                              }
                            >
                              <td>
                                <div
                                  className="ops-tag-name"
                                  style={{ paddingLeft: depth * 22 }}
                                >
                                  {layout === "tree" ? (
                                    hasChildren ? (
                                      <button
                                        className="ops-tree-toggle"
                                        aria-label={`${collapsed.has(tag.id) ? "展开" : "折叠"} ${tag.name}`}
                                        aria-expanded={
                                          query ? true : !collapsed.has(tag.id)
                                        }
                                        disabled={!!query}
                                        onClick={() =>
                                          setCollapsed((previous) => {
                                            const next = new Set(previous);
                                            if (next.has(tag.id))
                                              next.delete(tag.id);
                                            else next.add(tag.id);
                                            return next;
                                          })
                                        }
                                      >
                                        {collapsed.has(tag.id) && !query ? (
                                          <ChevronRight size={16} />
                                        ) : (
                                          <ChevronDown size={16} />
                                        )}
                                      </button>
                                    ) : (
                                      <span className="ops-tree-spacer" />
                                    )
                                  ) : null}
                                  <strong>{tag.name}</strong>
                                </div>
                                {layout === "flat" && tag.parent ? (
                                  <p className="muted ops-caption">
                                    {ancestors(tag, tagMap)
                                      .map((p) => p.name)
                                      .join(" / ")}
                                  </p>
                                ) : null}
                              </td>
                              <td className="muted">
                                {tag.synonyms.join("、") || "—"}
                              </td>
                              <td>
                                {
                                  assets.filter((a) =>
                                    current(a).tags.some(
                                      (b) => b.tagId === tag.id,
                                    ),
                                  ).length
                                }{" "}
                                份
                              </td>
                              <td>
                                <Badge tone={tag.external ? "blue" : "gray"}>
                                  {tag.external ? "对外展示" : "仅内部"}
                                </Badge>
                              </td>
                              <td>
                                <Badge tone={tag.enabled ? "green" : "gray"}>
                                  {tag.enabled ? "已启用" : "已停用"}
                                </Badge>
                              </td>
                              <td>
                                <div className="actions">
                                  <Button
                                    variant="ghost"
                                    disabled={!can("taxonomy")}
                                    icon={<Pencil size={14} />}
                                    onClick={() => openEditor(tag)}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={!can("taxonomy")}
                                    onClick={() => toggleEnabled(tag)}
                                  >
                                    {tag.enabled ? "停用" : "启用"}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
            </div>
          ) : (
            <Empty
              title="没有匹配的标准标签"
              description="更换分组或搜索词；新增标签需要标签库维护权限。"
            />
          )
        ) : null}
        {tab === "suggestions" ? (
          <>
            <div className="ops-selection-bar">
              <span>
                已选 <strong>{pendingSelected.length}</strong> 项待处理建议
              </span>
              <div className="actions">
                <Button
                  disabled={!can("taxonomy") || !pendingSelected.length}
                  icon={<X size={15} />}
                  onClick={() => openReview("ignore")}
                >
                  忽略所选
                </Button>
                <Button
                  variant="primary"
                  disabled={!can("taxonomy") || !pendingSelected.length}
                  icon={<Check size={15} />}
                  onClick={() => openReview("accept")}
                >
                  审阅并采纳
                </Button>
              </div>
            </div>
            <Note>
              提及次数是建议的原始统计，不按内容数推算。跨可见范围的汇总不展示；来源链接只展示有权限查看的内容。采纳建议不会自动给内容打标。
            </Note>
            {suggestions.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="选择当前筛选的全部待处理建议"
                          disabled={
                            !can("taxonomy") ||
                            !suggestions.some((s) => s.status === "待处理")
                          }
                          checked={
                            suggestions.some((s) => s.status === "待处理") &&
                            suggestions
                              .filter((s) => s.status === "待处理")
                              .every((s) => selection.includes(s.id))
                          }
                          onChange={(e) => {
                            const ids = suggestions
                              .filter((s) => s.status === "待处理")
                              .map((s) => s.id);
                            setSelection((previous) =>
                              e.target.checked
                                ? [...new Set([...previous, ...ids])]
                                : previous.filter((id) => !ids.includes(id)),
                            );
                          }}
                        />
                      </th>
                      <th>建议名称 / 分组</th>
                      <th>提及次数</th>
                      <th>可见来源</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s) => {
                      const sources = s.assetIds.filter((id) =>
                        visibleIds.has(id),
                      );
                      return (
                        <tr key={s.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`选择建议 ${s.name}`}
                              disabled={
                                !can("taxonomy") || s.status !== "待处理"
                              }
                              checked={
                                selection.includes(s.id) &&
                                s.status === "待处理"
                              }
                              onChange={() => toggleSelection(s.id)}
                            />
                          </td>
                          <td>
                            <strong>{s.name}</strong>
                            <p className="muted ops-caption">{s.group}</p>
                            {state.tags.some(
                              (t) =>
                                tagKey(t.name, t.group) ===
                                tagKey(s.name, s.group),
                            ) ? (
                              <span className="muted ops-caption">
                                标准库已有同名同组标签
                              </span>
                            ) : null}
                          </td>
                          <td>
                            {sources.length === s.assetIds.length ? (
                              s.mentions
                            ) : (
                              <span className="muted">跨范围 · 不展示</span>
                            )}
                          </td>
                          <td>
                            <div className="ops-source-links">
                              {sources.map((id) => (
                                <button
                                  className="text-link"
                                  key={id}
                                  onClick={() => go(`content/${id}?tab=tags`)}
                                >
                                  {current(assetMap.get(id)!).title}
                                </button>
                              ))}
                            </div>
                            <span className="muted ops-caption">
                              {sources.length} 份可见内容
                            </span>
                          </td>
                          <td>
                            <Badge
                              tone={
                                s.status === "已采纳"
                                  ? "green"
                                  : s.status === "待处理"
                                    ? "amber"
                                    : "gray"
                              }
                            >
                              {s.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="没有匹配的标签建议"
                description="未匹配的词会进入建议池，由有标签库维护权限的人员审阅。"
              />
            )}
          </>
        ) : null}
        {tab === "rerun" ? (
          <>
            <div className="ops-selection-bar">
              <span>
                已选 <strong>{selectedAssets.length}</strong> 份可见内容 ·{" "}
                {manualCount} 个人工绑定
              </span>
              <div className="actions">
                <label className="ops-check">
                  <input
                    type="checkbox"
                    checked={protect}
                    disabled={!can("rerun")}
                    onChange={(e) => {
                      setProtect(e.target.checked);
                      setOverwriteConfirmed("");
                    }}
                  />
                  保护人工标签
                </label>
                <Button
                  variant="primary"
                  icon={<RefreshCw size={16} />}
                  disabled={!can("rerun") || !selectedAssets.length}
                  onClick={() => {
                    setRerunConfirm(true);
                    setOverwriteConfirmed("");
                  }}
                >
                  开始重跑
                </Button>
              </div>
            </div>
            <Note tone={protect ? "blue" : "amber"}>
              {protect
                ? "默认保留人工标签。重跑后的差异逐项核对，不需要重新确认所有正常标签。"
                : "已选择不保护人工标签。开始前必须明确确认覆盖范围；只影响所选内容的当前版本。"}
            </Note>
            {matchingAssets.length ? (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="选择全部筛选的可见内容"
                            disabled={!can("rerun")}
                            checked={
                              matchingAssets.length > 0 &&
                              matchingAssets.every((a) =>
                                assetSelection.includes(a.id),
                              )
                            }
                            onChange={(e) =>
                              setAssetSelection((previous) =>
                                e.target.checked
                                  ? [
                                      ...new Set([
                                        ...previous,
                                        ...matchingAssets.map((a) => a.id),
                                      ]),
                                    ]
                                  : previous.filter(
                                      (id) =>
                                        !matchingAssets.some(
                                          (a) => a.id === id,
                                        ),
                                    ),
                              )
                            }
                          />
                        </th>
                        <th>内容 / 当前版本</th>
                        <th>人工绑定</th>
                        <th>处理状态</th>
                        <th>标签状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchingAssets
                        .slice((actualAssetPage - 1) * 8, actualAssetPage * 8)
                        .map((a) => {
                          const v = current(a);
                          return (
                            <tr key={a.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`选择 ${v.title}`}
                                  disabled={!can("rerun")}
                                  checked={assetSelection.includes(a.id)}
                                  onChange={() => toggleAsset(a.id)}
                                />
                              </td>
                              <td>
                                <button
                                  className="text-link"
                                  onClick={() => go(`content/${a.id}?tab=tags`)}
                                >
                                  {v.title}
                                </button>
                                <p className="muted ops-caption ops-code">
                                  {a.code} / V{a.current}
                                </p>
                              </td>
                              <td>
                                {
                                  v.tags.filter((t) => t.origin === "人工")
                                    .length
                                }{" "}
                                个
                              </td>
                              <td>
                                <Badge>{v.process}</Badge>
                              </td>
                              <td>
                                <Badge>{v.tagStatus}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  total={matchingAssets.length}
                  page={actualAssetPage}
                  onChange={setAssetPage}
                />
              </>
            ) : (
              <Empty
                title="没有可重跑的内容"
                description="尝试其他搜索词；已作废内容不可重跑。"
              />
            )}
            <div className="ops-section-title">
              <h2>重跑任务</h2>
              <span className="muted">{unresolvedCount} 项差异待核对</span>
            </div>
            {rerunTasks.length ? (
              <div className="ops-task-list">
                {rerunTasks.map(({ task, items, conflicts, completeScope }) => {
                  const done = items.filter((i) => i.status === "完成").length;
                  const progress = items.length
                    ? Math.round((done / items.length) * 100)
                    : 0;
                  return (
                    <article className="ops-task-card" key={task.id}>
                      <div className="ops-row">
                        <div>
                          <h3>
                            {completeScope
                              ? task.name
                              : `标签重跑 · ${items.length} 份可见内容`}
                          </h3>
                          <p className="muted ops-caption">
                            {dateLabel(task.createdAt)} · 尝试 {task.attempts}{" "}
                            次 · 完成 {done} / {items.length} 项
                          </p>
                        </div>
                        <Badge>{task.status}</Badge>
                      </div>
                      <progress
                        className="ops-progress"
                        aria-label="可见重跑项完成进度"
                        max={100}
                        value={progress}
                      />
                      <div className="ops-task-items">
                        {items.map((item, i) => (
                          <div
                            className="ops-row"
                            key={`${item.assetId}:${item.version}:${i}`}
                          >
                            <div>
                              <button
                                className="text-link"
                                onClick={() =>
                                  go(
                                    `content/${item.assetId}?version=${item.version}&tab=tags`,
                                  )
                                }
                              >
                                {item.label} · V{item.version}
                              </button>
                              {item.error ? (
                                <p className="ops-danger-text ops-caption">
                                  {item.error}
                                </p>
                              ) : null}
                            </div>
                            <Badge>{item.status}</Badge>
                          </div>
                        ))}
                      </div>
                      {items.some(
                        (i) => i.status === "失败" || i.status === "部分失败",
                      ) ? (
                        <Button
                          disabled={!can("rerun") || !completeScope}
                          icon={<RefreshCw size={15} />}
                          onClick={() => {
                            if (can("rerun") && completeScope)
                              cms.retryTask(task.id);
                          }}
                        >
                          仅重试失败项
                        </Button>
                      ) : null}
                      {conflicts.length ? (
                        <div className="ops-conflict-list">
                          <h4>人工结果差异</h4>
                          {conflicts.map(({ conflict: c, index }) => {
                            const asset = assetMap.get(c.assetId)!;
                            const manual = tagMap.get(c.tagId);
                            const proposed = tagMap.get(c.proposedId);
                            return (
                              <div
                                className="ops-conflict"
                                key={`${c.assetId}:${c.version}:${index}`}
                              >
                                <div className="ops-row">
                                  <div>
                                    <button
                                      className="text-link"
                                      onClick={() =>
                                        go(
                                          `content/${c.assetId}?version=${c.version}&tab=tags`,
                                        )
                                      }
                                    >
                                      {asset.code} / V{c.version}
                                    </button>
                                    <p>
                                      <span className="ops-manual-tag">
                                        人工：{manual?.name || c.tagId}
                                      </span>
                                      <span className="muted">
                                        {" "}
                                        → AI 建议：
                                      </span>
                                      <strong>
                                        {proposed?.name || c.proposedId}
                                      </strong>
                                    </p>
                                  </div>
                                  {c.resolved ? (
                                    <Badge tone="green">已处理</Badge>
                                  ) : (
                                    <div className="actions">
                                      <Button
                                        disabled={
                                          !can("rerun") ||
                                          task.status === "处理中" ||
                                          task.status === "排队中"
                                        }
                                        onClick={() =>
                                          openConflict(task.id, index, "keep")
                                        }
                                      >
                                        保留人工
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        disabled={
                                          !can("rerun") ||
                                          !proposed?.enabled ||
                                          task.status === "处理中" ||
                                          task.status === "排队中"
                                        }
                                        onClick={() =>
                                          openConflict(
                                            task.id,
                                            index,
                                            "overwrite",
                                          )
                                        }
                                      >
                                        选择覆盖
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="muted ops-caption">
                          没有需要人工核对的标签差异。
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="暂无可见重跑任务"
                description="选择内容后开始重跑，任务进度和需要核对的差异会显示在这里。"
              />
            )}
          </>
        ) : null}
      </section>
      {editor ? (
        <Dialog
          title={editor.id ? "编辑标准标签" : "新增标准标签"}
          onClose={closeEditor}
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
          <div className="form-grid">
            <Field label="标签名称" required>
              <input
                className="input"
                value={editor.name}
                onChange={(e) => {
                  setEditor({ ...editor, name: e.target.value });
                  setEditorError("");
                }}
              />
            </Field>
            <Field label="分组" required>
              <select
                className="select"
                value={editor.group}
                onChange={(e) => {
                  setEditor({ ...editor, group: e.target.value, parent: "" });
                  setEditorError("");
                }}
              >
                {groupNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field
              label="父标签"
              hint="仅可选择同一分组的标签，不允许形成循环。"
            >
              <select
                className="select"
                value={editor.parent}
                onChange={(e) =>
                  setEditor({ ...editor, parent: e.target.value })
                }
              >
                <option value="">无 · 顶级标签</option>
                {state.tags
                  .filter(
                    (t) =>
                      t.group === editor.group &&
                      (!editor.id ||
                        !descendants(editor.id, state.tags).has(t.id)),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label="同义词"
              hint="用逗号、分号或换行分隔，保存时自动去重。"
            >
              <textarea
                className="textarea"
                rows={3}
                value={editor.synonyms}
                onChange={(e) =>
                  setEditor({ ...editor, synonyms: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="actions ops-form-checks">
            <label className="ops-check">
              <input
                type="checkbox"
                checked={editor.enabled}
                onChange={(e) =>
                  setEditor({ ...editor, enabled: e.target.checked })
                }
              />
              启用此标签
            </label>
            <label className="ops-check">
              <input
                type="checkbox"
                checked={editor.external}
                onChange={(e) =>
                  setEditor({ ...editor, external: e.target.checked })
                }
              />
              允许对外展示此标签
            </label>
          </div>
          <Note>
            修改标准库不会删除或批量改写已有版本标签。需要重新识别时，请在重跑页选择明确范围。
          </Note>
          {editorError ? (
            <div role="alert">
              <Note tone="red">{editorError}</Note>
            </div>
          ) : null}
        </Dialog>
      ) : null}
      {review ? (
        <Dialog
          title={review === "accept" ? "审阅并批量采纳建议" : "确认忽略建议"}
          onClose={closeReview}
          footer={
            <>
              <Button onClick={() => setReview(undefined)}>取消</Button>
              <Button
                variant={review === "accept" ? "primary" : "secondary"}
                disabled={
                  !can("taxonomy") ||
                  !pendingSelected.length ||
                  !reviewConfirmed
                }
                onClick={applySuggestions}
              >
                {review === "accept" ? "确认采纳所选" : "确认忽略所选"}
              </Button>
            </>
          }
        >
          <p>
            仅处理以下 <strong>{pendingSelected.length}</strong>{" "}
            项可见、待处理建议。
          </p>
          <div className="ops-review-list">
            {pendingSelected.map((s) => {
              const existing = state.tags.find(
                (t) => tagKey(t.name, t.group) === tagKey(s.name, s.group),
              );
              return (
                <div className="ops-row" key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <p className="muted ops-caption">{s.group}</p>
                  </div>
                  <Badge tone="gray">
                    {review === "ignore"
                      ? "不创建标签"
                      : existing
                        ? `复用已有${existing.enabled ? "" : "停用"}标签`
                        : "新增标准标签"}
                  </Badge>
                </div>
              );
            })}
          </div>
          <Note>
            {review === "accept"
              ? "按名称和分组去重。已有标签的启用状态、同义词与层级保持不变；仅创建缺失定义并将建议标记为已采纳，不自动关联内容。"
              : "建议标记为已忽略；不新增标签、不改变内容。"}
          </Note>
          <label className="ops-check">
            <input
              type="checkbox"
              checked={reviewConfirmed}
              onChange={(e) => setReviewConfirmed(e.target.checked)}
            />
            已核对以上建议名称与分组，确认
            {review === "accept" ? "采纳" : "忽略"}所选
          </label>
        </Dialog>
      ) : null}
      {rerunConfirm ? (
        <Dialog
          title="确认标签重跑范围"
          onClose={closeRerun}
          footer={
            <>
              <Button onClick={() => setRerunConfirm(false)}>取消</Button>
              <Button
                variant={protect ? "primary" : "danger"}
                disabled={
                  !can("rerun") ||
                  !selectedAssets.length ||
                  (!protect && overwriteConfirmed !== rerunScopeKey)
                }
                onClick={startRerun}
              >
                {protect ? "保护人工结果并重跑" : "确认覆盖人工结果并重跑"}
              </Button>
            </>
          }
        >
          <Note tone={protect ? "blue" : "amber"}>
            {protect
              ? "只重跑所选内容的当前版本；人工绑定保留，有差异再逐项核对。"
              : `所选当前版本中的 ${manualCount} 个人工绑定将被移除并重新识别。其他版本与未选内容不变。`}
          </Note>
          <div className="ops-review-list">
            {selectedAssets.map((a) => (
              <div className="ops-row" key={a.id}>
                <span>{current(a).title}</span>
                <span className="ops-code">
                  {a.code} / V{a.current}
                </span>
              </div>
            ))}
          </div>
          {!protect ? (
            <label className="ops-check">
              <input
                type="checkbox"
                checked={overwriteConfirmed === rerunScopeKey}
                onChange={(e) =>
                  setOverwriteConfirmed(e.target.checked ? rerunScopeKey : "")
                }
              />
              明确确认覆盖以上所选当前版本的人工标签，历史版本不变
            </label>
          ) : null}
        </Dialog>
      ) : null}
      {conflictChoice ? (
        <Dialog
          title={
            conflictChoice.mode === "keep"
              ? "保留人工标签"
              : "明确覆盖一个标签绑定"
          }
          onClose={closeConflict}
          footer={
            <>
              <Button onClick={() => setConflictChoice(undefined)}>取消</Button>
              <Button
                variant={conflictChoice.mode === "keep" ? "primary" : "danger"}
                disabled={
                  !can("rerun") ||
                  !conflictAsset ||
                  !conflictVersion ||
                  !!conflict?.resolved ||
                  (conflictChoice.mode === "overwrite" &&
                    (conflictConfirmed !== conflictScopeKey ||
                      !proposedTag?.enabled ||
                      !manualBindings.length))
                }
                onClick={resolveConflict}
              >
                {conflictChoice.mode === "keep"
                  ? "确认保留人工结果"
                  : "确认覆盖选定绑定"}
              </Button>
            </>
          }
        >
          {conflict && conflictAsset && conflictVersion ? (
            <>
              <p>
                <strong>
                  {conflictAsset.code} / V{conflict.version}
                </strong>{" "}
                · {conflictVersion.title}
              </p>
              <Note tone={conflictChoice.mode === "keep" ? "blue" : "amber"}>
                {conflictChoice.mode === "keep"
                  ? "不改变任何标签绑定，仅把此差异标记为已处理。"
                  : "只替换下面明确选择的人工绑定，保留该绑定的页码；其他绑定和其他版本不变。"}
              </Note>
              <p>
                原人工标签：
                <strong>
                  {tagMap.get(conflict.tagId)?.name || conflict.tagId}
                </strong>
                <br />
                AI 建议：
                <strong>{proposedTag?.name || conflict.proposedId}</strong>
              </p>
              {conflictChoice.mode === "overwrite" ? (
                <>
                  <Field label="选择具体版本绑定" required>
                    <select
                      className="select"
                      value={conflictChoice.bindingIndex}
                      onChange={(e) => {
                        setConflictChoice({
                          ...conflictChoice,
                          bindingIndex: Number(e.target.value),
                        });
                        setConflictConfirmed("");
                      }}
                    >
                      <option value={-1}>请选择绑定</option>
                      {manualBindings.map(({ binding, index }) => (
                        <option key={index} value={index}>
                          {binding.page ? `第 ${binding.page} 页` : "文档级"} ·{" "}
                          {tagMap.get(binding.tagId)?.name || binding.tagId} ·
                          人工
                        </option>
                      ))}
                    </select>
                  </Field>
                  {!manualBindings.length ? (
                    <Note tone="amber">
                      原人工绑定已不存在。请保留当前结果，不添加推测的绑定。
                    </Note>
                  ) : null}
                  <label className="ops-check">
                    <input
                      type="checkbox"
                      checked={conflictConfirmed === conflictScopeKey}
                      onChange={(e) =>
                        setConflictConfirmed(
                          e.target.checked ? conflictScopeKey : "",
                        )
                      }
                    />
                    明确确认仅覆盖选定版本的这个绑定
                  </label>
                </>
              ) : null}
              {conflictError ? (
                <div role="alert">
                  <Note tone="red">{conflictError}</Note>
                </div>
              ) : null}
            </>
          ) : (
            <Empty
              title="差异记录不再可见"
              description="请关闭窗口，从当前可见任务重新选择。"
            />
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
