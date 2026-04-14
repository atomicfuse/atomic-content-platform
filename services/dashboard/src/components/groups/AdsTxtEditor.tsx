"use client";

import { useCallback } from "react";
import { Textarea } from "@/components/ui/Textarea";

interface AdsTxtEditorProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function AdsTxtEditor({ value, onChange }: AdsTxtEditorProps): React.ReactElement {
  const textValue = value.join("\n");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const lines = e.target.value.split("\n").filter((line) => line.trim() !== "");
      onChange(lines);
    },
    [onChange],
  );

  const entryCount = value.filter((line) => line.trim() !== "").length;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Ads.txt Entries
        </label>
        <span className="text-xs text-[var(--text-muted)]">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </span>
      </div>

      <Textarea
        value={textValue}
        onChange={handleChange}
        placeholder="google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0"
        rows={10}
        className="font-mono text-xs"
      />

      <p className="text-xs text-[var(--text-muted)]">
        One entry per line. Each line should follow the format: domain, publisher-id, relationship, cert-authority
      </p>
    </div>
  );
}
