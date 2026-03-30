"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface StepReviewProps {
  data: WizardFormData;
  onBack: () => void;
}

export function StepGoLive({ data, onBack }: StepReviewProps): React.ReactElement {
  const router = useRouter();

  const projectName = data.pagesProjectName;
  const stagingUrl = `https://staging-${projectName}.${projectName}.pages.dev`;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Review &amp; Stage</h2>

      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-muted)]">Pages Project</p>
            <p className="font-medium font-mono">{projectName}.pages.dev</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Site Name</p>
            <p className="font-medium">{data.siteName}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Company</p>
            <p className="font-medium">{data.company}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Vertical</p>
            <p className="font-medium">{data.vertical}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Theme</p>
            <p className="font-medium capitalize">{data.themeBase}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Articles/Week</p>
            <p className="font-medium">{data.articlesPerWeek}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-4 space-y-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Your site is being staged!
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          View staging preview at{" "}
          <a
            href={stagingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan underline underline-offset-2"
          >
            {stagingUrl}
          </a>
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          When you are ready to go live, visit the site detail page and use the Staging tab to promote to production.
        </p>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={(): void => router.push("/")}
          >
            Back to Dashboard
          </Button>
          <Button
            onClick={(): void => router.push(`/sites/${encodeURIComponent(projectName)}`)}
          >
            View Site Details
          </Button>
        </div>
      </div>
    </div>
  );
}
