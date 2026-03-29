"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
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
  const [topicInput, setTopicInput] = useState("");

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

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Content Brief</h2>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Target Audience"
          placeholder="e.g. Young adults 25-40"
          value={data.audience}
          onChange={(e): void => onChange({ audience: e.target.value })}
        />
        <Input
          label="Tone"
          placeholder="e.g. Informative, friendly"
          value={data.tone}
          onChange={(e): void => onChange({ tone: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Topics
        </label>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 focus-within:ring-2 focus-within:ring-cyan/50 focus-within:border-cyan transition-colors">
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
        </div>
        <p className="text-xs text-[var(--text-muted)]">Press Enter or comma to add. Backspace to remove last.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Articles Per Week"
          type="number"
          min={1}
          max={14}
          value={data.articlesPerWeek}
          onChange={(e): void =>
            onChange({ articlesPerWeek: parseInt(e.target.value, 10) || 1 })
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
