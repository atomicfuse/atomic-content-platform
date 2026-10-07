"use client";

import { useState } from "react";
import { toBareDomain } from "@/lib/grid-domains";

interface DomainBlocklistProps {
  value: string[];
  onChange: (next: string[]) => void;
}

const chipClass =
  "inline-flex items-center gap-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--text-primary)]";

/** Free-text list of publisher domains: type or paste a link, press Enter. */
export function DomainBlocklist({ value, onChange }: DomainBlocklistProps): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add(): void {
    if (!draft.trim()) return;
    const domain = toBareDomain(draft);
    if (!domain) {
      setError("That doesn't look like a website address (e.g. example.com).");
      return;
    }
    if (!value.includes(domain)) onChange([...value, domain]);
    setDraft("");
    setError(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <span className="text-xs text-[var(--text-muted)]">Nothing blocked</span>}
        {value.map((d) => (
          <span key={d} className={chipClass}>
            {d}
            <button
              type="button"
              aria-label={`Unblock ${d}`}
              onClick={(): void => onChange(value.filter((x) => x !== d))}
              className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-red-400 transition-colors"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex max-w-md gap-2">
        <input
          type="text"
          aria-label="Block a publisher"
          placeholder="e.g. example.com, or paste a story link"
          value={draft}
          onChange={(e): void => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e): void => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="flex-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-cyan focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="rounded-md border border-[var(--border-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors"
        >
          Block
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
