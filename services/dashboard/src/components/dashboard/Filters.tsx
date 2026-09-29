"use client";

import { useMemo } from "react";
import type { SiteStatus, Vertical } from "@/types/dashboard";
import { COMPANIES, STATUSES } from "@/lib/constants";
import { useVerticals } from "@/hooks/useReferenceData";
import { NO_COMPANY, NO_GROUP, extraCategoryOptions, type CompanyFilterValue, type GroupFilterValue } from "@/lib/site-filters";

interface GroupOption {
  id: string;
  name?: string;
}

interface FiltersProps {
  search: string;
  company: CompanyFilterValue | "";
  vertical: Vertical | "";
  status: SiteStatus | "";
  group: GroupFilterValue;
  /** Raw `site.vertical` values from the current sites list (duplicates
   *  fine). Any value missing from the `/api/verticals` reference list is
   *  merged into the dropdown so every site's category stays selectable. */
  siteVerticals: string[];
  groupOptions: GroupOption[];
  /** True while `/api/sites/groups` hasn't resolved yet — used to caveat
   *  the Group dropdown rather than showing it as simply empty. */
  groupsLoading: boolean;
  onSearchChange: (value: string) => void;
  onCompanyChange: (value: CompanyFilterValue | "") => void;
  onVerticalChange: (value: Vertical | "") => void;
  onStatusChange: (value: SiteStatus | "") => void;
  onGroupChange: (value: GroupFilterValue) => void;
}

export function Filters({
  search,
  company,
  vertical,
  status,
  group,
  siteVerticals,
  groupOptions,
  groupsLoading,
  onSearchChange,
  onCompanyChange,
  onVerticalChange,
  onStatusChange,
  onGroupChange,
}: FiltersProps): React.ReactElement {
  const { verticals } = useVerticals();

  const categoryOptions = useMemo(() => {
    const base = verticals.map((v) => v.name);
    const extras = extraCategoryOptions(siteVerticals, base);
    return [...base, ...extras];
  }, [verticals, siteVerticals]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          aria-label="Search sites"
          placeholder="Search domains..."
          value={search}
          onChange={(e): void => onSearchChange(e.target.value)}
          className="pl-9 pr-3 py-2 w-56 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
      </div>

      {/* Company filter */}
      <select
        aria-label="Company filter"
        value={company}
        onChange={(e): void => onCompanyChange(e.target.value as CompanyFilterValue | "")}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All companies</option>
        {COMPANIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
        <option value={NO_COMPANY}>No company</option>
      </select>

      {/* Group filter */}
      <select
        aria-label="Group filter"
        value={group}
        onChange={(e): void => onGroupChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All groups</option>
        {groupOptions.map((g) => (
          <option key={g.id} value={g.id}>{g.name ?? g.id}</option>
        ))}
        <option value={NO_GROUP}>No group</option>
      </select>
      {group && groupsLoading && (
        <span className="text-xs text-[var(--text-muted)]">Loading groups…</span>
      )}

      {/* Category filter */}
      <select
        aria-label="Category filter"
        value={vertical}
        onChange={(e): void => onVerticalChange(e.target.value as Vertical | "")}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All categories</option>
        {categoryOptions.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>

      {/* Status filter */}
      <select
        aria-label="Status filter"
        value={status}
        onChange={(e): void => onStatusChange(e.target.value as SiteStatus | "")}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
