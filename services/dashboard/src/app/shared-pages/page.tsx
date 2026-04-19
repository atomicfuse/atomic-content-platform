"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

interface SharedPageInfo {
  name: string;
  fileName: string;
  overrideCount: number;
  overrideSites: string[];
}

export default function SharedPagesListPage(): React.ReactElement {
  const [pages, setPages] = useState<SharedPageInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shared-pages")
      .then((r) => r.json())
      .then((data: SharedPageInfo[]) => {
        setPages(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Shared Pages</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Global pages shared across all sites, with optional per-site overrides
          </p>
        </div>
        <Link
          href="/shared-pages/ads-txt"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          ads.txt Profiles
        </Link>
      </div>

      {loading ? (
        <div className="text-[var(--text-secondary)] text-sm">Loading...</div>
      ) : (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-secondary)]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Page Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Overridden Sites
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr
                  key={page.name}
                  className="border-b border-[var(--border-secondary)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/shared-pages/${page.name}`}
                      className="text-sm font-medium text-cyan hover:underline"
                    >
                      {page.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {page.overrideCount > 0 ? (
                      <Badge
                        label={`${page.overrideCount} override${page.overrideCount > 1 ? "s" : ""}`}
                        variant="warning"
                      />
                    ) : (
                      <Badge label="Global" variant="info" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    {page.overrideSites.length > 0
                      ? page.overrideSites.slice(0, 3).join(", ") +
                        (page.overrideSites.length > 3
                          ? ` +${page.overrideSites.length - 3} more`
                          : "")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
