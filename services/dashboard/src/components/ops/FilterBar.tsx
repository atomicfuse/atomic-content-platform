"use client";

import { useState, useRef, useEffect } from "react";
import type React from "react";
import type { SiteStatus } from "@/types/dashboard";
import { ALERT_LABELS, ALERT_CONDITION_IDS } from "@/lib/ops-helpers";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: SiteStatus | "All";
  onStatusChange: (value: SiteStatus | "All") => void;
  alertFilter: Set<string>;
  onAlertFilterChange: (value: Set<string>) => void;
  onReset: () => void;
}

const STATUSES: (SiteStatus | "All")[] = ["All", "Live", "Staging", "Preview", "Ready", "New", "WordPress"];

export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  alertFilter,
  onAlertFilterChange,
  onReset,
}: FilterBarProps): React.ReactElement {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return (): void => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  function toggleAlert(condition: string): void {
    const next = new Set(alertFilter);
    if (next.has(condition)) next.delete(condition);
    else next.add(condition);
    onAlertFilterChange(next);
  }

  const alertCount = alertFilter.size;
  const buttonLabel = alertCount === 0 ? "All alerts" : `${alertCount} alert${alertCount > 1 ? "s" : ""} selected`;

  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        placeholder="Search sites..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-primary-text placeholder:text-secondary"
      />
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value as SiteStatus | "All")}
        className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-secondary"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>
        ))}
      </select>

      {/* Alert type multi-select dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((p) => !p)}
          className={`bg-card border rounded-lg px-3 py-1.5 text-sm cursor-pointer flex items-center gap-1.5 ${
            alertCount > 0
              ? "border-warning text-warning font-medium"
              : "border-card-border text-secondary"
          }`}
        >
          {buttonLabel}
          <svg className={`w-3 h-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 5l3 3 3-3" />
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute top-full mt-1 right-0 z-50 bg-card border border-card-border rounded-lg shadow-xl py-1 min-w-[260px]">
            {ALERT_CONDITION_IDS.map((id) => (
              <label
                key={id}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-primary-light/30 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={alertFilter.has(id)}
                  onChange={() => toggleAlert(id)}
                  className="accent-warning"
                />
                <span className="text-primary-text">{ALERT_LABELS[id]}</span>
              </label>
            ))}
            {alertCount > 0 && (
              <div className="border-t border-divider mt-1 pt-1 px-3 py-1">
                <button
                  type="button"
                  onClick={() => onAlertFilterChange(new Set())}
                  className="text-xs text-primary font-medium cursor-pointer"
                >
                  Clear alert filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onReset}
        className="text-sm text-primary font-medium px-3 py-1.5 cursor-pointer"
      >
        Reset filters
      </button>
    </div>
  );
}
