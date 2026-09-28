"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface StepGoLiveProps {
  data: WizardFormData;
  stagingResult: { stagingUrl: string; siteFolder: string } | null;
  onBack: () => void;
}

export function StepGoLive({
  data,
  stagingResult,
  onBack,
}: StepGoLiveProps): React.ReactElement {
  const router = useRouter();

  const siteFolder = stagingResult?.siteFolder ?? data.pagesProjectName;
  const stagingUrl = stagingResult?.stagingUrl ?? null;
  const isGrid = data.template === "grid";
  const pills = (data.grid?.topics ?? []).map((t) => t.label.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Review &amp; Stage</h2>

      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-muted)]">Site Slug</p>
            <p className="font-medium font-mono">{siteFolder}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Site Name</p>
            <p className="font-medium">{data.siteName}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Company</p>
            <p className="font-medium">{data.company || "None"}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Category</p>
            <p className="font-medium">{data.vertical}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Theme</p>
            <p className="font-medium capitalize">{data.themePreset}</p>
          </div>
          {isGrid ? (
            <>
              <div>
                <p className="text-[var(--text-muted)]">Template</p>
                <p className="font-medium">Grid</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Topic pills</p>
                <p className="font-medium">
                  {pills.length > 0 ? `${pills.length}: ${pills.join(", ")}` : "0"}
                </p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Included sites</p>
                <p className="font-medium tabular-nums">{data.grid?.include_sites?.length ?? 0}</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Excluded sites</p>
                <p className="font-medium tabular-nums">{data.grid?.exclude_sites?.length ?? 0}</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-[var(--text-muted)]">Template</p>
                <p className="font-medium capitalize">{data.template ?? "modern"}</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Articles/Day</p>
                <p className="font-medium">{data.articlesPerDay}</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-4 space-y-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Your site is staged on the multi-tenant Worker.
        </p>
        {stagingUrl && (
          <p className="text-sm text-[var(--text-secondary)]">
            Worker preview:{" "}
            <a
              href={stagingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan underline underline-offset-2"
            >
              {stagingUrl}
            </a>
          </p>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          Open the site detail page to attach a custom domain (optional) and publish to production.
        </p>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={(): void => router.push("/")}>
            Back to Dashboard
          </Button>
          <Button onClick={(): void => router.push(`/sites/${encodeURIComponent(siteFolder)}`)}>
            View Site Details
          </Button>
        </div>
      </div>
    </div>
  );
}
