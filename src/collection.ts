import {
  accounts,
  current,
  type Article,
  type Asset,
  type State,
} from "./model";

export function collectedBody(article: Article, asset?: Asset) {
  const version =
    article.collectedVersion ||
    asset?.versions.find((v) => v.number === 1) ||
    (asset && current(asset));
  return version?.content.some((block) => block.trim()) ? version : undefined;
}

export function collectedArticles(articles: Article[], assets: Asset[]) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return articles.filter(
    (article) =>
      article.status !== "失败" &&
      !!article.assetId &&
      byId.has(article.assetId) &&
      !!collectedBody(article, byId.get(article.assetId)),
  );
}

// Keep saved task history inert while upgrading only article display data.
export function prepareCollection(state: State): State {
  if ((state.collectionRevision || 0) >= 3) return state;
  const next = structuredClone(state);
  for (const article of next.articles) {
    const asset = next.assets.find((a) => a.id === article.assetId);
    const body = collectedBody(article, asset);
    if (article.status === "失败" || !body) continue;
    article.status = "成功";
    if (
      article.id === "article4" &&
      article.title === "眼科研究进展 · 内容更新" &&
      article.account === accounts[3] &&
      article.sourceUrl === "/samples/wechat/article4.html"
    )
      article.title = "眼科研究进展 · 公众号文章";
    article.collectedVersion ||= {
      ...structuredClone(body),
      title: article.title,
    };
    article.collectedAt ||= body.createdAt;
  }
  next.collectionRevision = 3;
  return next;
}
