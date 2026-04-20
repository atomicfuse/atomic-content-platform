"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { applyReviewDecisions } from "@/actions/review";
import type { ReviewArticle } from "@/actions/review";
import Link from "next/link";

interface ReviewQueueClientProps {
  articles: ReviewArticle[];
}

type Decision = "approved" | "rejected";

function ScoreBadge({ score }: { score?: number }): React.ReactElement {
  if (score === undefined) return <span className="text-xs text-[var(--text-muted)]">--</span>;

  const color =
    score >= 80 ? "text-green-700 dark:text-green-400 bg-green-500/10" :
    score >= 60 ? "text-yellow-700 dark:text-yellow-400 bg-yellow-500/10" :
    "text-red-700 dark:text-red-400 bg-red-500/10";

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

function buildPreviewUrl(article: ReviewArticle): string | null {
  if (!article.stagingBaseUrl) return null;
  return `${article.stagingBaseUrl}/${article.slug}/`;
}

function buildGitHubUrl(article: ReviewArticle): string {
  const branch = article.branch ?? "main";
  return `https://github.com/atomicfuse/atomic-labs-network/blob/${branch}/sites/${article.domain}/articles/${article.slug}.md`;
}

function articleKey(domain: string, slug: string): string {
  return `${domain}::${slug}`;
}

type SortOrder = "default" | "newest" | "oldest";

export function ReviewQueueClient({ articles }: ReviewQueueClientProps): React.ReactElement {
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [isApplying, startTransition] = useTransition();
  const { toast } = useToast();

  // Site filter state
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [siteSearch, setSiteSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sort state
  const [sortOrder, setSortOrder] = useState<SortOrder>("default");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return (): void => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of articles) {
      counts.set(a.domain, (counts.get(a.domain) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count }));
  }, [articles]);

  const filteredDomains = useMemo(() => {
    if (!siteSearch) return domainCounts;
    const q = siteSearch.toLowerCase();
    return domainCounts.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domainCounts, siteSearch]);

  const filteredArticles = useMemo(() => {
    let result = articles;
    if (selectedDomain) {
      result = result.filter((a) => a.domain === selectedDomain);
    }
    if (sortOrder !== "default") {
      result = [...result].sort((a, b) => {
        const da = a.publishDate ? new Date(a.publishDate).getTime() : 0;
        const db = b.publishDate ? new Date(b.publishDate).getTime() : 0;
        return sortOrder === "newest" ? db - da : da - db;
      });
    }
    return result;
  }, [articles, selectedDomain, sortOrder]);

  const { pending, approved, rejected } = useMemo(() => {
    const p: ReviewArticle[] = [];
    const a: ReviewArticle[] = [];
    const r: ReviewArticle[] = [];
    for (const article of filteredArticles) {
      const key = articleKey(article.domain, article.slug);
      const decision = decisions.get(key);
      if (decision === "approved") a.push(article);
      else if (decision === "rejected") r.push(article);
      else p.push(article);
    }
    return { pending: p, approved: a, rejected: r };
  }, [filteredArticles, decisions]);

  const hasDecisions = approved.length > 0 || rejected.length > 0;

  function setDecision(domain: string, slug: string, decision: Decision): void {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(articleKey(domain, slug), decision);
      return next;
    });
  }

  function undoDecision(domain: string, slug: string): void {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.delete(articleKey(domain, slug));
      return next;
    });
  }

  function handleApply(): void {
    startTransition(async () => {
      try {
        const result = await applyReviewDecisions({
          approved: approved.map((a) => ({ domain: a.domain, slug: a.slug })),
          rejected: rejected.map((a) => ({ domain: a.domain, slug: a.slug })),
        });
        toast(result.summary, "success");
        // Clear decisions — page will revalidate via server action
        setDecisions(new Map());
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to apply review decisions", "error");
      }
    });
  }

  if (articles.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
        <p className="text-[var(--text-secondary)]">All articles reviewed!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Site filter */}
        {domainCounts.length > 1 && (
          <div ref={dropdownRef} className="relative w-72">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] cursor-pointer"
              onClick={(): void => { setDropdownOpen(!dropdownOpen); setSiteSearch(""); }}
            >
              <svg className="w-4 h-4 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
              </svg>
              <span className="text-sm text-[var(--text-primary)] flex-1 truncate">
                {selectedDomain ?? `All Sites (${articles.length})`}
              </span>
              {selectedDomain && (
                <button
                  onClick={(e): void => { e.stopPropagation(); setSelectedDomain(null); setDropdownOpen(false); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${dropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
            {dropdownOpen && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg overflow-hidden">
                <div className="p-2 border-b border-[var(--border-secondary)]">
                  <input
                    type="text"
                    value={siteSearch}
                    onChange={(e): void => setSiteSearch(e.target.value)}
                    placeholder="Search sites..."
                    autoFocus
                    className="w-full px-2.5 py-1.5 text-sm rounded-md bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <button
                    onClick={(): void => { setSelectedDomain(null); setDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-surface)] ${
                      !selectedDomain ? "text-cyan font-medium" : "text-[var(--text-primary)]"
                    }`}
                  >
                    All Sites
                    <span className="text-[var(--text-muted)] ml-1">({articles.length})</span>
                  </button>
                  {filteredDomains.map(({ domain, count }) => (
                    <button
                      key={domain}
                      onClick={(): void => { setSelectedDomain(domain); setDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-surface)] ${
                        selectedDomain === domain ? "text-cyan font-medium" : "text-[var(--text-primary)]"
                      }`}
                    >
                      {domain}
                      <span className="text-[var(--text-muted)] ml-1">({count})</span>
                    </button>
                  ))}
                  {filteredDomains.length === 0 && (
                    <p className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">No matching sites</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sort by date */}
        <button
          onClick={(): void => setSortOrder((prev) => prev === "default" ? "newest" : prev === "newest" ? "oldest" : "default")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
            sortOrder !== "default"
              ? "border-cyan/40 bg-cyan/5 text-cyan"
              : "border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          <span className="text-sm whitespace-nowrap">
            {sortOrder === "newest" ? "Newest first" : sortOrder === "oldest" ? "Oldest first" : "Date"}
          </span>
          {sortOrder !== "default" && (
            <svg className={`w-3.5 h-3.5 ${sortOrder === "oldest" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
            </svg>
          )}
        </button>
      </div>

      {/* Apply banner */}
      {hasDecisions && (
        <div className="flex items-center justify-between rounded-xl bg-cyan/5 border border-cyan/20 px-5 py-3 sticky top-0 z-10 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className="text-sm text-[var(--text-primary)]">
              {approved.length > 0 && (
                <span className="text-green-400 font-medium mr-3">
                  {approved.length} approved
                </span>
              )}
              {rejected.length > 0 && (
                <span className="text-red-400 font-medium">
                  {rejected.length} rejected
                </span>
              )}
            </div>
            {pending.length > 0 && (
              <span className="text-xs text-[var(--text-muted)]">
                {pending.length} still pending
              </span>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleApply}
            loading={isApplying}
          >
            Apply review decisions
          </Button>
        </div>
      )}

      {/* Pending articles */}
      {pending.length > 0 && (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            {pending.length} article{pending.length > 1 ? "s" : ""} pending review
          </p>
          {pending.map((article) => (
            <ArticleCard
              key={articleKey(article.domain, article.slug)}
              article={article}
              status="pending"
              onApprove={(): void => setDecision(article.domain, article.slug, "approved")}
              onReject={(): void => setDecision(article.domain, article.slug, "rejected")}
            />
          ))}
        </>
      )}

      {/* Approved articles */}
      {approved.length > 0 && (
        <>
          <p className="text-sm text-green-400 mt-4">
            {approved.length} article{approved.length > 1 ? "s" : ""} approved
          </p>
          {approved.map((article) => (
            <ArticleCard
              key={articleKey(article.domain, article.slug)}
              article={article}
              status="approved"
              onUndo={(): void => undoDecision(article.domain, article.slug)}
            />
          ))}
        </>
      )}

      {/* Rejected articles */}
      {rejected.length > 0 && (
        <>
          <p className="text-sm text-red-400 mt-4">
            {rejected.length} article{rejected.length > 1 ? "s" : ""} rejected
          </p>
          {rejected.map((article) => (
            <ArticleCard
              key={articleKey(article.domain, article.slug)}
              article={article}
              status="rejected"
              onUndo={(): void => undoDecision(article.domain, article.slug)}
            />
          ))}
        </>
      )}

      {/* All reviewed message */}
      {pending.length === 0 && hasDecisions && (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-6 text-center mt-4">
          <p className="text-[var(--text-secondary)] text-sm">
            All articles reviewed. Click &ldquo;Apply review decisions&rdquo; above to commit changes.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Article Card ─── */

interface ArticleCardProps {
  article: ReviewArticle;
  status: "pending" | "approved" | "rejected";
  onApprove?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
}

function ArticleCard({ article, status, onApprove, onReject, onUndo }: ArticleCardProps): React.ReactElement {
  const previewUrl = buildPreviewUrl(article);

  const borderColor =
    status === "approved" ? "border-green-500/30" :
    status === "rejected" ? "border-red-500/30" :
    "border-[var(--border-secondary)]";

  const bgColor =
    status === "approved" ? "bg-green-500/5" :
    status === "rejected" ? "bg-red-500/5" :
    "bg-[var(--bg-surface)]";

  return (
    <div className={`rounded-xl ${bgColor} border ${borderColor} p-5 space-y-3 transition-colors`}>
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
            {status !== "pending" && (
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                status === "approved" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
              }`}>
                {status}
              </span>
            )}
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
        {status === "pending" && (
          <>
            <Button size="sm" onClick={onApprove}>
              <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={onReject}>
              <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </Button>
          </>
        )}
        {status !== "pending" && (
          <Button size="sm" variant="ghost" onClick={onUndo}>
            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
            Undo
          </Button>
        )}
        <a
          href={buildGitHubUrl(article)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-auto flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
          </svg>
          View Source
        </a>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan hover:underline flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Preview
          </a>
        )}
      </div>
    </div>
  );
}
