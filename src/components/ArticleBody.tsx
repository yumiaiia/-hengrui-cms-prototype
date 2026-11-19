import { type Version } from "../model";
import { AssetImage } from "./ui";
export function ArticleBody({ version }: { version: Version }) {
  return (
    <article className="collected-article">
      <h2>{version.title}</h2>
      <p className="article-byline">
        {version.source}
        {version.sourcePublished ? ` · ${version.sourcePublished}` : ""}
        {version.author ? ` · ${version.author}` : ""}
      </p>
      {version.cover ? <AssetImage src={version.cover} alt="文章封面" /> : null}
      {version.content.map((block, i) => (
        <div className="article-paragraph" key={i}>
          {block.split("\n\n").map((paragraph, j) => (
            <p key={j}>{paragraph}</p>
          ))}
        </div>
      ))}
    </article>
  );
}
