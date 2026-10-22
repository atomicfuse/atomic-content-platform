"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `/groups/new` creates an empty group; `/groups/new?from=<id>` clones that group's settings (never its sites). */
export default function NewGroupPage({ searchParams }: { searchParams: Promise<{ from?: string }> }): React.ReactElement {
  const { from } = use(searchParams);
  const router = useRouter();
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);

  useEffect(() => {
    if (!from) return;
    fetch(`/api/groups/${encodeURIComponent(from)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? `Group "${from}" not found` : `HTTP ${res.status}`);
        const config = (await res.json()) as Record<string, unknown>;
        setSource(config);
        setName(`${typeof config.name === "string" ? config.name : from} (copy)`);
        setGroupId(`${from}-copy`);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load the group to clone"));
  }, [from]);

  function onGroupIdChange(value: string): void {
    setGroupId(value);
    if (value && !KEBAB_CASE_REGEX.test(value)) {
      setIdError("Must be kebab-case (lowercase letters, numbers, hyphens)");
    } else {
      setIdError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();

    if (!groupId || !KEBAB_CASE_REGEX.test(groupId)) {
      setIdError("Must be kebab-case (lowercase letters, numbers, hyphens)");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Site membership lives on each site, so a clone copies the settings and no sites.
      const body = source
        ? { ...source, name: name || groupId, ...("id" in source ? { id: groupId } : {}) }
        : { name: name || groupId };
      const res = await fetch(`/api/groups/${groupId}?create=1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      router.push(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
      setSaving(false);
    }
  }

  const cloning = Boolean(from);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{cloning ? "Clone Group" : "Create New Group"}</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          {cloning
            ? <>Copies every setting of <span className="font-mono">{from}</span> (ads, scripts, tracking, ads.txt, theme…) into a new group. No sites are added — add sites to it from each site&apos;s settings.</>
            : "Groups let you share configuration across multiple sites."}
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
            label="Group ID"
            value={groupId}
            onChange={(e): void => onGroupIdChange(e.target.value)}
            placeholder="my-group"
            error={idError ?? undefined}
            required
          />

          <Input
            label="Name"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder="My Group"
          />
        </div>

        <div className="flex gap-3">
          <Button type="submit" loading={saving} disabled={cloning && !source}>
            {cloning ? "Clone Group" : "Create Group"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => router.push(cloning && from ? `/groups/${from}` : "/groups")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
