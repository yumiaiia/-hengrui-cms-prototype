import { type Article, type Asset } from "./model";

// These fixtures are local source pages for fictional seed articles, including old data.
// Never infer a real WeChat URL from a title or attach fixtures to user records.
const sampleArticles = [
  {
    id: "article1",
    title: "免疫疾病诊疗资讯 · 公众号文章",
    account: "自免医时空",
  },
  {
    id: "article2",
    title: "慢病管理学术资讯 · 采集样例",
    account: "爱医慢时空",
  },
  { id: "article3", title: "学术交流文章 · 采集异常样例", account: "爱医时空" },
  { id: "article4", title: "眼科研究进展 · 内容更新", account: "爱眼医时空" },
  { id: "article4", title: "眼科研究进展 · 公众号文章", account: "爱眼医时空" },
];

export function sampleArticleSource(
  article: Pick<Article, "id" | "title" | "account">,
) {
  return sampleArticles.some(
    (a) =>
      a.id === article.id &&
      a.title === article.title &&
      a.account === article.account,
  )
    ? `/samples/wechat/${article.id}.html`
    : undefined;
}

export function articleSource(article: Article, asset?: Asset) {
  const archived =
    article.collectedVersion ||
    asset?.versions.find((v) => v.number === 1) ||
    asset?.versions.find((v) => v.number === asset.current);
  return article.sourceUrl || archived?.sourceUrl;
}

export function articleSourceUrl(source: string | undefined, origin: string) {
  if (!source) return "";
  return source.startsWith("/samples/wechat/")
    ? new URL(source, origin).href
    : source;
}
