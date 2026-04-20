"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface SchedulerConfig {
  enabled: boolean;
  run_at_hours: number[];
  timezone: string;
}

interface RunResult {
  status?: string;
  configStatus?: string;
  skippedGlobal?: string;
  triggered?: string[];
  skipped?: Array<{ domain: string; reason: string }>;
  errors?: Array<{ domain: string; error: string }>;
  error?: string;
  details?: string;
}

type Preset = "once" | "twice" | "every4" | "every2" | "custom";

const PRESETS: Record<Exclude<Preset, "custom">, number[]> = {
  once: [14],
  twice: [9, 21],
  every4: [0, 4, 8, 12, 16, 20],
  every2: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
};

function detectPreset(hours: number[]): Preset {
  const sorted = [...hours].sort((a, b) => a - b).join(",");
  for (const [name, preset] of Object.entries(PRESETS)) {
    if ([...preset].sort((a, b) => a - b).join(",") === sorted) {
      return name as Preset;
    }
  }
  return "custom";
}

export default function SettingsSchedulerPage(): React.ReactElement {
  const { toast } = useToast();
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [preset, setPreset] = useState<Preset>("once");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/scheduler");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SchedulerConfig;
        setConfig(data);
        setPreset(detectPreset(data.run_at_hours));
      } catch {
        toast("Failed to load scheduler config", "error");
      }
      setLoading(false);
    })();
  }, [toast]);

  function setHours(hours: number[]): void {
    if (!config) return;
    setConfig({ ...config, run_at_hours: [...new Set(hours)].sort((a, b) => a - b) });
  }

  function onPresetChange(next: Preset): void {
    setPreset(next);
    if (next !== "custom") setHours(PRESETS[next]);
  }

  function toggleHour(hour: number): void {
    if (!config) return;
    if (config.run_at_hours.includes(hour)) {
      setHours(config.run_at_hours.filter((h) => h !== hour));
    } else {
      setHours([...config.run_at_hours, hour]);
    }
    setPreset("custom");
  }

  async function save(): Promise<void> {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/scheduler", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Scheduler config saved", "success");
    } catch {
      toast("Failed to save scheduler config", "error");
    }
    setSaving(false);
  }

  async function runNow(): Promise<void> {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/scheduler/run-now", { method: "POST" });
      const data = (await res.json()) as RunResult;
      setRunResult(data);
      if (res.ok) {
        toast(
          `Triggered ${data.triggered?.length ?? 0} site(s)`,
          "success",
        );
      } else {
        toast(data.error ?? "Run failed", "error");
      }
    } catch (err) {
      toast("Run failed", "error");
      setRunResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setRunning(false);
  }

  if (loading || !config) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading scheduler…</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General Scheduler</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Controls when the content pipeline fires across all sites. Each tick
          loops every site and publishes per its own preferred days.
        </p>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]">
        <div>
          <p className="text-sm font-medium">Scheduler enabled</p>
          <p className="text-xs text-[var(--text-muted)]">
            When off, no sites publish (even when hours match). Use &quot;Run now&quot; to fire manually.
          </p>
        </div>
        <button
          onClick={(): void => setConfig({ ...config, enabled: !config.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            config.enabled ? "bg-cyan" : "bg-[var(--bg-surface)]"
          }`}
          aria-label="Toggle scheduler enabled"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              config.enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {/* Timezone */}
      <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
          Timezone
        </label>
        <input
          type="text"
          value={config.timezone}
          onChange={(e): void => setConfig({ ...config, timezone: e.target.value })}
          placeholder="e.g. EST, America/New_York, UTC"
          className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-cyan"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Used for both hour-matching and per-site day-of-week checks.
        </p>
      </div>

      {/* Frequency preset */}
      <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Frequency
        </label>
        <select
          value={preset}
          onChange={(e): void => onPresetChange(e.target.value as Preset)}
          className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-cyan"
        >
          <option value="once">Once daily (14:00)</option>
          <option value="twice">Twice daily (9:00, 21:00)</option>
          <option value="every4">Every 4 hours</option>
          <option value="every2">Every 2 hours</option>
          <option value="custom">Custom</option>
        </select>

        <div>
          <p className="text-xs text-[var(--text-muted)] mb-2">
            Run at hours ({config.timezone}):
          </p>
          <div className="grid grid-cols-12 gap-1.5">
            {Array.from({ length: 24 }, (_, h) => h).map((h) => {
              const on = config.run_at_hours.includes(h);
              return (
                <button
                  key={h}
                  onClick={(): void => toggleHour(h)}
                  className={`h-9 rounded-md text-xs font-semibold transition-colors ${
                    on
                      ? "bg-cyan text-white"
                      : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                  title={`${String(h).padStart(2, "0")}:00`}
                >
                  {String(h).padStart(2, "0")}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={save} loading={saving}>Save</Button>
        <Button variant="secondary" onClick={runNow} loading={running}>
          Run now
        </Button>
      </div>

      {runResult && (
        <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] space-y-2">
          <p className="text-sm font-semibold">Last run</p>
          {runResult.error ? (
            <p className="text-xs text-red-400">
              {runResult.error}
              {runResult.details ? ` — ${runResult.details}` : ""}
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                configStatus: {runResult.configStatus ?? "—"}
                {runResult.skippedGlobal ? `  •  skippedGlobal: ${runResult.skippedGlobal}` : ""}
              </p>
              <div className="text-xs space-y-1">
                <p>
                  <span className="text-green-700 dark:text-green-400 font-mono">
                    triggered ({runResult.triggered?.length ?? 0}):
                  </span>{" "}
                  {runResult.triggered?.join(", ") || "—"}
                </p>
                <p>
                  <span className="text-yellow-700 dark:text-yellow-400 font-mono">
                    skipped ({runResult.skipped?.length ?? 0}):
                  </span>{" "}
                  {runResult.skipped?.map((s) => `${s.domain} (${s.reason})`).join(", ") || "—"}
                </p>
                <p>
                  <span className="text-red-400 font-mono">
                    errors ({runResult.errors?.length ?? 0}):
                  </span>{" "}
                  {runResult.errors?.map((e) => `${e.domain} (${e.error})`).join(", ") || "—"}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
