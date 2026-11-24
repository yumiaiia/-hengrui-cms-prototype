import { useState } from "react";
import { useCMS } from "../store";
import { visibleBatches, activeItem } from "../uploadReview";
import { dateLabel, go } from "../model";
import { Badge, Button, Empty, SearchBox } from "../components/ui";
import { CancelBatch } from "../components/CancelBatch";
export default function PendingUploads() {
  const { state, can } = useCMS();
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState("");
  const [cancelling, setCancelling] = useState<string>();
  const batches = visibleBatches(state).filter(
    (b) =>
      (all || b.items.some(activeItem)) &&
      (!kind || (b.kind || "upload") === kind) &&
      `${b.id} ${b.items.map((i) => i.v.title).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索批次或内容标题"
        />
        <select
          aria-label="批次类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="upload">上传归档</option>
          <option value="tags">标签更新</option>
        </select>
        <label className="actions">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          包含已结束批次
        </label>
      </div>
      {batches.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>批次 / 内容</th>
                <th>类型</th>
                <th>发起人</th>
                <th>提交时间</th>
                <th>处理状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const tags = b.kind === "tags",
                  done = b.items.filter((i) => i.archived).length;
                const ended = !b.items.some(activeItem);
                const cancelled = b.items.filter((i) => i.cancelled).length;
                const working = b.items.some(
                  (i) =>
                    activeItem(i) && ["处理中", "排队中"].includes(i.v.process),
                );
                const confirmed = b.items.filter(
                  (i) => activeItem(i) && i.confirmedRevision === i.revision,
                ).length;
                return (
                  <tr key={b.id}>
                    <td>
                      <strong>
                        {b.items[0]?.v.title}
                        {b.items.length > 1 ? ` 等 ${b.items.length} 份` : ""}
                      </strong>
                      <small className="row-secondary">{b.id.slice(-12)}</small>
                    </td>
                    <td>
                      <Badge>{tags ? "标签更新" : "上传归档"}</Badge>
                    </td>
                    <td>
                      {state.users.find((u) => u.id === b.ownerId)?.name ||
                        "已失效账号"}
                    </td>
                    <td>{dateLabel(b.createdAt)}</td>
                    <td>
                      <Badge>
                        {ended
                          ? "已结束"
                          : working
                            ? tags
                              ? "匹配中"
                              : "解析打标中"
                            : "待确认结果"}
                      </Badge>
                      <small className="row-secondary">
                        {done} / {b.items.length} 份已{tags ? "更新" : "归档"}
                        {confirmed ? ` · 已确认 ${confirmed} 份` : ""}
                        {cancelled ? ` · 已取消 ${cancelled} 份` : ""}
                      </small>
                    </td>
                    <td>
                      <div className="actions">
                        <Button onClick={() => go(`upload/${b.id}`)}>
                          {ended ? "查看结果" : "继续处理"}
                        </Button>
                        {!ended &&
                        (tags
                          ? can("taxonomy") && can("tags")
                          : can("upload")) ? (
                          <Button
                            variant="ghost"
                            onClick={() => setCancelling(b.id)}
                          >
                            {tags ? "取消剩余更新" : "取消剩余归档"}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="暂无待处理批次"
          description="上传文件或发起批量标签匹配后，可在这里查看进度并继续确认结果。"
        />
      )}
      {cancelling ? (
        <CancelBatch
          batchId={cancelling}
          onClose={() => setCancelling(undefined)}
        />
      ) : null}
    </section>
  );
}
