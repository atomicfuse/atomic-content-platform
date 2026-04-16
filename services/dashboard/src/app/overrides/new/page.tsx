"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export default function NewOverridePage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();

  const [overrideId, setOverrideId] = useState("");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidId = /^[a-z0-9-]+$/.test(overrideId) && overrideId.length > 0;

  async function handleCreate(): Promise<void> {
    if (!isValidId) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        override_id: overrideId,
        name: name || overrideId,
        priority,
        targets: { groups: [], sites: [] },
        tracking: {},
        scripts: { head: [], body_start: [], body_end: [] },
        scripts_vars: {},
        ads_config: {},
        ads_txt: [],
      };

      const res = await fetch(`/api/overrides/${overrideId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Override created", "success");
      router.push(`/overrides/${overrideId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create override");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Create Override</h1>

      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-[var(--text-secondary)]">
        Overrides use <strong>REPLACE</strong> semantics. Any field you define
        in an override completely replaces the same field from the group merge
        chain for targeted sites. Fields you leave empty pass through untouched.
      </div>

      <Input
        label="Override ID"
        value={overrideId}
        onChange={(e): void => setOverrideId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
        placeholder="e.g. test-ads-mock"
      />
      {overrideId && !isValidId && (
        <p className="text-xs text-red-500">Use lowercase letters, numbers, and hyphens only.</p>
      )}

      <Input
        label="Name"
        value={name}
        onChange={(e): void => setName(e.target.value)}
        placeholder="Human-readable name"
      />

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Priority
        </label>
        <input
          type="number"
          value={priority}
          onChange={(e): void => setPriority(Number(e.target.value))}
          min={0}
          max={1000}
          className="w-24 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <p className="text-xs text-[var(--text-muted)]">
          Higher priority overrides are applied later and win conflicts.
        </p>
      </div>

      <div className="flex gap-3 pt-4">
        <Button onClick={handleCreate} loading={saving} disabled={!isValidId}>
          Create
        </Button>
        <Button variant="secondary" onClick={(): void => router.push("/overrides")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
