import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useCMS } from "../store";
import { current, go } from "../model";
import { matchableAssets, startTagMatching } from "../tagMatching";
import { Button, Dialog, Empty, Pagination, SearchBox } from "./ui";

export function SyncTagsDialog({ onClose }: { onClose: () => void }) {
  const { state, can, update } = useCMS();
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const pageCheckbox = useRef<HTMLInputElement>(null);
  const eligible = matchableAssets(state);
  const kinds = [...new Set(eligible.map((a) => current(a).kind))];
  const sources = [...new Set(eligible.map((a) => current(a).source))];
  const rows = eligible.filter((a) => {
    const v = current(a);
    return (
      `${a.code} ${v.title}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (!kind || v.kind === kind) &&
      (!source || v.source === source) &&
      (!onlySelected || selected.includes(a.id))
    );
  });
  const size = 6;
  const active = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
  const shown = rows.slice((active - 1) * size, active * size);
  const selectedOnPage = shown.filter((a) => selected.includes(a.id)).length;
  const allOnPage = shown.length > 0 && selectedOnPage === shown.length;
  useEffect(() => {
    if (pageCheckbox.current)
      pageCheckbox.current.indeterminate = selectedOnPage > 0 && !allOnPage;
  }, [selectedOnPage, allOnPage, scope]);
  const ids = scope === "all" ? eligible.map((a) => a.id) : selected;
  const stale = ids.some((id) => !eligible.some((a) => a.id === id));
  function toggle(id: string) {
    setSelected((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
    setError("");
  }
  function execute() {
    if (locked.current || !ids.length || stale) return;
    locked.current = true;
    setError("");
    try {
      let batchId = "";
      if (
        update(
          (s) => {
            const taskId = startTagMatching(s, ids);
            batchId = s.tasks.find((t) => t.id === taskId)!.batchId!;
          },
          {
            action: "同步最新标签到文件",
            object: `${ids.length} 份内容`,
            module: "标签管理",
          },
          "taxonomy",
        )
      ) {
        onClose();
        go(`upload/${batchId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "未能开始同步，请重试。");
    } finally {
      locked.current = false;
    }
  }
  return (
    <Dialog
      title="同步最新标签到文件"
      className="tag-sync-dialog"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="tag-sync-total" aria-live="polite">
            {scope === "all" ? "全部" : "已选"} <strong>{ids.length}</strong>{" "}
            份文件
          </span>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={!ids.length || stale || !can("taxonomy") || !can("tags")}
            onClick={execute}
          >
            确认同步 {ids.length} 份
          </Button>
        </>
      }
    >
      <div className="tag-sync-warning">
        <AlertTriangle size={17} />
        <p>执行耗时随文件数量和页数增加，算力消耗较大，请谨慎选择范围。</p>
      </div>
      <p className="tag-sync-hint">后台执行，可稍后查看；结果确认后生效。</p>
      <div className="tag-sync-scope" role="radiogroup" aria-label="同步范围">
        <label>
          <input
            type="radio"
            name="sync-scope"
            checked={scope === "selected"}
            onChange={() => setScope("selected")}
          />
          选择部分文件
        </label>
        <label>
          <input
            type="radio"
            name="sync-scope"
            checked={scope === "all"}
            onChange={() => setScope("all")}
          />
          全部文件（{eligible.length}）
        </label>
      </div>
      {scope === "selected" ? (
        <>
          <div className="tag-sync-filters">
            <SearchBox
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder="搜索文件标题或编号"
            />
            <select
              aria-label="文件格式"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部格式</option>
              {kinds.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select
              aria-label="文件来源"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部来源</option>
              {sources.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="tag-sync-selection">
            <label>
              <input
                type="checkbox"
                checked={onlySelected}
                onChange={(e) => {
                  setOnlySelected(e.target.checked);
                  setPage(1);
                }}
              />
              仅看已选（{selected.length}）
            </label>
            <div className="actions">
              {query || kind || source ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setQuery("");
                    setKind("");
                    setSource("");
                    setPage(1);
                  }}
                >
                  清空筛选
                </Button>
              ) : null}
              <Button
                variant="ghost"
                disabled={!selected.length}
                onClick={() => {
                  setSelected([]);
                  setError("");
                }}
              >
                清空选择
              </Button>
            </div>
          </div>
          <div className="table-wrap tag-sync-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <label>
                      <input
                        ref={pageCheckbox}
                        type="checkbox"
                        aria-label="全选本页文件"
                        checked={allOnPage}
                        disabled={!shown.length}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((old) =>
                            checked
                              ? [
                                  ...new Set([
                                    ...old,
                                    ...shown.map((a) => a.id),
                                  ]),
                                ]
                              : old.filter(
                                  (id) => !shown.some((a) => a.id === id),
                                ),
                          );
                          setError("");
                        }}
                      />
                      本页
                    </label>
                  </th>
                  <th>文件 / 编号</th>
                  <th>格式</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const v = current(a);
                  return (
                    <tr
                      key={a.id}
                      className={selected.includes(a.id) ? "is-selected" : ""}
                    >
                      <td>
                        <input
                          id={`sync-file-${a.id}`}
                          type="checkbox"
                          aria-label={`选择文件 ${a.code}`}
                          checked={selected.includes(a.id)}
                          onChange={() => toggle(a.id)}
                        />
                      </td>
                      <td>
                        <label htmlFor={`sync-file-${a.id}`}>
                          <strong>{v.title}</strong>
                          <small className="row-secondary">
                            {a.code} · V{a.current}
                          </small>
                        </label>
                      </td>
                      <td>{v.kind}</td>
                      <td>{v.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length ? (
              <Empty
                title={onlySelected ? "暂无匹配的已选文件" : "没有匹配的文件"}
                description="请调整筛选条件或重新选择。"
              />
            ) : null}
          </div>
          <Pagination
            total={rows.length}
            page={active}
            size={size}
            onChange={setPage}
          />
        </>
      ) : (
        <div className="tag-sync-all">
          将同步全部 {eligible.length} 份正常、已完成解析的正式文件。
        </div>
      )}
      {stale || error ? (
        <p className="error-text" role="alert">
          {stale ? "所选文件状态已变化，请清空后重新选择。" : error}
        </p>
      ) : null}
    </Dialog>
  );
}
