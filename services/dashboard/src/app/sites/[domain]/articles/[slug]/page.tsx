import Link from "next/link";
import { readDashboardIndex, readFileContent } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";
import { ArticleScriptsPanel } from "@/components/site-detail/ArticleScriptsPanel";
import { ArticleVideosPanel } from "@/components/site-detail/ArticleVideosPanel";
import { workerPreviewUrl } from "@/lib/constants";
import { ArticleEditor } from "./ArticleEditor";

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

type ArticleScriptPosition =
  | "head"
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

interface ArticleScript {
  id: string;
  name: string;
  position: ArticleScriptPosition;
  content: string;
}

type ArticleVideoPosition =
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

interface ArticleVideo {
  id: string;
  url: string;
  position: ArticleVideoPosition;
}

function statusColor(status: string): string {
  if (status === "approved" || status === "published") return "bg-green-500/10 text-green-400";
  if (status === "review") return "bg-amber-500/10 text-amber-400";
  return "bg-zinc-500/10 text-zinc-400";
}

function statusLabel(status: string): string {
  if (status === "published" || status === "approved") return "Published";
  return status;
}

export default async function ArticleDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);

  // Look up site for staging branch
  const index = await readDashboardIndex();
  const site = index.sites?.find((s) => s.domain === decodedDomain);
  const stagingBranch = site?.staging_branch ?? null;

  // Read article
  const articlePath = buildArticlePath(decodedDomain, slug);
  let content: string | null = null;

  if (stagingBranch) {
    content = await readFileContent(articlePath, stagingBranch);
  }
  if (content === null) {
    content = await readFileContent(articlePath);
  }

  if (content === null) {
    return (
      <div className="p-8">
        <Link href={`/sites/${domain}`} className="text-cyan hover:underline text-sm">
          &larr; Back to Site
        </Link>
        <div className="mt-6 text-center text-[var(--text-muted)]">
          Article &ldquo;{slug}&rdquo; not found.
        </div>
      </div>
    );
  }

  const parsed = parseFrontmatter(content);
  const fm = parsed?.frontmatter ?? {};
  const title = (fm.title as string) || slug;
  const status = (fm.status as string) || "draft";
  const type = (fm.type as string) || "standard";
  const author = (fm.author as string) || "Editorial Team";
  const publishDate = (fm.publishDate as string) || "";
  const qualityScore = fm.quality_score as number | undefined;
  const scripts = Array.isArray(fm.scripts) ? (fm.scripts as ArticleScript[]) : [];
  const videos = Array.isArray(fm.videos) ? (fm.videos as ArticleVideo[]) : [];

  const previewHref = workerPreviewUrl(decodedDomain, `/${slug}`);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link href={`/sites/${domain}`} className="text-cyan hover:underline text-sm">
        &larr; Back to Site
      </Link>

      {/* Article header */}
      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold">{title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
          <span>Type: <span className="text-[var(--text-secondary)]">{type}</span></span>
          <span>Author: <span className="text-[var(--text-secondary)]">{author}</span></span>
          {publishDate && <span>Published: <span className="text-[var(--text-secondary)]">{publishDate}</span></span>}
          {qualityScore != null && <span>Score: <span className="text-[var(--text-secondary)]">{qualityScore}</span></span>}
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan hover:underline"
          >
            Preview &rarr;
          </a>
        </div>
      </div>

      {/* Videos panel */}
      <ArticleVideosPanel
        domain={decodedDomain}
        slug={slug}
        stagingBranch={stagingBranch}
        initialVideos={videos}
      />

      {/* Scripts panel */}
      <ArticleScriptsPanel
        domain={decodedDomain}
        slug={slug}
        stagingBranch={stagingBranch}
        initialScripts={scripts}
      />

      {/* Article editor */}
      <ArticleEditor
        domain={decodedDomain}
        slug={slug}
        branch={stagingBranch}
        initialContent={content}
        title={title}
        featuredImage={(fm.featuredImage as string) ?? undefined}
      />
    </div>
  );
}
