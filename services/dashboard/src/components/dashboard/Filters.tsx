"use client";

import type { SiteStatus, Company, Vertical } from "@/types/dashboard";
import { COMPANIES, STATUSES } from "@/lib/constants";
import { useVerticals } from "@/hooks/useReferenceData";

interface FiltersProps {
  search: string;
  company: Company | "";
  vertical: Vertical | "";
  status: SiteStatus | "";
  onSearchChange: (value: string) => void;
  onCompanyChange: (value: Company | "") => void;
  onVerticalChange: (value: Vertical | "") => void;
  onStatusChange: (value: SiteStatus | "") => void;
}

export function Filters({
  search,
  company,
  vertical,
  status,
  onSearchChange,
  onCompanyChange,
  onVerticalChange,
  onStatusChange,
}: FiltersProps): React.ReactElement {
  const { verticals } = useVerticals();
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
          placeholder="Search domains..."
          value={search}
          onChange={(e): void => onSearchChange(e.target.value)}
          className="pl-9 pr-3 py-2 w-56 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
      </div>

      {/* Company filter */}
      <select
        value={company}
        onChange={(e): void => onCompanyChange(e.target.value as Company | "")}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All Companies</option>
        {COMPANIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {/* Vertical filter */}
      <select
        value={vertical}
        onChange={(e): void => onVerticalChange(e.target.value as Vertical | "")}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All Verticals</option>
        {verticals.map((v) => (
          <option key={v.id} value={v.name}>{v.name}</option>
        ))}
      </select>

      {/* Status filter */}
      <select
        value={status}
        onChange={(e): void => onStatusChange(e.target.value as SiteStatus | "")}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">All Statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
