import { useRef, useState } from "react";
import { useCMS } from "../store";
import { type User } from "../model";
import {
  applyUserImport,
  previewUserImport,
  readUserWorkbook,
  writeUserWorkbook,
  type UserImportPreview,
} from "../userTransfer";
import { download } from "../storage";
import { Badge, Button, Dialog } from "./ui";
export default function UserTransfer({ users }: { users: User[] }) {
  const { state, can, update, toast } = useCMS();
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<UserImportPreview>(),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    [all, setAll] = useState(false),
    [result, setResult] = useState<number>();
  async function read(file?: File) {
    if (!file || lock.current) return;
    setBusy(true);
    lock.current = true;
    setError("");
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error("请选择 .xlsx 文件");
      setPreview(
        previewUserImport(
          state,
          await readUserWorkbook(await file.arrayBuffer()),
        ),
      );
      setResult(undefined);
    } catch (e) {
      toast(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
      lock.current = false;
      if (input.current) input.current.value = "";
    }
  }
  async function exportFile(template = false, errors = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const rows = all ? state.users : users;
      const blob = await writeUserWorkbook(
        state,
        rows,
        template,
        errors ? preview?.rows : undefined,
      );
      download(
        blob,
        errors
          ? "用户导入错误明细.xlsx"
          : template
            ? "用户导入模板.xlsx"
            : "用户列表.xlsx",
      );
      setExporting(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "生成失败";
      setError(message);
      toast(message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <>
      <input
        hidden
        ref={input}
        type="file"
        accept=".xlsx"
        aria-label="导入用户文件"
        onChange={(e) => void read(e.target.files?.[0])}
      />
      <Button
        disabled={busy || !can("admin")}
        onClick={() => input.current?.click()}
      >
        导入用户
      </Button>
      <Button
        disabled={busy || !can("admin")}
        onClick={() => {
          setError("");
          setExporting(true);
        }}
      >
        导出用户
      </Button>
      <Button
        disabled={busy || !can("admin")}
        onClick={() => void exportFile(true)}
      >
        下载模板
      </Button>
      {preview ? (
        <Dialog
          wide
          title={result === undefined ? "用户导入预览" : "用户导入结果"}
          onClose={() => {
            if (!busy) setPreview(undefined);
          }}
          footer={
            result === undefined ? (
              <>
                <Button disabled={busy} onClick={() => setPreview(undefined)}>
                  取消
                </Button>
                {preview.rows.some((r) => r.error) ? (
                  <Button
                    disabled={busy}
                    onClick={() => void exportFile(false, true)}
                  >
                    下载错误明细
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  disabled={
                    busy || preview.rows.some((r) => r.error) || !can("admin")
                  }
                  onClick={() => {
                    if (lock.current) return;
                    lock.current = true;
                    setBusy(true);
                    setError("");
                    try {
                      if (
                        update(
                          (s) => applyUserImport(s, preview),
                          {
                            action: "批量创建用户",
                            object: `${preview.rows.length} 个账号`,
                            category: "系统",
                          },
                          "admin",
                        )
                      ) {
                        setResult(preview.rows.length);
                        toast("用户已批量创建，可使用工号登录。");
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "导入失败");
                    } finally {
                      lock.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  确认导入 {preview.rows.length} 个账号
                </Button>
              </>
            ) : (
              <Button onClick={() => setPreview(undefined)}>完成</Button>
            )
          }
        >
          <div className="user-import-summary">
            <span>共 {preview.rows.length} 行</span>
            <span>通过 {preview.rows.filter((r) => !r.error).length}</span>
            <span>错误 {preview.rows.filter((r) => r.error).length}</span>
          </div>
          {result !== undefined ? (
            <p className="user-import-result">
              成功创建 {result} 个账号，默认启用；已记录操作审计。
            </p>
          ) : (
            <p className="note">
              本次仅创建新账号，存在错误时整批不提交。工号须为文本，角色须已存在。
            </p>
          )}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>原文件行号</th>
                  <th>姓名</th>
                  <th>工号</th>
                  <th>角色</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.name || "—"}</td>
                    <td>{r.employeeId || "—"}</td>
                    <td>{r.roleName || "—"}</td>
                    <td>
                      {r.error ? (
                        <span className="error-text">{r.error}</span>
                      ) : (
                        <Badge tone="green">
                          {result === undefined ? "通过" : "已创建"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      ) : null}
      {exporting ? (
        <Dialog
          title="导出用户"
          onClose={() => {
            if (!busy) setExporting(false);
          }}
          footer={
            <>
              <Button disabled={busy} onClick={() => setExporting(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !can("admin") ||
                  !(all ? state.users.length : users.length)
                }
                onClick={() => void exportFile()}
              >
                导出 {all ? state.users.length : users.length} 个账号
              </Button>
            </>
          }
        >
          <label className="review-check">
            <input type="radio" checked={!all} onChange={() => setAll(false)} />
            当前搜索 / 筛选结果，共 {users.length} 个账号，包含全部分页
          </label>
          <label className="review-check">
            <input type="radio" checked={all} onChange={() => setAll(true)} />
            全部用户，共 {state.users.length} 个账号
          </label>
          <p className="muted">
            导出姓名、工号、角色、启用状态和创建时间；此表不用于批量更新账号。
          </p>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
