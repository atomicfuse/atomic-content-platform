"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface NewAuthorModalProps {
  open: boolean;
  onClose: () => void;
  sites: Array<{ domain: string }>;
}

/** New author: generate a full profile (optionally for a site or a beat) or start blank. Lands on the profile unsaved. */
export function NewAuthorModal({ open, onClose, sites }: NewAuthorModalProps): React.ReactElement {
  const router = useRouter();
  const [site, setSite] = useState("");
  const [beat, setBeat] = useState("");

  function generate(): void {
    const qs = new URLSearchParams({ generate: "1" });
    if (site) qs.set("site", site);
    if (beat.trim()) qs.set("beat", beat.trim());
    router.push(`/authors/new?${qs.toString()}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="New author" size="md">
      <div className="space-y-5">
        <div className="space-y-3 rounded-xl border border-cyan/30 bg-cyan/5 p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Generate with AI</p>
          <p className="text-xs text-[var(--text-secondary)]">Name, tagline, bio, beats and an illustrated portrait. You review everything before saving.</p>
          <label className="block text-xs text-[var(--text-secondary)]">
            For site (optional)
            <select value={site} onChange={(e): void => setSite(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50">
              <option value="">Any site</option>
              {sites.map((s) => <option key={s.domain} value={s.domain}>{s.domain}</option>)}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Beat (optional)
            <input value={beat} onChange={(e): void => setBeat(e.target.value)} placeholder="e.g. Royals, home espresso" className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50" />
          </label>
          <Button variant="primary" size="md" className="w-full min-h-11" onClick={generate}>Generate with AI</Button>
        </div>
        <Button variant="ghost" size="md" className="w-full" onClick={(): void => router.push("/authors/new")}>Start blank</Button>
      </div>
    </Modal>
  );
}
