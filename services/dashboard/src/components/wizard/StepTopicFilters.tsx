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
        // articles_per_week defaults to 1; users tune up per-topic.
        // preferred_days inherits the user's site-level Content Brief choice
        // so the wizard stays consistent — pick "Mon, Wed, Fri" once and each
        // topic starts on the same days.
        articles_per_week: 1,
        preferred_days: data.preferredDays?.length ? data.preferredDays : ["Monday"],
      }}
      onSave={async (topics): Promise<void> => handleSave(topics)}
      saveLabel="Next →"
      onCancel={onBack}
      title="Topic Filters"
    />
  );
}
