"use client";

import { useCallback } from "react";
import { Textarea } from "@/components/ui/Textarea";

interface AdsTxtEditorProps {
  value: string[];
  onChange: (value: string[]) => void;
  /**
   * What scope the entries apply to in the helper text. Defaults to "group".
   * Use "org" / "override" / "site" elsewhere.
   */
  scopeLabel?: string;
}

export function AdsTxtEditor({
  value,
  onChange,
  scopeLabel = "group",
}: AdsTxtEditorProps): React.ReactElement {
  const textValue = value.join("\n");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const raw = e.target.value;
      // Preserve empty lines while editing so Enter key works.
      // Only strip trailing whitespace per line; filter empties on blur.
      const lines = raw.split("\n").map((l) => l.replace(/\s+$/g, ""));
      onChange(lines);
    },
    [onChange],
  );

  const handleBlur = useCallback((): void => {
    // Clean up empty lines when the user leaves the field.
    const cleaned = value.filter((line) => line.length > 0);
    if (cleaned.length !== value.length) {
      onChange(cleaned);
    }
  }, [value, onChange]);

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
        onBlur={handleBlur}
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
