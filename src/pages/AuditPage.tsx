import { useState, type ChangeEvent } from "react";
import { useCMS } from "../store";
import { today } from "../model";
import {
  auditModule,
  auditModules,
  auditSummary,
  userWriteAudits,
} from "../audit";
import {
  Badge,
  Button,
  Empty,
  Field,
  PageHeader,
  Pagination,
} from "../components/ui";
const fullDate = (at: string) =>
  new Date(at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const weekAgo = () => {
  const day = new Date(`${today()}T12:00:00+08:00`);
  day.setUTCDate(day.getUTCDate() - 6);
  return day.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
};
export default function AuditPage() {
  const { state, can } = useCMS();
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const [from, setFrom] = useState(params.has("object") ? "" : weekAgo),
    [to, setTo] = useState(today),
    [actor, setActor] = useState(""),
    [module, setModule] = useState(""),
    [action, setAction] = useState(""),
    [keyword, setKeyword] = useState(params.get("object") || "");
  const [page, setPage] = useState(1);
  if (!can("audit"))
    return (
      <Empty
        title="没有操作审计查看权限"
        description="请联系管理员配置独立的审计查看权限。"
      />
    );
  const userRecords = userWriteAudits(state);
  const rows = userRecords
    .filter(
      (a) =>
        (!from || Date.parse(a.at) >= Date.parse(`${from}T00:00:00+08:00`)) &&
        (!to || Date.parse(a.at) <= Date.parse(`${to}T23:59:59.999+08:00`)) &&
        `${a.user} ${a.employeeId || ""}`
          .toLowerCase()
          .includes(actor.trim().toLowerCase()) &&
        (!module || auditModule(a) === module) &&
        (!action || a.action === action) &&
        `${a.action} ${auditSummary(a)}`
          .toLowerCase()
          .includes(keyword.trim().toLowerCase()),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const active = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  const change =
    (setter: (v: string) => void) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setter(e.target.value);
      setPage(1);
    };
  return (
    <div>
      <PageHeader
        title="操作审计"
        description="按模块查看用户的新增、修改、删除、导入等写入操作；时间均为北京时间。"
      />
      <section className="panel">
        <div className="audit-filters">
          <Field label="开始日期">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={change(setFrom)}
            />
          </Field>
          <Field label="结束日期">
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={change(setTo)}
            />
          </Field>
          <Field label="操作人 / 工号">
            <input
              className="input"
              value={actor}
              onChange={change(setActor)}
              placeholder="姓名或工号"
            />
          </Field>
          <Field label="所属模块">
            <select
              value={module}
              onChange={(e) => {
                setModule(e.target.value);
                setAction("");
                setPage(1);
              }}
            >
              <option value="">全部模块</option>
              {auditModules.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="操作">
            <select value={action} onChange={change(setAction)}>
              <option value="">全部操作</option>
              {[
                ...new Set(
                  userRecords
                    .filter((a) => !module || auditModule(a) === module)
                    .map((a) => a.action),
                ),
              ].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="关键词">
            <input
              className="input"
              value={keyword}
              onChange={change(setKeyword)}
              placeholder="搜索操作或简短说明"
            />
          </Field>
        </div>
        <div className="toolbar">
          <span className="muted">共 {rows.length} 条操作记录</span>
          <Button
            onClick={() => {
              setFrom("");
              setTo("");
              setActor("");
              setModule("");
              setAction("");
              setKeyword("");
              setPage(1);
            }}
          >
            清空筛选
          </Button>
        </div>
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table audit-table">
                <thead>
                  <tr>
                    <th>操作时间</th>
                    <th>操作人 / 工号</th>
                    <th>所属模块</th>
                    <th>操作</th>
                    <th>操作说明</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((active - 1) * 10, active * 10).map((a) => (
                    <tr key={a.id}>
                      <td>{fullDate(a.at)}</td>
                      <td>
                        {a.user}
                        <small className="row-secondary">
                          {a.employeeId || "未记录工号"}
                        </small>
                      </td>
                      <td>{auditModule(a)}</td>
                      <td>{a.action}</td>
                      <td className="audit-description">{auditSummary(a)}</td>
                      <td>
                        <Badge>{a.result || "未记录"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={rows.length}
              page={active}
              size={10}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title="暂无匹配的操作记录"
            description="可扩大时间范围或调整模块等筛选条件。"
          />
        )}
      </section>
    </div>
  );
}
