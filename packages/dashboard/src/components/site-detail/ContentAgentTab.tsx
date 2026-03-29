"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { updateSiteBrief } from "@/actions/agent";
import { ContentGenerationPanel } from "./ContentGenerationPanel";

interface ContentAgentTabProps {
  domain: string;
  pagesProject: string | null;
  brief: {
    audience: string;
    tone: string;
    topics: string[];
    articles_per_week: number;
    preferred_days: string[];
    content_guidelines: string | string[];
  } | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MAP: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

export function ContentAgentTab({
  domain,
  pagesProject,
  brief,
}: ContentAgentTabProps): React.ReactElement {
  const [agentRunning, setAgentRunning] = useState(true);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const [audience, setAudience] = useState(brief?.audience ?? "");
  const [tone, setTone] = useState(brief?.tone ?? "");
  const [topics, setTopics] = useState(brief?.topics.join(", ") ?? "");
  const [articlesPerWeek, setArticlesPerWeek] = useState(
    brief?.articles_per_week ?? 5
  );
  const [preferredDays, setPreferredDays] = useState<string[]>(
    brief?.preferred_days ?? []
  );
  const [guidelines, setGuidelines] = useState(
    Array.isArray(brief?.content_guidelines)
      ? brief.content_guidelines.join("\n")
      : (brief?.content_guidelines ?? "")
  );

  function toggleDay(day: string): void {
    const fullDay = DAY_MAP[day]!;
    if (preferredDays.includes(fullDay)) {
      setPreferredDays(preferredDays.filter((d) => d !== fullDay));
    } else {
      setPreferredDays([...preferredDays, fullDay]);
    }
  }

  function handleSave(): void {
    startTransition(async () => {
      try {
        await updateSiteBrief(domain, {
          audience,
          tone,
          topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
          articles_per_week: articlesPerWeek,
          preferred_days: preferredDays,
          content_guidelines: guidelines.split("\n").filter(Boolean),
        });
        toast("Content brief updated", "success");
      } catch {
        toast("Failed to update brief", "error");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Content Generation Panel */}
      <ContentGenerationPanel domain={domain} pagesProject={pagesProject} />

      <hr className="border-[var(--border-secondary)]" />

      {/* Agent status */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]">
        <div className="flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              agentRunning ? "bg-green-400 animate-pulse" : "bg-[var(--text-muted)]"
            }`}
          />
          <div>
            <p className="text-sm font-medium">
              Agent {agentRunning ? "Running" : "Paused"}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Model: Claude 3.5 Sonnet
            </p>
          </div>
        </div>
        <Button
          variant={agentRunning ? "secondary" : "primary"}
          size="sm"
          onClick={(): void => setAgentRunning(!agentRunning)}
        >
          {agentRunning ? "Pause" : "Resume"}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)] text-center">
          <p className="text-2xl font-bold text-cyan">12</p>
          <p className="text-xs text-[var(--text-muted)]">Generated this week</p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)] text-center">
          <p className="text-2xl font-bold text-green-400">10</p>
          <p className="text-xs text-[var(--text-muted)]">Auto-published</p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)] text-center">
          <p className="text-2xl font-bold text-yellow-400">2</p>
          <p className="text-xs text-[var(--text-muted)]">Flagged</p>
        </div>
      </div>

      {/* Editable brief fields */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold">Content Brief</h3>
        <Input
          label="Target Audience"
          value={audience}
          onChange={(e): void => setAudience(e.target.value)}
        />
        <Input
          label="Tone"
          value={tone}
          onChange={(e): void => setTone(e.target.value)}
        />
        <Input
          label="Topics"
          value={topics}
          onChange={(e): void => setTopics(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Articles Per Week"
            type="number"
            min={1}
            max={14}
            value={articlesPerWeek}
            onChange={(e): void => setArticlesPerWeek(parseInt(e.target.value, 10) || 1)}
          />
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Preferred Days
            </label>
            <div className="flex gap-2">
              {DAYS.map((day) => {
                const fullDay = DAY_MAP[day]!;
                const isSelected = preferredDays.includes(fullDay);
                return (
                  <button
                    key={day}
                    onClick={(): void => toggleDay(day)}
                    className={`w-9 h-9 rounded-md text-xs font-semibold transition-colors ${
                      isSelected
                        ? "bg-cyan text-white"
                        : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
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
          rows={4}
          value={guidelines}
          onChange={(e): void => setGuidelines(e.target.value)}
        />
        <Button onClick={handleSave} loading={isPending}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
