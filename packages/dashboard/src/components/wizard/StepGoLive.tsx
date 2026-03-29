"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { goLive } from "@/actions/wizard";
import type { WizardFormData } from "@/types/dashboard";

interface StepGoLiveProps {
  data: WizardFormData;
  onBack: () => void;
}

export function StepGoLive({ data, onBack }: StepGoLiveProps): React.ReactElement {
  const [isLive, setIsLive] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function handleGoLive(): void {
    startTransition(async () => {
      try {
        await goLive(data.domain);
        setIsLive(true);
        toast(`${data.domain} is now live!`, "success");
      } catch (error) {
        toast(
          `Failed to go live: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error"
        );
      }
    });
  }

  if (isLive) {
    return (
      <div className="text-center space-y-6 py-12">
        <div className="text-6xl">&#x1F680;</div>
        <h2 className="text-2xl font-bold">
          {data.siteName} is Live!
        </h2>
        <p className="text-[var(--text-secondary)]">
          Your site at <strong>{data.domain}</strong> has been deployed to production.
        </p>
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            onClick={(): void => router.push("/")}
          >
            Back to Dashboard
          </Button>
          <Button
            onClick={(): void => router.push(`/sites/${encodeURIComponent(data.domain)}`)}
          >
            View Site Details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Go Live</h2>

      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-muted)]">Domain</p>
            <p className="font-medium">{data.domain}</p>
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

      <p className="text-sm text-[var(--text-secondary)]">
        This will deploy your site to production and set its status to Ready.
        You can configure monetization after going live.
      </p>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={handleGoLive} loading={isPending}>
          &#x1F680; Go Live
        </Button>
      </div>
    </div>
  );
}
