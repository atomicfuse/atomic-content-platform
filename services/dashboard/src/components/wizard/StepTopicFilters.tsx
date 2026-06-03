"use client";

import { Button } from "@/components/ui/Button";
import { PerTopicReviewScreen } from "@/components/topic-review/PerTopicReviewScreen";
import type { WizardFormData, TopicV2 } from "@/types/dashboard";

interface Props {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepTopicFilters({ data, onChange, onNext, onBack }: Props): React.ReactElement {
  // The wizard collects topics in an earlier step (`data.topics` is a string[] of topic names).
  const topicNames = data.topics ?? [];

  function handleSave(topics: TopicV2[]): void {
    onChange({ topics_v2: topics });
    onNext();
  }

  if (topicNames.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Topic Filters</h2>
        <p className="text-sm text-[var(--text-muted)]">No topics defined yet. Go back and add topics first.</p>
        <Button variant="ghost" onClick={onBack}>← Back</Button>
      </div>
    );
  }

  return (
    <PerTopicReviewScreen
      siteTheme={data.theme}
      initialTopicNames={topicNames}
      defaultSchedule={{
        articles_per_week: Math.max(1, Math.ceil(7 / Math.max(1, topicNames.length))),
        preferred_days: data.preferredDays?.length ? data.preferredDays : ["Monday", "Wednesday", "Friday"],
      }}
      onSave={async (topics): Promise<void> => handleSave(topics)}
      saveLabel="Next →"
      onCancel={onBack}
      title="Topic Filters"
    />
  );
}
