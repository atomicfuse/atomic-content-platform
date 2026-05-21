"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import type { GeneralImageArticle } from "@/app/api/articles/general-images/route";

const PAGE_SIZE = 25;

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const normalized = status.toLowerCase();
  const color =
    normalized === "published"
      ? "text-green-700 dark:text-green-400 bg-green-500/10"
      : normalized === "review"
        ? "text-yellow-700 dark:text-yellow-400 bg-yellow-500/10"
        : "text-[var(--text-muted)] bg-[var(--bg-elevated)]";

  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}
    >
      {status}
    </span>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "--";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function GeneralImagesClient(): React.ReactElement {
  const [articles, setArticles] = useState<GeneralImageArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [uploadingSlug, setUploadingSlug] = useState<string | null>(null);
  const [generatingSlug, setGeneratingSlug] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    domain: string;
    slug: string;
    branch: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/articles/general-images")
      .then((r) => r.json())
      .then((data: GeneralImageArticle[]) => setArticles(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.domain.toLowerCase().includes(q),
    );
  }, [articles, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageArticles = filtered.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [search]);

  const handleUploadClick = useCallback(
    (domain: string, slug: string, branch: string | null): void => {
      setPendingUpload({ domain, slug, branch });
      fileInputRef.current?.click();
    },
    [],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      if (!file || !pendingUpload) return;
      const { domain, slug, branch } = pendingUpload;
      setUploadingSlug(`${domain}::${slug}`);
      try {
        const formData = new FormData();
        formData.append("image", file);
        if (branch) formData.append("branch", branch);
        const res = await fetch(
          `/api/articles/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/image`,
          { method: "POST", body: formData },
        );
        if (res.ok) {
          setArticles((prev) =>
            prev.filter((a) => !(a.domain === domain && a.slug === slug)),
          );
        } else {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          alert(
            `Upload failed: ${(err as { error?: string }).error ?? "Unknown error"}`,
          );
        }
      } catch {
        alert("Upload failed");
      } finally {
        setUploadingSlug(null);
        setPendingUpload(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [pendingUpload],
  );

  const handleGenerateAI = useCallback(
    async (
      domain: string,
      slug: string,
      branch: string | null,
    ): Promise<void> => {
      const key = `${domain}::${slug}`;
      setGeneratingSlug(key);
      try {
        const res = await fetch("/api/agent/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, slug, branch }),
        });
        if (res.ok) {
          alert("Image generation triggered. The image will be updated shortly.");
        } else {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          alert(
            `Generation failed: ${(err as { error?: string }).error ?? "Unknown error"}`,
          );
        }
      } catch {
        alert("Generation request failed");
      } finally {
        setGeneratingSlug(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-80 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
          <div className="h-8 w-48 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
        </div>
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-5 py-4 border-b border-[var(--border-secondary)]"
            >
              <div className="h-4 w-28 rounded bg-[var(--bg-elevated)] animate-pulse" />
              <div className="h-4 flex-1 rounded bg-[var(--bg-elevated)] animate-pulse" />
              <div className="h-4 w-20 rounded bg-[var(--bg-elevated)] animate-pulse" />
              <div className="h-4 w-24 rounded bg-[var(--bg-elevated)] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Articles with General Images
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {filtered.length} article{filtered.length !== 1 ? "s" : ""} using
            default site images
          </p>
        </div>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by title or site..."
            value={search}
            onChange={(e): void => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan w-72"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">
            {articles.length === 0
              ? "No articles with general images found."
              : "No matching articles found."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-elevated)]">
                <th className="text-left px-5 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Site
                </th>
                <th className="text-left px-5 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Article Title
                </th>
                <th className="text-left px-5 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-5 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Published
                </th>
                <th className="text-right px-5 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pageArticles.map((article) => {
                const key = `${article.domain}::${article.slug}`;
                const isUploading = uploadingSlug === key;
                const isGenerating = generatingSlug === key;

                return (
                  <tr
                    key={key}
                    className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/sites/${article.domain}`}
                        className="text-cyan hover:underline font-mono text-xs"
                      >
                        {article.domain}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[var(--text-primary)] font-medium truncate block max-w-md">
                        {article.title}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--text-muted)]">
                        {article.slug}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={article.status} />
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">
                      {formatDate(article.publishDate)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(): void =>
                            handleUploadClick(
                              article.domain,
                              article.slug,
                              article.stagingBranch,
                            )
                          }
                          disabled={isUploading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50"
                        >
                          {isUploading ? (
                            <svg
                              className="w-3.5 h-3.5 animate-spin"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                              />
                            </svg>
                          )}
                          Upload
                        </button>
                        <button
                          onClick={(): void => {
                            void handleGenerateAI(
                              article.domain,
                              article.slug,
                              article.stagingBranch,
                            );
                          }}
                          disabled={isGenerating}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan/10 text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-50"
                        >
                          {isGenerating ? (
                            <svg
                              className="w-3.5 h-3.5 animate-spin"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                              />
                            </svg>
                          )}
                          Generate AI
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={(): void => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
            Previous
          </button>
          <span className="text-xs text-[var(--text-secondary)]">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={(): void =>
              setPage((p) => Math.min(totalPages - 1, p + 1))
            }
            disabled={page >= totalPages - 1}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m8.25 4.5 7.5 7.5-7.5 7.5"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
