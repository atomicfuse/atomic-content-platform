"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { TrackingForm } from "@/components/settings/TrackingForm";
import { ScriptsEditor } from "@/components/settings/ScriptsEditor";
import { ScriptVariablesEditor } from "@/components/settings/ScriptVariablesEditor";
import { AdsConfigForm } from "@/components/settings/AdsConfigForm";
import { InheritanceIndicator } from "@/components/ui/InheritanceIndicator";
import type { AdsConfigFormValue } from "@/components/settings/AdsConfigForm";
import Link from "next/link";

interface ContentAgentTabProps {
  domain: string;
  brief: {
    audience: string;
    tone: string;
    topics: string[];
    articles_per_day?: number;
    articles_per_week?: number;
    preferred_days: string[];
    content_guidelines: string | string[];
    quality_threshold?: number;
    quality_weights?: {
      seo_quality?: number;
      tone_match?: number;
      content_length?: number;
      factual_accuracy?: number;
      keyword_relevance?: number;
    };
  } | null;
  siteConfig: Record<string, unknown> | null;
  stagingBranch?: string | null;
}

interface TrackingConfig {
  ga4: string | null;
  gtm: string | null;
  google_ads: string | null;
  facebook_pixel: string | null;
  custom: Array<{ name: string; src: string; position: "head" | "body_start" | "body_end" }>;
}

interface ScriptsConfig {
  head: Array<{ id: string; src?: string; inline?: string; async?: boolean }>;
  body_start: Array<{ id: string; src?: string; inline?: string; async?: boolean }>;
  body_end: Array<{ id: string; src?: string; inline?: string; async?: boolean }>;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MAP: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const DEFAULT_TRACKING: TrackingConfig = {
  ga4: null, gtm: null, google_ads: null, facebook_pixel: null, custom: [],
};

const DEFAULT_SCRIPTS: ScriptsConfig = {
  head: [], body_start: [], body_end: [],
};

const DEFAULT_ADS: AdsConfigFormValue = {
  interstitial: false, layout: "standard", in_content_slots: 3, sidebar: true, ad_placements: [],
};

export function ContentAgentTab({
  domain,
  brief,
  siteConfig,
  stagingBranch,
}: ContentAgentTabProps): React.ReactElement {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // --- Identity state ---
  const [siteName, setSiteName] = useState((siteConfig?.site_name as string) ?? "");
  const [siteTagline, setSiteTagline] = useState((siteConfig?.site_tagline as string) ?? "");

  // --- Content Brief state ---
  const [audience, setAudience] = useState(brief?.audience ?? "");
  const [tone, setTone] = useState(brief?.tone ?? "");
  const [topics, setTopics] = useState(brief?.topics.join(", ") ?? "");
  const [articlesPerDay, setArticlesPerDay] = useState(
    brief?.articles_per_day
      ?? Math.max(1, Math.ceil((brief?.articles_per_week ?? 5) / Math.max(1, brief?.preferred_days?.length ?? 7)))
  );
  const [preferredDays, setPreferredDays] = useState<string[]>(brief?.preferred_days ?? []);
  const [guidelines, setGuidelines] = useState(
    Array.isArray(brief?.content_guidelines)
      ? brief.content_guidelines.join("\n")
      : (brief?.content_guidelines ?? "")
  );

  // --- Groups (editable) ---
  const [groups, setGroups] = useState<string[]>(
    (siteConfig?.groups as string[] | undefined) ?? (siteConfig?.group ? [siteConfig.group as string] : [])
  );
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name?: string }>>([]);
  useEffect(() => {
    fetch("/api/groups")
      .then(async (r) => (r.ok ? ((await r.json()) as Array<{ id: string; name?: string }>) : []))
      .then(setAvailableGroups)
      .catch(() => setAvailableGroups([]));
  }, []);

  // --- Tracking state ---
  const rawTracking = siteConfig?.tracking as Record<string, unknown> | undefined;
  const [tracking, setTracking] = useState<TrackingConfig>({
    ga4: (rawTracking?.ga4 as string) ?? null,
    gtm: (rawTracking?.gtm as string) ?? null,
    google_ads: (rawTracking?.google_ads as string) ?? null,
    facebook_pixel: (rawTracking?.facebook_pixel as string) ?? null,
    custom: (rawTracking?.custom as TrackingConfig["custom"]) ?? [],
  });

  // --- Scripts state ---
  const rawScripts = siteConfig?.scripts as Record<string, unknown> | undefined;
  const [scripts, setScripts] = useState<ScriptsConfig>({
    head: (rawScripts?.head as ScriptsConfig["head"]) ?? [],
    body_start: (rawScripts?.body_start as ScriptsConfig["body_start"]) ?? [],
    body_end: (rawScripts?.body_end as ScriptsConfig["body_end"]) ?? [],
  });

