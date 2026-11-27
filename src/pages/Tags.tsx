import { captureBindingNames } from "../tagResults";
import { useTagCheck } from "../components/TagSimilarity";
import { requireTagCheck } from "../tagSimilarity";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  X,
} from "lucide-react";
import {
  priorityConflict,
  recalcRules,
  validateRuleDraft,
} from "../ruleImpact";
import { SyncTagsDialog } from "../components/SyncTagsDialog";
import {
  applyTagImport,
  previewTagImport,
  readTagWorkbook,
  writeTagWorkbook,
  type TagImportPreview,
} from "../tagTransfer";
import { download } from "../storage";
import { useCMS } from "../store";
import {
  uid,
  go,
  current,
  VISIBILITY_FIELD,
  audienceLabel,
  type Rule,
  type Tag,
} from "../model";
import { applyRules, audiencesOf } from "../tagResults";
import { availableTag, validateTag } from "../taxonomy";
import { referenceDimensionOrder } from "../referenceTags";
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

type Editor =
  | { kind: "dimension"; draft: Tag; id?: string }
  | { kind: "value"; draft: Tag; id?: string };

const parseAliases = (value: string) =>
  [
    ...new Set(
      value
        .split(/[\n,，、;；]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
const dimensionName = (tags: Tag[], id: string) =>
  tags.find((t) => t.id === id)?.name || "已删除维度";


function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          disabled={disabled}
          className={option.value === value ? "on" : ""}
          aria-pressed={option.value === value}
          onClick={() => !disabled && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DimensionChips({
  dimensions,
  value,
  onChange,
}: {
  dimensions: Tag[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="dim-chips">
      {dimensions.map((dimension) => (
        <button
          type="button"
          key={dimension.id}
          className={dimension.id === value ? "on" : ""}
          aria-pressed={dimension.id === value}
          onClick={() => onChange(dimension.id)}
        >
          {dimension.name}
          {dimension.kind === "enum" ? <i>字段</i> : null}
        </button>
      ))}
    </div>
  );
}

function ValuePicker({
  values,
  selected,
  onChange,
  single = false,
}: {
  values: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
}) {
  const [query, setQuery] = useState("");
  const enabled = values.filter((value) => value.enabled);
  const chosen = selected
    .map((id) => values.find((value) => value.id === id))
    .filter((value): value is Tag => !!value);
  const keyword = query.trim().toLowerCase();
  const rest = enabled.filter(
    (value) =>
      !selected.includes(value.id) &&
      (!keyword || value.name.toLowerCase().includes(keyword)),
  );
  const toggle = (id: string) =>
    onChange(
      single
        ? selected.includes(id)
          ? []
          : [id]
        : selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id],
    );
  return (
    <div className="picker">
      <div className="picker-chosen">
        <span className="picker-label">已选</span>
        {chosen.length ? (
          chosen.map((value) => (
            <button
              type="button"
              key={value.id}
              className="chip on"
              onClick={() => toggle(value.id)}
              title="移除"
            >
              {value.name}
              <X size={12} />
            </button>
          ))
        ) : (
          <span className="picker-empty">还没有选择</span>
        )}
      </div>
      <div className="picker-tools">
        <SearchBox value={query} onChange={setQuery} placeholder="搜索并添加" />
        <span className="picker-count">
          {selected.length} / {enabled.length}
        </span>
      </div>
      <div className="picker-grid">
        {rest.map((value) => (
          <button
            type="button"
            key={value.id}
            className="chip"
            onClick={() => toggle(value.id)}
          >
            <Plus size={12} />
            {value.name}
          </button>
        ))}
        {!rest.length ? (
          <span className="picker-empty">没有更多可选</span>
        ) : null}
      </div>
    </div>
  );
}

function AssetPicker({
  assets,
  selected,
  onPick,
}: {
  assets: ReturnType<typeof useCMS>["state"]["assets"];
  selected: string;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const keyword = query.trim().toLowerCase();
  const list = assets.filter((asset) => {
    const version = current(asset);
    return (
      !keyword ||
      version.title.toLowerCase().includes(keyword) ||
      asset.code.toLowerCase().includes(keyword)
    );
  });
  return (
    <div className="asset-picker" ref={ref}>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="搜索标题或内容编号"
      />
      <div className="asset-list">
        {list.map((asset) => (
          <button
            type="button"
            key={asset.id}
            className={asset.id === selected ? "on" : ""}
            onClick={() => onPick(asset.id)}
          >
            <strong>{current(asset).title}</strong>
            <small>
              {asset.code} · V{asset.current}.0
            </small>
          </button>
        ))}
        {!list.length ? <p className="muted">没有匹配的内容</p> : null}
      </div>
    </div>
  );
}

function RuleTrial({
  rule,
  state,
}: {
  rule: Rule;
  state: ReturnType<typeof useCMS>["state"];
}) {
  const [assetId, setAssetId] = useState("");
  const [picking, setPicking] = useState(false);
  const asset = state.assets.find((item) => item.id === assetId);
  const total = state.tags.filter(
    (tag) => tag.parentId === VISIBILITY_FIELD && tag.enabled,
  ).length;
  const result = useMemo(() => {
    if (!asset) return undefined;
    const probe = structuredClone(current(asset));
    probe.tags = probe.tags.filter((binding) => binding.origin !== "规则");
    applyRules(
      probe,
      state.tags,
      [...state.rules.filter((item) => item.id !== rule.id), rule],
    );
    return {
      audiences: audiencesOf(probe, state.tags),
      derived: probe.tags
        .filter((binding) => binding.origin === "规则" && !binding.page)
        .map((binding) => state.tags.find((t) => t.id === binding.tagId)?.name)
        .filter(Boolean) as string[],
    };
  }, [asset, rule, state.rules, state.tags]);
  return (
    <section className="trial">
      <div className="trial-head">
        <strong>试算</strong>
        <button
          type="button"
          className="trial-pick"
          onClick={() => setPicking((value) => !value)}
        >
          {asset ? `${asset.code} · ${current(asset).title}` : "选择一份内容"}
        </button>
        {asset ? (
          <button
            type="button"
            className="text-link"
            onClick={() => setAssetId("")}
          >
            清除
          </button>
        ) : null}
      </div>
      {picking ? (
        <AssetPicker
          assets={state.assets}
          selected={assetId}
          onPick={(id) => {
            setAssetId(id);
            setPicking(false);
          }}
        />
      ) : result ? (
        <div className="trial-result">
          <span>可见范围</span>
          <strong>{audienceLabel(result.audiences, total)}</strong>
          <span>规则产物</span>
          <strong>{result.derived.join("、") || "无"}</strong>
        </div>
      ) : null}
    </section>
  );
}

function RuleEditor({
  rule,
  onClose,
  onSave,
}: {
  rule: Rule;
  onClose: () => void;
  onSave: (rule: Rule) => void;
}) {
  const { state } = useCMS();
  const [draft, setDraft] = useState<Rule>(rule);
  const dimensions = state.tags.filter((tag) => !tag.parentId && tag.enabled);
  const valuesOf = (id: string) => state.tags.filter((tag) => tag.parentId === id);
  const triggerValues = valuesOf(draft.trigger.dimensionId).filter(
    (t) => !t.derivedOnly,
  );
  const actionDim = dimensions.find((t) => t.id === draft.action.dimensionId);
  const actionValues = valuesOf(draft.action.dimensionId);
  const sameDimension =
    draft.trigger.dimensionId === draft.action.dimensionId;
  const priorityClash = priorityConflict(state.rules, draft);
  const ruleError = validateRuleDraft(state.tags, state.rules, draft);
  const invalid = !!ruleError;
  const submit = () => {
    if (!invalid) onSave({ ...draft, name: draft.name.trim() });
  };
  return (
    <Dialog
      wide
      className="rule-dialog"
      title={state.rules.some((item) => item.id === rule.id) ? "编辑规则" : "新建规则"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={invalid} onClick={submit}>
            保存规则
          </Button>
        </>
      }
    >
      <form
        className="rule-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rule-meta-row">
          <input
            className="input rule-name"
            autoFocus
            value={draft.name}
            placeholder="规则名称，如：指南类内容对全量开放"
            aria-label="规则名称"
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          <label className="rule-priority-field">
            <span>优先级</span>
            <input
              className="input"
              type="number"
              value={draft.priority}
              aria-label="优先级"
              onChange={(event) =>
                setDraft({ ...draft, priority: Number(event.target.value) })
              }
            />
          </label>
        </div>
        {sameDimension ? (
          <p className="error-text">触发维度和结果维度不能相同。</p>
        ) : priorityClash ? (
          <p className="error-text">
            该维度已有优先级 {draft.priority}（{priorityClash.name}），请换一个。
          </p>
        ) : ruleError &&
          (draft.action.valueIds.length > 1 ||
            draft.trigger.valueIds.some(
              (id) => state.tags.find((t) => t.id === id)?.derivedOnly,
            ) ||
            !Number.isInteger(draft.priority)) ? (
          <p className="error-text">{ruleError}</p>
        ) : null}
        <div className="rule-builder">
          <section className="rule-panel">
            <header>
              <strong>触发条件</strong>
              <Segmented
                value={draft.trigger.match}
                options={[
                  { value: "any", label: "任一" },
                  { value: "all", label: "全部" },
                ]}
                onChange={(match) =>
                  setDraft({
                    ...draft,
                    trigger: { ...draft.trigger, match },
                  })
                }
              />
            </header>
            <DimensionChips
              dimensions={dimensions}
              value={draft.trigger.dimensionId}
              onChange={(dimensionId) =>
                setDraft({
                  ...draft,
                  trigger: { ...draft.trigger, dimensionId, valueIds: [] },
                })
              }
            />
            <ValuePicker
              values={triggerValues}
              selected={draft.trigger.valueIds}
              onChange={(ids) =>
                setDraft({
                  ...draft,
                  trigger: { ...draft.trigger, valueIds: ids },
                })
              }
            />
          </section>
          <div className="rule-arrow">
            <ArrowRight size={16} />
          </div>
          <section className="rule-panel">
            <header>
              <strong>结果</strong>
              <span className="muted">
                {actionDim?.cardinality === "single"
                  ? "单值维度（仅选 1 项）"
                  : "命中后写入"}
              </span>
            </header>
            <DimensionChips
              dimensions={dimensions}
              value={draft.action.dimensionId}
              onChange={(dimensionId) =>
                setDraft({
                  ...draft,
                  action: { dimensionId, valueIds: [] },
                })
              }
            />
            <ValuePicker
              values={actionValues}
              selected={draft.action.valueIds}
              single={actionDim?.cardinality === "single"}
              onChange={(ids) =>
                setDraft({
                  ...draft,
                  action: { ...draft.action, valueIds: ids },
                })
              }
            />
          </section>
        </div>
        <RuleTrial rule={draft} state={state} />
      </form>
    </Dialog>
  );
}

export default function Tags() {
  const { state, user, can, update, toast } = useCMS();
  const { checkTag, similarityDialog } = useTagCheck();
  const [tab, setTab] = useState("library");
  const [search, setSearch] = useState("");
  const [dimensionId, setDimensionId] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [matching, setMatching] = useState(false);
  const [transfer, setTransfer] = useState<TagImportPreview>();
  const [busy, setBusy] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<Rule>();
  const fileInput = useRef<HTMLInputElement>(null);
  const activeBatch = state.uploadBatches?.find(
    (b) =>
      b.kind === "tags" && b.items.some((i) => !i.archived && !i.cancelled),
  );
  const previous = state.tags.find((t) => t.id === editor?.id);

  const rank = (name: string) => {
    const index = referenceDimensionOrder.indexOf(name);
    return index < 0 ? 99 : index;
  };
  const dimensions = state.tags
    .filter((t) => !t.parentId)
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const groups = [
    {
      key: "taxonomy",
      label: "分类维度",
      hint: "业务标签，可增删",
      list: dimensions.filter((t) => t.kind !== "enum"),
    },
    {
      key: "enum",
      label: "字段",
      hint: "内容属性，值可维护",
      list: dimensions.filter((t) => t.kind === "enum"),
    },
  ];
  const selected =
    dimensions.find((t) => t.id === dimensionId) || groups[0].list[0];
  const values = selected
    ? state.tags.filter((t) => t.parentId === selected.id)
    : [];
  const query = search.trim().toLowerCase();
  const shownValues = values.filter(
    (t) =>
      !query ||
      t.name.toLowerCase().includes(query) ||
      (t.aliases || []).some((a) => a.toLowerCase().includes(query)),
  );
  const rulesUsing = selected
    ? state.rules.filter(
        (r) =>
          r.trigger.dimensionId === selected.id ||
          r.action.dimensionId === selected.id,
      )
    : [];

  useEffect(() => {
    setEditor(undefined);
    setTransfer(undefined);
    setMatching(false);
    setRuleDraft(undefined);
  }, [user?.id]);

  async function exportTags(template = false) {
    if (template ? !can("taxonomy") : !can("export")) return;
    setBusy(true);
    try {
      download(
        await writeTagWorkbook(state.tags, state.rules, template),
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

  function openDimension(tag?: Tag) {
    if (!can("taxonomy")) return;
    setError("");
    setEditor({
      kind: "dimension",
      id: tag?.id,
      draft: tag
        ? { ...tag }
        : {
            id: "",
            name: "",
            parentId: null,
            enabled: true,
            external: false,
            kind: "taxonomy",
            cardinality: "multi",
            scope: "material",
            ai: "closed",
            merge: "union",
          },
    });
  }
  function openValue(tag?: Tag) {
    if (!selected || !can("taxonomy")) return;
    setError("");
    setEditor({
      kind: "value",
      id: tag?.id,
      draft: tag
        ? { ...tag }
        : {
            id: "",
            name: "",
            parentId: selected.id,
            enabled: true,
            external: false,
            order: values.length + 1,
          },
    });
  }

  function persist(editor: Editor, receipt?: string) {
    const tag: Tag = {
      ...editor.draft,
      id: editor.id || uid("tag"),
      name: editor.draft.name.trim(),
      aliases:
        editor.kind === "value" && editor.draft.aliases?.length
          ? parseAliases(editor.draft.aliases.join("\n"))
          : undefined,
    };
    if (!tag.name) return setError("请输入名称");
    if (editor.kind === "value" && !tag.parentId)
      return setError("请选择所属维度。");
    if (editor.kind === "value") {
      const message = validateTag(state.tags, tag);
      if (message) return setError(message);
    }
    try {
      const ok = update(
        (s) => {
          const old = s.tags.find((item) => item.id === tag.id);
          if (editor.id && !old) throw new Error("记录已不存在，请重新选择。");
          if (old && (old.parentId === null) !== (tag.parentId === null))
            throw new Error("不能改变维度与取值的层级。");
          if (
            tag.parentId &&
            (!old || old.name !== tag.name || old.parentId !== tag.parentId)
          )
            requireTagCheck(s.tags, tag, receipt);
          if (old && (old.name !== tag.name || old.parentId !== tag.parentId))
            captureBindingNames(s);
          if (old) Object.assign(old, tag);
          else s.tags.push(tag);
        },
        {
          action: editor.id
            ? editor.kind === "dimension"
              ? "编辑维度"
              : "编辑取值"
            : editor.kind === "dimension"
              ? "新增维度"
              : "新增取值",
          object:
            editor.kind === "dimension"
              ? tag.name
              : `${dimensionName(state.tags, tag.parentId || "")} / ${tag.name}`,
          category: "标签",
          module: "标签管理",
        },
        "taxonomy",
      );
      if (ok) {
        setEditor(undefined);
        setDimensionId(tag.parentId || tag.id);
        toast(editor.kind === "dimension" ? "维度已保存" : "取值已保存");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败。");
    }
  }
  function saveTag() {
    if (!editor || !can("taxonomy")) return;
    if (editor.kind === "value") {
      const draft = editor.draft;
      if (
        previous &&
        previous.name === draft.name.trim() &&
        previous.parentId === draft.parentId
      ) {
        persist(editor);
        return;
      }
      try {
        checkTag(
          { ...draft, name: draft.name.trim() },
          (choice) => persist(editor, choice.receipt),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "检查失败");
      }
      return;
    }
    persist(editor);
  }

  function saveRule(rule: Rule) {
    if (!can("taxonomy")) return;
    const next = { ...rule, id: rule.id || uid("rule") };
    const message = validateRuleDraft(state.tags, state.rules, next);
    if (message) {
      toast(message);
      return;
    }
    let changed = 0;
    const ok = update(
      (s) => {
        const old = s.rules.find((r) => r.id === next.id);
        if (old) Object.assign(old, next);
        else s.rules.push(next);
        changed = recalcRules(s);
      },
      {
        action: state.rules.some((r) => r.id === next.id)
          ? "编辑规则"
          : "新增规则",
        object: next.name,
        category: "标签",
        module: "标签管理",
        detail: `${dimensionName(state.tags, next.trigger.dimensionId)} → ${dimensionName(state.tags, next.action.dimensionId)}`,
      },
      "taxonomy",
    );
    if (ok) {
      setRuleDraft(undefined);
      toast(changed ? `规则已保存，重算 ${changed} 份内容` : "规则已保存");
    }
  }
  function toggleRule(rule: Rule) {
    let changed = 0;
    const ok = update(
      (s) => {
        const target = s.rules.find((r) => r.id === rule.id);
        if (target) target.enabled = !target.enabled;
        changed = recalcRules(s);
      },
      {
        action: rule.enabled ? "停用规则" : "启用规则",
        object: rule.name,
        category: "标签",
        module: "标签管理",
      },
      "taxonomy",
    );
    if (ok && changed) toast(`已重算 ${changed} 份内容`);
  }
  function removeRule(rule: Rule) {
    if (
      !window.confirm(
        `删除规则「${rule.name}」？将立即重算正式内容当前版本，自动撤销该规则产物（人工值保留）。`,
      )
    )
      return;
    let changed = 0;
    const ok = update(
      (s) => {
        s.rules = s.rules.filter((r) => r.id !== rule.id);
        changed = recalcRules(s);
      },
      {
        action: "删除规则",
        object: rule.name,
        category: "标签",
        module: "标签管理",
      },
      "taxonomy",
    );
    if (ok && changed) toast(`已重算 ${changed} 份内容`);
  }
  function toggleValue(tag: Tag) {
    if (tag.enabled) {
      const refRules = state.rules.filter(
        (r) =>
          r.enabled &&
          (r.trigger.valueIds.includes(tag.id) ||
            r.action.valueIds.includes(tag.id)),
      );
      const fallbackDim = state.tags.find(
        (t) => !t.parentId && t.fallbackId === tag.id,
      );
      const hints: string[] = [];
      if (refRules.length)
        hints.push(`当前有 ${refRules.length} 条启用规则正在引用该取值`);
      if (fallbackDim)
        hints.push(`该取值正作为字段「${fallbackDim.name}」的兜底值`);
      if (
        hints.length &&
        !window.confirm(`${hints.join("；")}。确认停用「${tag.name}」并立即重算当前版本？`)
      )
        return;
    }
    let changed = 0;
    const ok = update(
      (s) => {
        const target = s.tags.find((t) => t.id === tag.id);
        if (target) target.enabled = !target.enabled;
        changed = recalcRules(s);
      },
      {
        action: tag.enabled ? "停用取值" : "启用取值",
        object: tag.name,
        category: "标签",
        module: "标签管理",
      },
      "taxonomy",
    );
    if (ok)
      toast(
        `${tag.enabled ? "已停用" : "已启用"}${changed ? `，重算 ${changed} 份内容` : ""}`,
      );
  }

  return (
    <div>
      <PageHeader
        title="标签与规则"
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
          { key: "library", label: "维度与值" },
          { key: "rules", label: "派生规则", count: state.rules.length },
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
      ) : tab === "rules" ? (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>派生规则</h2>
                <p>{state.rules.length} 条</p>
              </div>
              <div className="actions">
                <Button
                  variant="primary"
                  icon={<Plus size={16} />}
                  disabled={!can("taxonomy")}
                  onClick={() =>
                  setRuleDraft({
                    id: "",
                    name: "",
                    enabled: true,
                    priority: 50,
                    trigger: {
                      dimensionId: dimensions[0]?.id || "",
                      valueIds: [],
                      match: "any",
                    },
                    action: {
                      dimensionId: VISIBILITY_FIELD,
                      valueIds: [],
                    },
                  })
                }
              >
                  新建规则
                </Button>
              </div>
            </div>
            {state.rules.length ? (
              <div className="rule-list">
                {[...state.rules]
                  .sort((a, b) => a.priority - b.priority)
                  .map((rule) => {
                    const partial = rule.action.valueIds.some(
                      (id) => !state.tags.find((t) => t.id === id)?.enabled,
                    );
                    const chips = (ids: string[]) =>
                      ids.slice(0, 3).map((id) => (
                        <span className="flow-chip" key={id}>
                          {state.tags.find((t) => t.id === id)?.name ||
                            "已删除"}
                        </span>
                      ));
                    return (
                      <article
                        className={`rule-card ${rule.enabled ? "" : "off"}`}
                        key={rule.id}
                      >
                        <div className="rule-card-body">
                          <div className="rule-card-title">
                            <strong>{rule.name}</strong>
                            {!rule.enabled ? (
                              <span className="pill">已停用</span>
                            ) : null}
                            {partial ? (
                              <span className="pill warn">结果部分不可用</span>
                            ) : null}
                          </div>
                          <div className="rule-flow">
                            <div className="flow-side">
                              <span className="flow-label">
                                {dimensionName(
                                  state.tags,
                                  rule.trigger.dimensionId,
                                )}
                                <i>
                                  {rule.trigger.match === "all"
                                    ? "全部命中"
                                    : "任一命中"}
                                </i>
                              </span>
                              <div className="flow-chips">
                                {chips(rule.trigger.valueIds)}
                                {rule.trigger.valueIds.length > 3 ? (
                                  <span className="flow-more">
                                    +{rule.trigger.valueIds.length - 3}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <ArrowRight size={14} className="flow-arrow" />
                            <div className="flow-side">
                              <span className="flow-label">
                                {dimensionName(
                                  state.tags,
                                  rule.action.dimensionId,
                                )}
                              </span>
                              <div className="flow-chips">
                                {chips(rule.action.valueIds)}
                                {rule.action.valueIds.length > 3 ? (
                                  <span className="flow-more">
                                    +{rule.action.valueIds.length - 3}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="rule-card-side">
                          <span className="rule-priority">P{rule.priority}</span>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`${rule.enabled ? "停用" : "启用"}规则 ${rule.name}`}
                            title={rule.enabled ? "停用" : "启用"}
                            disabled={!can("taxonomy")}
                            onClick={() => toggleRule(rule)}
                          >
                            {rule.enabled ? (
                              <PowerOff size={15} />
                            ) : (
                              <Power size={15} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`编辑规则 ${rule.name}`}
                            title="编辑"
                            disabled={!can("taxonomy")}
                            onClick={() => setRuleDraft(structuredClone(rule))}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            aria-label={`删除规则 ${rule.name}`}
                            title="删除"
                            disabled={!can("taxonomy")}
                            onClick={() => removeRule(rule)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>
            ) : (
              <Empty
                title="还没有派生规则"
                description="配置一条“触发 → 结果”关系。"
              />
            )}
          </section>
        </>
      ) : (
        <>
          <div className="taxonomy-toolbar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="搜索取值名称或别名"
            />
          </div>
          {!can("taxonomy") ? (
            <p className="permission-note">
              当前角色仅可查看标签，新增、编辑与启停需要标签管理权限。
            </p>
          ) : null}
          <div className="taxonomy-layout">
            <section className="primary-list panel" aria-label="维度">
              {groups.map((group) => (
                <div key={group.key} className="dimension-group">
                  <div className="dimension-group-head">
                    <strong>{group.label}</strong>
                    <small className="muted">{group.hint}</small>
                  </div>
                  {group.list.map((dim) => {
                    const children = state.tags.filter(
                      (t) => t.parentId === dim.id,
                    );
                    return (
                      <div
                        key={dim.id}
                        className={`primary-row ${selected?.id === dim.id ? "active" : ""}`}
                      >
                        <button
                          type="button"
                          aria-pressed={selected?.id === dim.id}
                          onClick={() => setDimensionId(dim.id)}
                        >
                          <strong>
                            {dim.name}
                            {dim.cardinality === "single" ? (
                              <i className="primary-single-mark">单值</i>
                            ) : null}
                            {dim.kind === "enum" ? (
                              <i className="primary-preset-mark">字段</i>
                            ) : null}
                          </strong>
                          <span>
                            {children.length} 个取值
                            {dim.ai === "none" ? " · 不参与 AI" : ""}
                          </span>
                          {!dim.enabled ? <Badge>已停用</Badge> : null}
                        </button>
                        {selected?.id === dim.id ? (
                          <Button
                            variant="ghost"
                            aria-label={`编辑维度 ${dim.name}`}
                            disabled={!can("taxonomy")}
                            icon={<Pencil size={16} />}
                            onClick={() => openDimension(dim)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  {!group.list.length ? <p className="muted">暂无</p> : null}
                </div>
              ))}
              <Button
                icon={<Plus size={16} />}
                disabled={!can("taxonomy")}
                onClick={() => openDimension()}
              >
                新增维度
              </Button>
            </section>
            <section className="secondary-panel panel" aria-label="取值">
              <div className="section-heading">
                <div>
                  <h2>{selected?.name || "取值"}</h2>
                  <p>
                    {selected
                      ? [
                          selected.kind === "enum" ? "字段" : "分类维度",
                          selected.cardinality === "single" ? "单值" : "多值",
                          selected.ai === "none"
                            ? "不参与 AI"
                            : selected.ai === "open"
                              ? "AI 开放匹配"
                              : "AI 闭集匹配",
                          `被 ${rulesUsing.length} 条规则引用`,
                        ].join(" · ")
                      : ""}
                  </p>
                </div>
                <Button
                  variant="primary"
                  icon={<Plus size={16} />}
                  disabled={!selected || !can("taxonomy")}
                  onClick={() => openValue()}
                >
                  新增取值
                </Button>
              </div>
              <div className="value-list">
                {shownValues.map((tag) => (
                  <article className="value-row" key={tag.id}>
                    <div className="value-main">
                      <strong>{tag.name}</strong>
                      {tag.aliases?.length ? (
                        <small>别名：{tag.aliases.join("、")}</small>
                      ) : null}
                    </div>
                    <div className="value-badges">
                      {!availableTag(state.tags, tag) ? (
                        <Badge>
                          {!tag.enabled ? "已停用" : "维度已停用"}
                        </Badge>
                      ) : null}
                      {tag.derivedOnly ? (
                        <Badge tone="blue">仅规则产生</Badge>
                      ) : null}
                      {tag.external ? (
                        <small className="muted">对外</small>
                      ) : null}
                    </div>
                    <div className="value-actions">
                        <Button
                          variant="ghost"
                          disabled={!can("taxonomy")}
                          aria-label={`${tag.enabled ? "停用" : "启用"}取值 ${tag.name}`}
                          onClick={() => toggleValue(tag)}
                        >
                          {tag.enabled ? "停用" : "启用"}
                        </Button>
                        <Button
                          variant="ghost"
                          icon={<Pencil size={14} />}
                          disabled={!can("taxonomy")}
                          aria-label={`编辑取值 ${tag.name}`}
                          onClick={() => openValue(tag)}
                        >
                          编辑
                        </Button>
                      </div>
                  </article>
                ))}
              </div>
              {!shownValues.length ? (
                <Empty
                  title={values.length ? "没有匹配的取值" : "还没有取值"}
                  description={
                    values.length
                      ? "换个关键词试试。"
                      : "在这个维度下添加取值，供内容选用。"
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
          title="标签与规则导入预览"
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
                          module: "标签管理",
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
                                  `${t.name}（${transfer.tags.find((p) => p.id === t.parentId)?.name || "维度"}${t.enabled ? "" : " / 停用"}）`,
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
                                    | "keep"
                                    | "skip",
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
          title={
            editor.kind === "dimension"
              ? `${editor.id ? "编辑" : "新增"}${editor.draft.kind === "enum" ? "字段" : "维度"}`
              : `${editor.id ? "编辑" : "新增"}取值`
          }
          onClose={() => setEditor(undefined)}
          footer={
            <>
              <Button onClick={() => setEditor(undefined)}>取消</Button>
              <Button
                variant="primary"
                disabled={!can("taxonomy")}
                onClick={saveTag}
              >
                保存
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
            <Field label="名称" required error={error}>
              <input
                className="input"
                autoFocus
                value={editor.draft.name}
                onChange={(event) => {
                  setEditor({
                    ...editor,
                    draft: { ...editor.draft, name: event.target.value },
                  });
                  setError("");
                }}
              />
            </Field>
            {editor.kind === "value" ? (
              <>
                <Field label="别名">
                  <textarea
                    className="input"
                    rows={3}
                    value={(editor.draft.aliases || []).join("\n")}
                    placeholder={"如：艾瑞卡\n艾坦"}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          aliases: parseAliases(event.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <label className="actions">
                  <input
                    type="checkbox"
                    checked={!!editor.draft.derivedOnly}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          derivedOnly: event.target.checked || undefined,
                        },
                      })
                    }
                  />
                  仅由规则产生
                </label>
              </>
            ) : (
              <>
                {editor.id ? null : (
                  <Field label="类型">
                    <Segmented
                      value={editor.draft.kind || "taxonomy"}
                      options={[
                        { value: "taxonomy", label: "分类维度" },
                        { value: "enum", label: "字段" },
                      ]}
                      onChange={(kind) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            kind,
                            ai: kind === "enum" ? "none" : "closed",
                            scope:
                              kind === "enum" ? "material" : editor.draft.scope,
                            humanEditable: kind === "enum" ? true : undefined,
                          },
                        })
                      }
                    />
                    <small className="muted">
                      {editor.draft.kind === "enum"
                        ? "内容固定属性，固定不参与 AI 且仅作用于材料级。"
                        : "业务标签，取值可自由增删。"}
                    </small>
                  </Field>
                )}
                <Field label="基数">
                  <Segmented
                    value={editor.draft.cardinality || "multi"}
                    options={[
                      { value: "single", label: "单值" },
                      { value: "multi", label: "多值" },
                    ]}
                    onChange={(cardinality) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          cardinality,
                          merge:
                            cardinality === "single"
                              ? "priority"
                              : editor.draft.merge,
                        },
                      })
                    }
                  />
                  {previous?.cardinality === "multi" &&
                  editor.draft.cardinality === "single" ? (
                    <small className="muted">
                      切换为单值后，存量多值保持现状，下次编辑或重算时按单值规则收敛。
                    </small>
                  ) : null}
                </Field>
                <Field label="AI 匹配">
                  <Segmented
                    disabled={editor.draft.kind === "enum"}
                    value={editor.draft.kind === "enum" ? "none" : editor.draft.ai || "closed"}
                    options={[
                      { value: "closed", label: "闭集" },
                      { value: "open", label: "开放" },
                      { value: "none", label: "不参与" },
                    ]}
                    onChange={(ai) =>
                      setEditor({ ...editor, draft: { ...editor.draft, ai } })
                    }
                  />
                </Field>
                <Field label="作用域">
                  <Segmented
                    disabled={editor.draft.kind === "enum"}
                    value={
                      editor.draft.kind === "enum"
                        ? "material"
                        : editor.draft.scope || "material"
                    }
                    options={[
                      { value: "material", label: "材料级" },
                      { value: "page", label: "页级" },
                      { value: "both", label: "两者" },
                    ]}
                    onChange={(scope) =>
                      setEditor({
                        ...editor,
                        draft: { ...editor.draft, scope },
                      })
                    }
                  />
                </Field>
                {editor.draft.kind === "enum" ? (
                  <>
                    <Field label="合并策略">
                      <Segmented
                        disabled={editor.draft.cardinality === "single"}
                        value={
                          editor.draft.cardinality === "single"
                            ? "priority"
                            : editor.draft.merge || "union"
                        }
                        options={[
                          { value: "union", label: "并集" },
                          { value: "priority", label: "优先级" },
                        ]}
                        onChange={(merge) =>
                          setEditor({
                            ...editor,
                            draft: { ...editor.draft, merge },
                          })
                        }
                      />
                    </Field>
                    <Field label="兜底值">
                      <select
                        className="select"
                        value={editor.draft.fallbackId || ""}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            draft: {
                              ...editor.draft,
                              fallbackId: event.target.value || undefined,
                            },
                          })
                        }
                      >
                        <option value="">不设置</option>
                        {values.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="actions">
                      <input
                        type="checkbox"
                        checked={!!editor.draft.humanEditable}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            draft: {
                              ...editor.draft,
                              humanEditable:
                                event.target.checked || undefined,
                            },
                          })
                        }
                      />
                      允许人工修改
                    </label>
                  </>
                ) : null}
              </>
            )}
            {editor.kind === "value" ? (
              <>
                <label className="actions">
                  <input
                    type="checkbox"
                    checked={editor.draft.enabled}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          enabled: event.target.checked,
                        },
                      })
                    }
                  />
                  启用
                </label>
                <label className="actions">
                  <input
                    type="checkbox"
                    checked={editor.draft.external}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          external: event.target.checked,
                        },
                      })
                    }
                  />
                  允许对外展示
                </label>
              </>
            ) : null}
            <button type="submit" hidden />
          </form>
        </Dialog>
      ) : null}
      {ruleDraft ? (
        <RuleEditor
          rule={ruleDraft}
          onClose={() => setRuleDraft(undefined)}
          onSave={saveRule}
        />
      ) : null}
      {similarityDialog}
    </div>
  );
}
