"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function NewGroupPage(): React.ReactElement {
  const router = useRouter();
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);

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
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || groupId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create New Group</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Groups let you share configuration across multiple sites.
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
          <Button type="submit" loading={saving}>
            Create Group
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => router.push("/groups")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
