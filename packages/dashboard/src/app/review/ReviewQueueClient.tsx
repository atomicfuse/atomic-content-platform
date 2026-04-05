"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { updateArticleStatus } from "@/actions/review";
import type { ReviewArticle } from "@/actions/review";
import Link from "next/link";

interface ReviewQueueClientProps {
  articles: ReviewArticle[];
}

function ScoreBadge({ score }: { score?: number }): React.ReactElement {
  if (score === undefined) return <span className="text-xs text-[var(--text-muted)]">--</span>;

  const color =
    score >= 80 ? "text-green-400 bg-green-500/10" :
    score >= 60 ? "text-yellow-400 bg-yellow-500/10" :
    "text-red-400 bg-red-500/10";

  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded ${color}`}>
      {score}
    </span>
  );
}

function ScoreBreakdown({ breakdown }: { breakdown?: ReviewArticle["scoreBreakdown"] }): React.ReactElement | null {
  if (!breakdown) return null;

  const criteria = [
    { key: "seo_quality", label: "SEO" },
    { key: "tone_match", label: "Tone" },
    { key: "content_length", label: "Length" },
    { key: "factual_accuracy", label: "Accuracy" },
    { key: "keyword_relevance", label: "Keywords" },
  ] as const;

  return (
    <div className="flex gap-3 mt-2">
      {criteria.map(({ key, label }) => {
        const val = breakdown[key];
        const color =
          val >= 80 ? "bg-green-400" :
          val >= 60 ? "bg-yellow-400" :
          "bg-red-400";

        return (
          <div key={key} className="text-center">
            <div className="w-full bg-[var(--bg-elevated)] rounded-full h-1.5 mb-1" style={{ width: 48 }}>
              <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${val}%` }} />
            </div>
            <span className="text-[10px] text-[var(--text-muted)]">{label} {val}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewQueueClient({ articles }: ReviewQueueClientProps): React.ReactElement {
  const [items, setItems] = useState(articles);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  function handleApprove(domain: string, slug: string): void {
    startTransition(async () => {
      try {
        await updateArticleStatus(domain, slug, "published", "Approved via review queue.");
        setItems((prev) => prev.filter((a) => !(a.domain === domain && a.slug === slug)));
        toast(`Approved: ${slug}`, "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to approve", "error");
      }
    });
  }

  function handleReject(domain: string, slug: string): void {
    startTransition(async () => {
      try {
        await updateArticleStatus(domain, slug, "draft", "Rejected via review queue — needs regeneration.");
        setItems((prev) => prev.filter((a) => !(a.domain === domain && a.slug === slug)));
        toast(`Rejected: ${slug}`, "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to reject", "error");
      }
    });
  }

  function buildPreviewUrl(article: ReviewArticle): string | null {
    if (!article.stagingBaseUrl) return null;
    return `${article.stagingBaseUrl}/${article.slug}/`;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
        <p className="text-[var(--text-secondary)]">All articles reviewed!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">
        {items.length} article{items.length > 1 ? "s" : ""} pending review
      </p>

      {items.map((article) => {
        const previewUrl = buildPreviewUrl(article);

        return (
          <div
            key={`${article.domain}-${article.slug}`}
            className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-5 space-y-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Link
                    href={`/sites/${article.domain}`}
                    className="text-[10px] font-mono text-cyan hover:underline"
                  >
                    {article.domain}
                  </Link>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                    {article.type}
                  </span>
                </div>
                {previewUrl ? (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-[var(--text-primary)] hover:text-cyan hover:underline transition-colors truncate block"
                  >
                    {article.title}
                  </a>
                ) : (
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {article.title}
                  </h3>
                )}
                <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                  {article.slug}
                </p>
              </div>
              <ScoreBadge score={article.score} />
            </div>

            {/* Score breakdown */}
            <ScoreBreakdown breakdown={article.scoreBreakdown} />

            {/* Quality note */}
            {article.qualityNote && (
              <p className="text-xs text-[var(--text-secondary)] italic bg-[var(--bg-elevated)] rounded-lg px-3 py-2">
                {article.qualityNote}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={(): void => handleApprove(article.domain, article.slug)}
                loading={isPending}
              >
                <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(): void => handleReject(article.domain, article.slug)}
                loading={isPending}
              >
                <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Reject
              </Button>
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan hover:underline ml-auto flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  Preview on Staging
                </a>
              ) : (
                <Link
                  href={`/sites/${article.domain}`}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] ml-auto"
                >
                  View Site
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
