"use client";

import { useState, useEffect, useTransition } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { suggestTopics } from "@/actions/wizard";
import { useAudiences } from "@/hooks/useReferenceData";
import type { WizardFormData } from "@/types/dashboard";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MAP: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

interface StepContentBriefProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepContentBrief({
  data,
  onChange,
  onNext,
  onBack,
}: StepContentBriefProps): React.ReactElement {
  const { audiences } = useAudiences();
  const [topicInput, setTopicInput] = useState("");
  const [isSuggesting, startSuggest] = useTransition();
  const [didAutoSuggest, setDidAutoSuggest] = useState(false);

  // Auto-suggest topics when the user arrives with no topics
  useEffect(() => {
    if (data.topics.length === 0 && !didAutoSuggest && data.siteName) {
      setDidAutoSuggest(true);
      startSuggest(async () => {
        try {
          const topics = await suggestTopics({
            siteName: data.siteName,
            siteTagline: data.siteTagline || undefined,
            vertical: data.vertical,
            company: data.company || undefined,
            audience: data.audiences.join(", ") || undefined,
            tone: data.tone || undefined,
            contentGuidelines: data.contentGuidelines || undefined,
          });
          // Only set if user still hasn't manually added topics
          if (topics.length > 0) {
            onChange({ topics });
          }
        } catch {
          // Silently fail — topics are optional
        }
      });
    }
  }, [data.siteName, data.vertical, data.topics.length, didAutoSuggest, onChange]);

  function addTopic(raw: string): void {
    const tag = raw.trim();
    if (tag && !data.topics.includes(tag)) {
      onChange({ topics: [...data.topics, tag] });
    }
    setTopicInput("");
  }

  function removeTopic(tag: string): void {
    onChange({ topics: data.topics.filter((t) => t !== tag) });
  }

  function handleTopicKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTopic(topicInput);
    }
    if (e.key === "Backspace" && !topicInput && data.topics.length > 0) {
      removeTopic(data.topics[data.topics.length - 1]!);
    }
  }

  function toggleDay(day: string): void {
    const fullDay = DAY_MAP[day]!;
    const current = data.preferredDays;
    if (current.includes(fullDay)) {
      onChange({ preferredDays: current.filter((d) => d !== fullDay) });
    } else {
      onChange({ preferredDays: [...current, fullDay] });
    }
  }

  function handleRegenerateTopics(): void {
    startSuggest(async () => {
      try {
        const topics = await suggestTopics({
          siteName: data.siteName,
          siteTagline: data.siteTagline || undefined,
          vertical: data.vertical,
          company: data.company || undefined,
          audience: data.audiences.join(", ") || undefined,
          tone: data.tone || undefined,
          contentGuidelines: data.contentGuidelines || undefined,
        });
        if (topics.length > 0) {
          onChange({ topics });
        }
      } catch {
        // Silently fail
      }
    });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Content Brief</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Target Audiences
          </label>
          {data.audienceIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {data.audienceIds.map((id) => {
                const name = audiences.find((a) => a.id === id)?.name ?? id;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={(): void => {
                        onChange({
                          audienceIds: data.audienceIds.filter((x) => x !== id),
                          audiences: data.audiences.filter((_, i) => data.audienceIds[i] !== id),
                        });
                      }}
                      className="hover:text-red-400 transition-colors"
                    >
                      &times;
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <Select
            options={audiences
              .filter((a) => !data.audienceIds.includes(a.id))
              .map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Add audience..."
            value=""
            onChange={(e): void => {
              const id = e.target.value;
              if (!id) return;
              const name = audiences.find((a) => a.id === id)?.name ?? "";
              onChange({
                audienceIds: [...data.audienceIds, id],
                audiences: [...data.audiences, name],
              });
            }}
          />
        </div>
        <Input
          label="Tone"
          placeholder="e.g. Informative, friendly"
          value={data.tone}
          onChange={(e): void => onChange({ tone: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Topics
          </label>
          <button
            type="button"
            onClick={handleRegenerateTopics}
            disabled={isSuggesting}
            className="inline-flex items-center gap-1 text-xs text-cyan hover:text-cyan/80 transition-colors disabled:opacity-50"
          >
            {isSuggesting ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Suggesting...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
                AI Suggest
              </>
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 focus-within:ring-2 focus-within:ring-cyan/50 focus-within:border-cyan transition-colors">
          {isSuggesting && data.topics.length === 0 ? (
            <span className="text-sm text-[var(--text-muted)] animate-pulse">
              AI is suggesting topics...
            </span>
          ) : (
            <>
              {data.topics.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={(): void => removeTopic(tag)}
                    className="hover:text-red-400 transition-colors"
                  >
                    &times;
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[120px] bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                placeholder={data.topics.length === 0 ? "Type a topic and press Enter or comma..." : "Add more..."}
                value={topicInput}
                onChange={(e): void => setTopicInput(e.target.value)}
                onKeyDown={handleTopicKeyDown}
                onBlur={(): void => { if (topicInput.trim()) addTopic(topicInput); }}
              />
            </>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Press Enter or comma to add. Backspace to remove last. Topics are auto-suggested by AI.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Articles Per Day"
          type="number"
          min={1}
          max={10}
          value={data.articlesPerDay}
          onChange={(e): void =>
            onChange({ articlesPerDay: parseInt(e.target.value, 10) || 1 })
          }
        />
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Preferred Days
          </label>
          <div className="flex gap-2">
            {DAYS.map((day) => {
              const fullDay = DAY_MAP[day]!;
              const isSelected = data.preferredDays.includes(fullDay);
              return (
                <button
                  key={day}
                  onClick={(): void => toggleDay(day)}
                  className={`w-9 h-9 rounded-md text-xs font-semibold transition-colors ${
                    isSelected
                      ? "bg-cyan text-white"
                      : "bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Textarea
        label="Content Guidelines"
        placeholder="Any specific guidelines for AI-generated content..."
        rows={4}
        value={data.contentGuidelines}
        onChange={(e): void =>
          onChange({ contentGuidelines: e.target.value })
        }
      />

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={onNext}>Next &rarr;</Button>
      </div>
    </div>
  );
}