  // --- Script Variables state ---
  const [scriptVars, setScriptVars] = useState<Record<string, string>>(
    (siteConfig?.scripts_vars as Record<string, string>) ?? {}
  );

  // --- Ads Config state ---
  const rawAds = siteConfig?.ads_config as Record<string, unknown> | undefined;
  const [adsConfig, setAdsConfig] = useState<AdsConfigFormValue>({
    interstitial: (rawAds?.interstitial as boolean) ?? false,
    layout: (rawAds?.layout as string) ?? "standard",
    in_content_slots: (rawAds?.in_content_slots as number) ?? 3,
    sidebar: (rawAds?.sidebar as boolean) ?? true,
    ad_placements: (rawAds?.ad_placements as AdsConfigFormValue["ad_placements"]) ?? [],
  });

  // --- Quality state ---
  const [qualityThreshold, setQualityThreshold] = useState(brief?.quality_threshold ?? 75);
  const [qualityWeights, setQualityWeights] = useState({
    seo_quality: brief?.quality_weights?.seo_quality ?? 20,
    tone_match: brief?.quality_weights?.tone_match ?? 20,
    content_length: brief?.quality_weights?.content_length ?? 20,
    factual_accuracy: brief?.quality_weights?.factual_accuracy ?? 20,
    keyword_relevance: brief?.quality_weights?.keyword_relevance ?? 20,
  });
  const weightsTotal = Object.values(qualityWeights).reduce((a, b) => a + b, 0);

