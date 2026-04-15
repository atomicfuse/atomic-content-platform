"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function NewMonetizationPage(): React.ReactElement {
  const router = useRouter();
  const [monetizationId, setMonetizationId] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);

  function onIdChange(value: string): void {
    setMonetizationId(value);
    if (value && !KEBAB_CASE_REGEX.test(value)) {
      setIdError("Must be kebab-case (lowercase letters, numbers, hyphens)");
    } else {
      setIdError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!monetizationId || !KEBAB_CASE_REGEX.test(monetizationId)) {
      setIdError("Must be kebab-case (lowercase letters, numbers, hyphens)");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/monetization/${monetizationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monetization_id: monetizationId,
          name: name || monetizationId,
          provider: provider || "custom",
          tracking: {},
          scripts: { head: [], body_start: [], body_end: [] },
          scripts_vars: {},
          ads_config: {
            interstitial: false,
            layout: "standard",
            ad_placements: [],
          },
          ads_txt: [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push(`/monetization/${monetizationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Monetization Profile</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          A monetization profile bundles tracking, scripts, ad placements, and
          ads.txt entries. Sites reference one profile via{" "}
          <code className="rounded bg-[var(--bg-elevated)] px-1">monetization: &lt;id&gt;</code>.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-4">
          <Input
            label="Monetization ID"
            value={monetizationId}
            onChange={(e): void => onIdChange(e.target.value)}
            placeholder="premium-ads"
            error={idError ?? undefined}
            required
          />

          <Input
            label="Name"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder="Premium Ads"
          />

          <Input
            label="Provider"
            value={provider}
            onChange={(e): void => setProvider(e.target.value)}
            placeholder="network-alpha"
          />
        </div>

        <div className="flex gap-3">
          <Button type="submit" loading={saving}>
            Create Profile
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => router.push("/monetization")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
