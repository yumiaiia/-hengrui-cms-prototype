import { useState } from "react";
import { useCMS } from "../store";
import { availableTag, tagLabel, validateTag } from "../taxonomy";
import { similarTags, tagCheckReceipt, type TagDraft } from "../tagSimilarity";
import { Badge, Button, Dialog } from "./ui";
type Choice = { receipt?: string };
export function useTagCheck() {
  const { state } = useCMS();
  const [pending, setPending] = useState<{
    draft: TagDraft;
    run: (choice: Choice) => void;
    baseline: string;
  }>();
  const [error, setError] = useState("");
  function checkTag(draft: TagDraft, run: (choice: Choice) => void) {
    const validation = validateTag(state.tags, draft);
    if (validation) throw new Error(validation);
    if (similarTags(state.tags, draft).length) {
      setError("");
      setPending({
        draft: { ...draft },
        run,
        baseline: tagCheckReceipt(state.tags, draft),
      });
    } else run({});
  }
  function resolve(choice: Choice) {
    if (!pending) return;
    try {
      if (pending.baseline !== tagCheckReceipt(state.tags, pending.draft))
        throw new Error("标签库已变化，请返回并重新检查。");
      pending.run(choice);
      setPending(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }
  const similarityDialog = pending ? (
    <Dialog
      title="发现相似标签，是否仍要入库？"
      onClose={() => setPending(undefined)}
      footer={
        <>
          <Button onClick={() => setPending(undefined)}>返回修改</Button>
          <Button
            variant="primary"
            onClick={() => resolve({ receipt: pending.baseline })}
          >
            仍然{pending.draft.id ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <p>“{pending.draft.name}”与以下标签名称相近，请先核对分类和含义。</p>
      <div className="similarity-list">
        {similarTags(state.tags, pending.draft).map(({ tag }) => (
          <article key={tag.id}>
            <div>
              <strong>{tag.name}</strong>
              <small>
                {tagLabel(state.tags, tag)} ·{" "}
                {tag.parentId === pending.draft.parentId
                  ? "同分类，名称相近"
                  : "其他分类，名称相近"}
              </small>
              <Badge>
                {availableTag(state.tags, tag) ? "已启用" : "已停用"}
              </Badge>
            </div>
          </article>
        ))}
      </div>
      <p className="muted">
        库中已存在以上相似标签，请核对后决定是否仍然
        {pending.draft.id ? "保存本次修改" : "创建新标签"}。
      </p>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  ) : null;
  return { checkTag, similarityDialog };
}
