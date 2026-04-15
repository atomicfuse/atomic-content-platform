"use client";

import { useCallback } from "react";
import { Textarea } from "@/components/ui/Textarea";

interface AdsTxtEditorProps {
  value: string[];
  onChange: (value: string[]) => void;
  /**
   * What scope the entries apply to in the helper text. Defaults to
   * "monetization profile". Use "org" / "group" / "site" elsewhere.
   */
  scopeLabel?: string;
}

export function AdsTxtEditor({
  value,
  onChange,
  scopeLabel = "monetization profile",
}: AdsTxtEditorProps): React.ReactElement {
  const textValue = value.join("\n");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const lines = e.target.value
        .split("\n")
        .map((l) => l.replace(/\s+$/g, ""))
        .filter((line) => line.length > 0);
      onChange(lines);
    },
    [onChange],
  );

  const entryCount = value.filter((l) => l.trim() !== "" && !l.trim().startsWith("#")).length;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          ads.txt entries
        </label>
        <span className="text-xs text-[var(--text-muted)]">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </span>
      </div>

      <Textarea
        value={textValue}
        onChange={handleChange}
        rows={12}
        placeholder="google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0"
        className="font-mono text-xs"
      />

      <p className="text-xs text-[var(--text-muted)]">
        These entries are <strong>added</strong> to the final ads.txt from this{" "}
        {scopeLabel}. Format:{" "}
        <code className="rounded bg-[var(--bg-surface)] px-1">
          domain.com, publisher-id, relationship, cert-authority
        </code>
        .
      </p>
    </div>
  );
}
