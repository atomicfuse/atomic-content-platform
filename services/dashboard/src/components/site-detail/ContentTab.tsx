"use client";

import { useState, useTransition } from "react";
import type { ArticleEntry } from "@/types/dashboard";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { deleteArticleFromStaging, deleteArticlesFromStaging } from "@/actions/sites";

interface ContentTabProps {
  articles: ArticleEntry[];
  domain: string;
  stagingBranch: string | null;
  previewUrl?: string;
}

function scoreColor(score: number | undefined): string {
  if (score === undefined) return "text-[var(--text-muted)]";
  if (score >= 80) return "text-green-700 dark:text-green-400";
  if (score >= 60) return "text-yellow-700 dark:text-yellow-400";
  return "text-red-700 dark:text-red-400";
}

function scoreBgColor(score: number): string {
  if (score >= 80) return "bg-green-400";
  if (score >= 60) return "bg-yellow-400";
  return "bg-red-400";
}

function ScoreCell({ article }: { article: ArticleEntry }): React.ReactElement {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const bd = article.scoreBreakdown;

  return (
    <div className="relative">
      <button
        className={`font-mono text-sm ${scoreColor(article.score)} ${bd ? "cursor-pointer hover:underline" : ""}`}
        onClick={(): void => { if (bd) setShowBreakdown(!showBreakdown); }}
        title={article.qualityNote ?? undefined}
      >
        {article.score !== undefined ? article.score : "\u2014"}
      </button>

      {showBreakdown && bd && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--bg-elevated)] border border-[var(--border-primary)] rounded-lg p-3 shadow-lg min-w-[200px]">
          {[
            { key: "seo_quality" as const, label: "SEO Quality" },
            { key: "tone_match" as const, label: "Tone Match" },
            { key: "content_length" as const, label: "Content Length" },
            { key: "factual_accuracy" as const, label: "Factual Accuracy" },
            { key: "keyword_relevance" as const, label: "Keyword Relevance" },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3 py-1">
              <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
              <div className="flex items-center gap-2">
                <div className="w-16 bg-[var(--bg-surface)] rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${scoreBgColor(bd[key])}`}
                    style={{ width: `${bd[key]}%` }}
                  />
                </div>
                <span className={`text-[11px] font-mono w-6 text-right ${scoreColor(bd[key])}`}>
                  {bd[key]}
                </span>
              </div>
            </div>
          ))}
          {article.qualityNote && (
            <p className="text-[10px] text-[var(--text-muted)] italic mt-2 pt-2 border-t border-[var(--border-secondary)]">
              {article.qualityNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function statusVariant(
  status: string
): "success" | "warning" | "error" | "default" {
  switch (status) {
    case "published":
      return "success";
    case "review":
      return "warning";
    case "draft":
      return "default";
    default:
      return "default";
  }
}

export function ContentTab({
  articles,
  domain,
  stagingBranch,
  previewUrl,
}: ContentTabProps): React.ReactElement {
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<{ slug: string; title: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [isBulkPending, startBulkTransition] = useTransition();

  const allSelected = articles.length > 0 && selectedSlugs.size === articles.length;
  const someSelected = selectedSlugs.size > 0 && selectedSlugs.size < articles.length;

  function toggleSelect(slug: string): void {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleSelectAll(): void {
    if (allSelected) {
      setSelectedSlugs(new Set());
    } else {
      setSelectedSlugs(new Set(articles.map((a) => a.slug)));
    }
  }

  function confirmDelete(): void {
    if (!deleteTarget) return;
    const { slug, title } = deleteTarget;
    startTransition(async () => {
      try {
        await deleteArticleFromStaging(domain, slug);
        toast(`Deleted "${title}" from staging`, "success");
        setDeleteTarget(null);
        setSelectedSlugs((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
      } catch (error) {
        toast(error instanceof Error ? error.message : "Failed to delete article", "error");
      }
    });
  }

  function confirmBulkDelete(): void {
    startBulkTransition(async () => {
      try {
        await deleteArticlesFromStaging(domain, [...selectedSlugs]);
        toast(`Deleted ${selectedSlugs.size} articles from staging`, "success");
        setSelectedSlugs(new Set());
        setShowBulkDelete(false);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Failed to delete articles", "error");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          Articles ({articles.length})
        </h3>
      </div>

      {stagingBranch && selectedSlugs.size > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] px-4 py-2">
          <span className="text-sm text-[var(--text-primary)]">
            {selectedSlugs.size} article{selectedSlugs.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={(): void => setSelectedSlugs(new Set())}>
              Clear
            </Button>
            <Button variant="danger" size="sm" onClick={(): void => setShowBulkDelete(true)}>
              Delete selected
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-secondary)]">
              {stagingBranch && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el): void => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    className="rounded border-[var(--border-primary)] accent-cyan-500"
                  />
                </th>
              )}
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Title
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Score
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Published
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Preview
              </th>
              {stagingBranch && (
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {articles.length === 0 && (
              <tr>
                <td
                  colSpan={stagingBranch ? 8 : 6}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No articles yet
                </td>
              </tr>
            )}
            {articles.map((article) => (
              <tr
                key={article.slug}
                className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
              >
                {stagingBranch && (
                  <td className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedSlugs.has(article.slug)}
                      onChange={(): void => toggleSelect(article.slug)}
                      className="rounded border-[var(--border-primary)] accent-cyan-500"
                    />
                  </td>
                )}
                <td className="px-4 py-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
                  {article.title}
                </td>
                <td className="px-4 py-3">
                  <Badge label={article.type} variant="info" />
                </td>
                <td className="px-4 py-3">
                  <ScoreCell article={article} />
                </td>
                <td className="px-4 py-3">
                  <Badge
                    label={article.status}
                    variant={statusVariant(article.status)}
                  />
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {article.publishDate
                    ? new Date(article.publishDate).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <a
                    href={previewUrl ? `${previewUrl}/${article.slug}/` : `https://${domain}/${article.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan hover:underline text-xs"
                  >
                    Preview
                  </a>
                </td>
                {stagingBranch && (
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(): void => setDeleteTarget({ slug: article.slug, title: article.title })}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title={`Delete ${article.title}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Single delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={(): void => setDeleteTarget(null)}
        title="Delete Article"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <p className="text-[var(--text-primary)] font-medium">
                Delete &ldquo;{deleteTarget?.title}&rdquo;?
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-2">
                This will remove the article from the <strong>staging branch</strong>. To apply this change to production, use &ldquo;Publish to Production&rdquo; on the Staging tab.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
            <Button variant="ghost" onClick={(): void => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              loading={isPending}
            >
              Delete from Staging
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk delete confirmation modal */}
      <Modal
        open={showBulkDelete}
        onClose={(): void => setShowBulkDelete(false)}
        title="Delete Articles"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <p className="text-[var(--text-primary)] font-medium">
                Delete {selectedSlugs.size} article{selectedSlugs.size > 1 ? "s" : ""}?
              </p>
              <ul className="text-sm text-[var(--text-muted)] mt-2 list-disc list-inside max-h-40 overflow-y-auto">
                {articles
                  .filter((a) => selectedSlugs.has(a.slug))
                  .map((a) => (
                    <li key={a.slug} className="truncate">{a.title}</li>
                  ))}
              </ul>
              <p className="text-sm text-[var(--text-muted)] mt-2">
                This will remove these articles from the <strong>staging branch</strong> in a single commit. To apply this change to production, use &ldquo;Publish to Production&rdquo; on the Staging tab.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
            <Button variant="ghost" onClick={(): void => setShowBulkDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmBulkDelete}
              loading={isBulkPending}
            >
              Delete {selectedSlugs.size} from Staging
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
