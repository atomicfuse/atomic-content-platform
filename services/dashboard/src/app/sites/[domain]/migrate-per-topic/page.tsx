"use client";

import { useRouter, useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { PerTopicReviewScreen } from "@/components/topic-review/PerTopicReviewScreen";
import { migrateSiteToPerTopic } from "@/actions/per-topic-migration";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import type { TopicV2 } from "@/types/dashboard";

interface SiteSummary {
  topics: string[];
  bundle_ids: string[];
  /** Subset of bundle_ids that are only used by this site (safe to delete). */
  orphan_bundle_ids: string[];
}

export default function MigratePerTopicPage(): React.ReactElement {
  const router = useRouter();
  const params = useParams<{ domain: string }>();
  const { toast } = useToast();
  const domain = (params.domain as string) ?? "";

  const [theme, setTheme] = useState("");
  const [step, setStep] = useState<"theme" | "review">("theme");
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [deleteOrphans, setDeleteOrphans] = useState(true);

  // Load the site's topics + bundles for the migration flow.
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/sites/migration-summary?domain=${domain}`);
      if (res.ok) setSummary((await res.json()) as SiteSummary);
    })();
  }, [domain]);

  async function handleSave(topics: TopicV2[]): Promise<void> {
    const result = await migrateSiteToPerTopic({
      domain,
      theme,
      topics_v2: topics,
      deleteOrphanBundleIds: deleteOrphans ? (summary?.orphan_bundle_ids ?? []) : [],
    });
    if (result.status === "ok") {
      toast("Migration complete — next scheduled run will use per-topic filters", "success");
      router.push(`/sites/${domain}`);
    } else {
      toast(result.message ?? "Migration failed", "error");
    }
  }

  if (step === "theme") {
    return (
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Migrate to per-topic filters</h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Step 1 of 2 — describe the site&apos;s editorial theme in 1–2 lines. The AI uses this to propose a filter for each topic.
          </p>
        </header>
        <textarea
          placeholder="Travel and eating while traveling — destinations, food tourism, wine routes."
          value={theme}
          onChange={(e): void => setTheme(e.target.value)}
          className="w-full min-h-[80px] rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={(): void => router.push(`/sites/${domain}`)}>Cancel</Button>
          <Button onClick={(): void => setStep("review")} disabled={!theme.trim() || !summary}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  if (!summary) return <div className="p-6">Loading…</div>;

  return (
    <PerTopicReviewScreen
      siteTheme={theme}
      initialTopicNames={summary.topics}
      defaultSchedule={{ articles_per_week: Math.max(1, Math.ceil(7 / Math.max(1, summary.topics.length))), preferred_days: ["Monday", "Wednesday", "Friday"] }}
      onSave={handleSave}
      saveLabel="Confirm migration"
      onCancel={(): void => router.push(`/sites/${domain}`)}
      title={`Migrate ${domain} to per-topic filters`}
      banner={
        summary.orphan_bundle_ids.length > 0 ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={deleteOrphans} onChange={(e): void => setDeleteOrphans(e.target.checked)} />
              <span>Also delete this site&apos;s <strong>{summary.orphan_bundle_ids.length}</strong> orphan bundles on the aggregator</span>
            </label>
          </div>
        ) : null
      }
    />
  );
}