  // --- Org config for inheritance indicators ---
  const [orgConfig, setOrgConfig] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/api/settings/org")
      .then(async (r) => (r.ok ? ((await r.json()) as Record<string, unknown>) : null))
      .then(setOrgConfig)
      .catch(() => setOrgConfig(null));
  }, []);

  function toggleDay(day: string): void {
    const fullDay = DAY_MAP[day]!;
    if (preferredDays.includes(fullDay)) {
      setPreferredDays(preferredDays.filter((d) => d !== fullDay));
    } else {
      setPreferredDays([...preferredDays, fullDay]);
    }
  }

  function hasCustomValue(section: string): "custom" | "org" | null {
    if (!siteConfig) return null;
    const val = siteConfig[section];
    if (val === undefined || val === null) return "org";
    if (typeof val === "object" && Object.keys(val as object).length === 0) return "org";
    return "custom";
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          configUpdates: {
            siteName,
            siteTagline,
            audience,
            tone,
            topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
            contentGuidelines: guidelines,
            articlesPerDay,
            preferredDays,
            groups,
            tracking,
            scripts,
            scripts_vars: scriptVars,
            ads_config: adsConfig,
            quality_threshold: qualityThreshold,
            quality_weights: qualityWeights,
          },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") {
        toast("Site config saved", "success");
      } else {
        toast(data.message ?? "Failed to save", "error");
      }
    } catch {
      toast("Failed to save site config", "error");
    } finally {
      setSaving(false);
    }
  }

  // --- Sub-tab content ---

  const identityContent = (
    <div className="space-y-4">
      <Input label="Site Name" value={siteName} onChange={(e): void => setSiteName(e.target.value)} />
      <Input label="Tagline" value={siteTagline} onChange={(e): void => setSiteTagline(e.target.value)} />
      <Input label="Target Audience" value={audience} onChange={(e): void => setAudience(e.target.value)} />
      <Input label="Tone" value={tone} onChange={(e): void => setTone(e.target.value)} />
    </div>
  );

  const contentBriefContent = (
    <div className="space-y-4">
      <Input label="Topics" value={topics} onChange={(e): void => setTopics(e.target.value)} placeholder="Comma-separated topics" />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Articles Per Day"
          type="number"
          min={1}
          max={10}
          value={articlesPerDay}
          onChange={(e): void => setArticlesPerDay(parseInt(e.target.value, 10) || 1)}
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
        placeholder="One guideline per line"
      />
    </div>
  );

  const unassignedGroups = availableGroups.filter((g) => !groups.includes(g.id));

  const groupsContent = (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Groups determine inherited tracking, scripts, and ads config.
        Edit group settings from the <Link href="/groups" className="text-cyan hover:underline">Groups</Link> page.
      </p>

      {/* Assigned groups */}
      {groups.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No groups assigned.</p>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Assigned Groups
          </label>
          {groups.map((g) => (
            <div
              key={g}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]"
            >
              <span className="w-2 h-2 rounded-full bg-cyan" />
              <Link href={`/groups/${encodeURIComponent(g)}`} className="text-sm font-medium hover:text-cyan transition-colors">
                {availableGroups.find((ag) => ag.id === g)?.name ?? g}
              </Link>
              <span className="text-xs text-[var(--text-muted)]">{g}</span>
              <button
                type="button"
                onClick={(): void => setGroups(groups.filter((x) => x !== g))}
                className="ml-auto text-[var(--text-muted)] hover:text-red-400 transition-colors p-1"
                title="Remove group"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add group */}
      {unassignedGroups.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Add Group
          </label>
          <div className="flex flex-wrap gap-2">
            {unassignedGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={(): void => setGroups([...groups, g.id])}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--border-secondary)] text-[var(--text-secondary)] hover:border-cyan hover:text-cyan transition-colors"
              >
                + {g.name ?? g.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const orgTracking = orgConfig?.tracking as Record<string, unknown> | undefined;
  const inheritedTracking: Partial<TrackingConfig> = orgTracking
    ? {
        ga4: (orgTracking.ga4 as string) ?? null,
        gtm: (orgTracking.gtm as string) ?? null,
        google_ads: (orgTracking.google_ads as string) ?? null,
        facebook_pixel: (orgTracking.facebook_pixel as string) ?? null,
      }
    : {};

  const trackingContent = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">Tracking IDs</span>
        <InheritanceIndicator source={hasCustomValue("tracking")} />
      </div>
      <TrackingForm
        value={tracking}
        onChange={setTracking}
        inheritedValues={inheritedTracking}
      />
    </div>
  );

  const scriptsContent = (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-[var(--text-muted)]">Script Entries</span>
          <InheritanceIndicator source={hasCustomValue("scripts")} />
        </div>
        <ScriptsEditor
          value={scripts}
          onChange={setScripts}
        />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-[var(--text-muted)]">Script Variables</span>
          <InheritanceIndicator source={hasCustomValue("scripts_vars")} />
        </div>
        <ScriptVariablesEditor
          value={scriptVars}
          onChange={setScriptVars}
        />
      </div>
    </div>
  );

  const adsContent = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">Advertising Config</span>
        <InheritanceIndicator source={hasCustomValue("ads_config")} />
      </div>
      <AdsConfigForm
        value={adsConfig}
        onChange={setAdsConfig}
      />
    </div>
  );

  const qualityContent = (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Articles scoring below the threshold are flagged for review instead of auto-published.
      </p>

      {/* Threshold slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Approval Threshold
          </label>
          <span className="text-sm font-mono font-bold text-cyan">{qualityThreshold}/100</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={qualityThreshold}
          onChange={(e): void => setQualityThreshold(parseInt(e.target.value, 10))}
          className="w-full h-2 rounded-full appearance-none bg-[var(--bg-surface)] cursor-pointer accent-cyan"
        />
        <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
          <span>0 (publish all)</span>
          <span>100 (review all)</span>
        </div>
      </div>

      {/* Criteria weights */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Criteria Weights
          </label>
          <span className={`text-[10px] font-mono ${weightsTotal === 100 ? "text-green-400" : "text-red-400"}`}>
            Total: {weightsTotal}/100
          </span>
        </div>
        {([
          { key: "seo_quality" as const, label: "SEO Quality" },
          { key: "tone_match" as const, label: "Tone Match" },
          { key: "content_length" as const, label: "Content Length" },
          { key: "factual_accuracy" as const, label: "Factual Accuracy" },
          { key: "keyword_relevance" as const, label: "Keyword Relevance" },
        ]).map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-secondary)] w-32 shrink-0">{label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={qualityWeights[key]}
              onChange={(e): void =>
                setQualityWeights((prev) => ({ ...prev, [key]: parseInt(e.target.value, 10) }))
              }
              className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--bg-surface)] cursor-pointer accent-cyan"
            />
            <span className="text-xs font-mono text-[var(--text-muted)] w-8 text-right">
              {qualityWeights[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const tabs = [
    { id: "identity", label: "Identity", content: identityContent },
    { id: "brief", label: "Content Brief", content: contentBriefContent },
    { id: "groups", label: "Groups", content: groupsContent },
    { id: "tracking", label: "Tracking", content: trackingContent },
    { id: "scripts", label: "Scripts & Vars", content: scriptsContent },
    { id: "ads", label: "Ads Config", content: adsContent },
    { id: "quality", label: "Quality", content: qualityContent },
  ];

  return (
    <div className="space-y-6">
      <Tabs tabs={tabs} defaultTab="identity" />
      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button onClick={handleSave} loading={saving}>
          Save All Changes
        </Button>
      </div>
    </div>
  );
}
