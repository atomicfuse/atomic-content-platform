"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { attachCustomDomain } from "@/actions/wizard";

interface AttachDomainPanelProps {
  domain: string;
  pagesProject: string | null;
  customDomain: string | null;
}

export function AttachDomainPanel({
  domain,
  pagesProject,
  customDomain,
}: AttachDomainPanelProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [domainInput, setDomainInput] = useState("");

  function handleAttach(): void {
    if (!domainInput.trim()) return;
    startTransition(async () => {
      try {
        await attachCustomDomain(domain, domainInput.trim());
        setDomainInput("");
        toast("Custom domain attached", "success");
      } catch {
        toast("Failed to attach domain", "error");
      }
    });
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6">
      <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">
        Custom Domain
      </h3>
      {customDomain ? (
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-green-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm text-[var(--text-primary)]">
            Connected to{" "}
            <span className="font-mono text-cyan">{customDomain}</span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="example.com"
            value={domainInput}
            onChange={(e): void => setDomainInput(e.target.value)}
            onKeyDown={(e): void => {
              if (e.key === "Enter") handleAttach();
            }}
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan"
          />
          <Button
            size="sm"
            loading={isPending}
            disabled={!domainInput.trim() || !pagesProject}
            onClick={handleAttach}
          >
            Attach Domain
          </Button>
        </div>
      )}
    </div>
  );
}
