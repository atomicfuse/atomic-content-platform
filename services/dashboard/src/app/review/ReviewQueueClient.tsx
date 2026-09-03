"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { applyReviewDecisions } from "@/actions/review";
import type { ReviewArticleDTO, ReviewQueueResponse } from "@/app/api/review/route";
import Link from "next/link";

type Decision = "approved" | "rejected";

type SortOrder = "default" | "newest" | "oldest";

const PAGE_SIZE = 10;

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

function ScoreBreakdown({ breakdown }: { breakdown?: ReviewArticleDTO["scoreBreakdown"] }): React.ReactElement | null {
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

function buildPreviewUrl(article: ReviewArticleDTO): string | null {
  if (!article.stagingBaseUrl) return null;
  return `${article.stagingBaseUrl}/${article.slug}?_atl_site=${encodeURIComponent(article.domain)}`;
}

function buildGitHubUrl(article: ReviewArticleDTO): string {
  const branch = article.branch ?? "main";
  return `https://github.com/atomicfuse/atomic-labs-network/blob/${branch}/sites/${article.domain}/articles/${article.slug}.md`;
}

function articleKey(domain: string, slug: string): string {
  return `${domain}::${slug}`;
}

export function ReviewQueueClient(): React.ReactElement {
  const [articles, setArticles] = useState<ReviewArticleDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [domains, setDomains] = useState<Array<{ domain: string; count: number }>>([]);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [isApplying, startTransition] = useTransition();
  const { toast } = useToast();

  // Filters
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [siteSearch, setSiteSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  const fetchPage = useCallback(
    async (p: number, domain: string | null, sort: SortOrder, fresh = false): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
        if (domain) params.set("domain", domain);
        if (sort !== "default") params.set("sort", sort);
        if (fresh) params.set("fresh", "true");
        const res = await fetch(`/api/review?${params}`);
        const data = (await res.json()) as ReviewQueueResponse;
        setArticles(data.items);
        setTotal(data.total);
        setDomains(data.domains);
      } catch {
        // keep current state
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchPage(page, selectedDomain, sortOrder);
  }, [page, selectedDomain, sortOrder, fetchPage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filteredDomains = siteSearch
    ? domains.filter((d) => d.domain.toLowerCase().includes(siteSearch.toLowerCase()))
    : domains;

  // Separate current-page articles by decision
  const pending: ReviewArticleDTO[] = [];
  const approved: ReviewArticleDTO[] = [];
  const rejected: ReviewArticleDTO[] = [];
  for (const article of articles) {
    const key = articleKey(article.domain, article.slug);
    const decision = decisions.get(key);
    if (decision === "approved") approved.push(article);
    else if (decision === "rejected") rejected.push(article);
    else pending.push(article);
  }

  // Total decisions across all pages
  const totalDecisions = decisions.size;
  const totalApproved = Array.from(decisions.values()).filter((d) => d === "approved").length;
  const totalRejected = Array.from(decisions.values()).filter((d) => d === "rejected").length;

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
        // Build decisions from the map
        const approvedList: Array<{ domain: string; slug: string }> = [];
        const rejectedList: Array<{ domain: string; slug: string }> = [];
        for (const [key, decision] of decisions) {
          const [domain, slug] = key.split("::");
          if (!domain || !slug) continue;
          if (decision === "approved") approvedList.push({ domain, slug });
          else if (decision === "rejected") rejectedList.push({ domain, slug });
        }

        const result = await applyReviewDecisions({
          approved: approvedList,
          rejected: rejectedList,
        });
        if (result.error) {
          toast(result.error, "error");
        } else {
          toast(result.summary, "success");
        }
        setDecisions(new Map());
        // Refresh current page with fresh data (cache is stale after apply)
        void fetchPage(page, selectedDomain, sortOrder, true);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to apply review decisions", "error");
      }
    });
  }

  // All domains total (unfiltered) for the header counter
  const allDomainTotal = domains.reduce((sum, d) => sum + d.count, 0);

  if (!loading && total === 0 && !selectedDomain) {
    return (
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
        <svg className="w-12 h-12 text-green-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[var(--text-secondary)] font-medium">
          All clear! No articles pending review.
        </p>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Articles scoring below the site threshold will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Site filter */}
        {domains.length > 1 && (
          <div ref={dropdownRef} className="relative w-72">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] cursor-pointer"
              onClick={(): void => { setDropdownOpen(!dropdownOpen); setSiteSearch(""); }}
            >
              <svg className="w-4 h-4 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
              </svg>
              <span className="text-sm text-[var(--text-primary)] flex-1 truncate">
                {selectedDomain ?? `All Sites (${allDomainTotal})`}
              </span>
              {selectedDomain && (
                <button
                  onClick={(e): void => { e.stopPropagation(); setSelectedDomain(null); setPage(0); setDropdownOpen(false); }}
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
                    onClick={(): void => { setSelectedDomain(null); setPage(0); setDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-surface)] ${
                      !selectedDomain ? "text-cyan font-medium" : "text-[var(--text-primary)]"
                    }`}
                  >
                    All Sites
                    <span className="text-[var(--text-muted)] ml-1">({allDomainTotal})</span>
                  </button>
                  {filteredDomains.map(({ domain, count }) => (
                    <button
                      key={domain}
                      onClick={(): void => { setSelectedDomain(domain); setPage(0); setDropdownOpen(false); }}
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
          onClick={(): void => {
            setSortOrder((prev) => prev === "default" ? "newest" : prev === "newest" ? "oldest" : "default");
            setPage(0);
          }}
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

        {/* Refresh */}
        <button
          onClick={(): void => { void fetchPage(page, selectedDomain, sortOrder, true); }}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)] cursor-pointer transition-colors hover:border-cyan/40 hover:text-cyan disabled:opacity-40 disabled:cursor-not-allowed"
          title="Refresh — bypass cache and fetch latest data"
        >
          <svg className={`w-4 h-4 shrink-0 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
          </svg>
          <span className="text-sm">Refresh</span>
        </button>
      </div>

      {/* Apply banner */}
      {totalDecisions > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-cyan/5 border border-cyan/20 px-5 py-3 sticky top-0 z-10 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className="text-sm text-[var(--text-primary)]">
              {totalApproved > 0 && (
                <span className="text-green-400 font-medium mr-3">
                  {totalApproved} approved
                </span>
              )}
              {totalRejected > 0 && (
                <span className="text-red-400 font-medium">
                  {totalRejected} rejected
                </span>
              )}
            </div>
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

      {/* Loading skeleton */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-24 rounded bg-[var(--bg-elevated)] animate-pulse" />
                  <div className="h-4 w-64 rounded bg-[var(--bg-elevated)] animate-pulse" />
                  <div className="h-3 w-40 rounded bg-[var(--bg-elevated)] animate-pulse" />
                </div>
                <div className="h-5 w-10 rounded bg-[var(--bg-elevated)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">
            {selectedDomain ? `No review articles for ${selectedDomain}.` : "No articles pending review."}
          </p>
        </div>
      ) : (
        <>
          {/* Pending articles */}
          {pending.length > 0 && (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                {pending.length} article{pending.length > 1 ? "s" : ""} pending review
                {total > PAGE_SIZE && ` (page ${page + 1} of ${totalPages})`}
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

          {/* Approved articles (on current page) */}
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

          {/* Rejected articles (on current page) */}
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
          {pending.length === 0 && (approved.length > 0 || rejected.length > 0) && (
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-6 text-center mt-4">
              <p className="text-[var(--text-secondary)] text-sm">
                All articles on this page reviewed. Click &ldquo;Apply review decisions&rdquo; above to commit changes.
              </p>
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={(): void => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            Previous
          </button>
          <span className="text-xs text-[var(--text-secondary)]">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={(): void => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Article Card ─── */

interface ArticleCardProps {
  article: ReviewArticleDTO;
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
