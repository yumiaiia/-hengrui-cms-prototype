import { useState } from "react";
import { useCMS } from "../store";
import { activeItem, cancelStaged } from "../uploadReview";
import { Button, Dialog } from "./ui";

export function CancelBatch({
  batchId,
  itemId,
  onClose,
}: {
  batchId: string;
  itemId?: string;
  onClose: () => void;
}) {
  const { state, update, toast } = useCMS();
  const [error, setError] = useState("");
  const batch = state.uploadBatches?.find((b) => b.id === batchId);
  if (!batch) return null;
  const tags = batch.kind === "tags";
  const items = batch.items.filter(
    (i) => activeItem(i) && (!itemId || itemId === i.id),
  );
  const label = tags ? "标签更新" : "归档";
  return (
    <Dialog
      title={`取消${label}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>继续处理</Button>
          <Button
            variant="danger"
            disabled={!items.length}
            onClick={() => {
              try {
                let count = 0;
                if (
                  update(
                    (s) => {
                      count = cancelStaged(
                        s,
                        batchId,
                        items.map((i) => i.id),
                      );
                    },
                    {
                      action: `取消${label}`,
                      object: `${items.length} 份内容`,
                      module: "内容库",
                    },
                    tags ? "taxonomy" : "upload",
                  )
                ) {
                  toast(`已取消 ${count} 份内容的${label}。`);
                  onClose();
                }
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "操作未保存，请重试。",
                );
              }
            }}
          >
            确认取消{items.length > 1 ? ` ${items.length} 份` : ""}
          </Button>
        </>
      }
    >
      <p>
        {itemId
          ? `“${items[0]?.v.title || "本文件"}”`
          : `本批次剩余 ${items.length} 份文件`}
        将结束本次{label}。
      </p>
      <p className="muted">
        {tags
          ? "尚未更新的正式标签保持原样，已更新文件保留更新结果。"
          : "再次入库需要重新上传。同批已归档文件及已有正式版本不受影响。"}
      </p>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
