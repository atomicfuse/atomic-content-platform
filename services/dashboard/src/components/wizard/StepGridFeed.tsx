"use client";

import { Button } from "@/components/ui/Button";
import { GridSettingsSection } from "@/components/config/grid/GridSettingsSection";
import type { GridFields } from "@/types/grid";
import type { WizardFormData } from "@/types/dashboard";

interface StepGridFeedProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * A Grid feed has stories to show when at least one topic pill has a label
 * and a vertical, or at least one site is explicitly included.
 */
export function isGridFeedReady(grid: GridFields | undefined): boolean {
  const hasTopic = (grid?.topics ?? []).some(
    (t) => t.label.trim().length > 0 && t.verticals.length > 0,
  );
  const hasIncludedSite = (grid?.include_sites ?? []).length > 0;
  return hasTopic || hasIncludedSite;
}

/** Grid-template wizard step: topic pills, source sites and feed knobs. */
export function StepGridFeed({
  data,
  onChange,
  onNext,
  onBack,
}: StepGridFeedProps): React.ReactElement {
  const canProceed = isGridFeedReady(data.grid);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Grid Feed</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Choose the topic pills and which network sites feed them. Stories come from Live sites in the
          selected verticals.
        </p>
      </div>

      <GridSettingsSection
        value={data.grid ?? {}}
        onChange={(grid): void => onChange({ grid })}
      />

      <div className="flex items-center justify-between gap-4 pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <div className="flex items-center gap-3">
          {!canProceed && (
            <p id="grid-feed-next-reason" role="status" className="text-xs text-[var(--text-muted)] text-right">
              Add a topic pill with a label and a vertical, or include at least one site.
            </p>
          )}
          <Button
            onClick={onNext}
            disabled={!canProceed}
            aria-describedby={canProceed ? undefined : "grid-feed-next-reason"}
          >
            Next &rarr;
          </Button>
        </div>
      </div>
    </div>
  );
}
