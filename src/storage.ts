let database: Promise<IDBDatabase> | undefined;
function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("hengrui-cms-files-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function putFiles(items: { key: string; blob: Blob }[]) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("files", "readwrite");
    for (const item of items) tx.objectStore("files").put(item.blob, item.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function getFile(key: string) {
  const database = await db();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction("files").objectStore("files").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadBlob(key?: string, url?: string) {
  if (key) {
    const result = await getFile(key);
    if (!result)
      throw new Error("本地文件不可用，请重新上传；不会用示例文件替代原文件。");
    return result;
  }
  if (url?.startsWith("/samples/")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("示例文件获取失败");
    return response.blob();
  }
  throw new Error("该内容仅保存公开来源链接，未获取原始文件。");
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
