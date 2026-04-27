"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { useAudiences } from "@/hooks/useReferenceData";
import { SiteConfigTab } from "@/components/site-detail/SiteConfigTab";
import { ContentGenerationPanel } from "@/components/site-detail/ContentGenerationPanel";
import { AttachDomainPanel } from "@/components/site-detail/AttachDomainPanel";
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
  pagesProject?: string | null;
  pagesSubdomain?: string | null;
  customDomain?: string | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MAP: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

export function ContentAgentTab({
  domain,
  brief,
  siteConfig,
  stagingBranch,
  pagesProject,
  pagesSubdomain,
  customDomain,
}: ContentAgentTabProps): React.ReactElement {
  const { toast } = useToast();
  const { audiences: audienceOptions } = useAudiences();

  // --- Identity state ---
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [siteName, setSiteName] = useState((siteConfig?.site_name as string) ?? "");
  const [siteTagline, setSiteTagline] = useState((siteConfig?.site_tagline as string) ?? "");
  const briefRaw = siteConfig?.brief as Record<string, unknown> | undefined;
  const [audiences, setAudiences] = useState<string[]>(() => {
    const raw = briefRaw?.audiences;
    if (Array.isArray(raw)) return raw as string[];
    const single = brief?.audience;
    return single ? [single] : [];
  });
  const [audienceIds, setAudienceIds] = useState<string[]>(() => {
    const raw = briefRaw?.audience_type_ids;
    if (Array.isArray(raw)) return raw as string[];
    const single = briefRaw?.audience_type_id as string | undefined;
    return single ? [single] : [];
  });
  const [tone, setTone] = useState(brief?.tone ?? "");

  // --- Content Brief state ---
  const [savingBrief, setSavingBrief] = useState(false);
  const [topics, setTopics] = useState<string[]>(brief?.topics ?? []);
  const [topicInput, setTopicInput] = useState("");
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

  // --- Quality state (part of Content Brief) ---
  const [qualityThreshold, setQualityThreshold] = useState(brief?.quality_threshold ?? 75);
  const [qualityWeights, setQualityWeights] = useState({
    seo_quality: brief?.quality_weights?.seo_quality ?? 20,
    tone_match: brief?.quality_weights?.tone_match ?? 20,
    content_length: brief?.quality_weights?.content_length ?? 20,
    factual_accuracy: brief?.quality_weights?.factual_accuracy ?? 20,
    keyword_relevance: brief?.quality_weights?.keyword_relevance ?? 20,
  });
  const weightsTotal = Object.values(qualityWeights).reduce((a, b) => a + b, 0);

  // --- Groups state ---
  const [savingGroups, setSavingGroups] = useState(false);
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

  // --- Overrides state ---
  const [overrides, setOverrides] = useState<Array<{
    id: string;
    name?: string;
    priority?: number;
    reason: string;
  }>>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);
  useEffect(() => {
    async function fetchOverrides(): Promise<void> {
      try {
        const res = await fetch("/api/overrides");
        if (!res.ok) { setOverridesLoading(false); return; }
        const all = (await res.json()) as Array<{
          id: string;
          name?: string;
          priority?: number;
          targets?: { groups?: string[]; sites?: string[] };
        }>;
        const matching = all
          .filter((o) => {
            const targetSites = o.targets?.sites ?? [];
            const targetGroups = o.targets?.groups ?? [];
            if (targetSites.includes(domain)) return true;
            for (const g of groups) {
              if (targetGroups.includes(g)) return true;
            }
            return false;
          })
          .map((o) => {
            const targetSites = o.targets?.sites ?? [];
            const targetGroups = o.targets?.groups ?? [];
            const reasons: string[] = [];
            if (targetSites.includes(domain)) reasons.push("targets this site directly");
            const matchedGroups = groups.filter((g) => targetGroups.includes(g));
            if (matchedGroups.length > 0) reasons.push(`via group: ${matchedGroups.join(", ")}`);
            return { id: o.id, name: o.name, priority: o.priority, reason: reasons.join("; ") };
          })
          .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
        setOverrides(matching);
      } catch { /* ignore */ }
      setOverridesLoading(false);
    }
    void fetchOverrides();
  }, [domain, groups]);

  function toggleDay(day: string): void {
    const fullDay = DAY_MAP[day]!;
    if (preferredDays.includes(fullDay)) {
      setPreferredDays(preferredDays.filter((d) => d !== fullDay));
    } else {
      setPreferredDays([...preferredDays, fullDay]);
    }
  }

  function addTopic(raw: string): void {
    const tag = raw.trim();
    if (tag && !topics.includes(tag)) setTopics([...topics, tag]);
    setTopicInput("");
  }
  function removeTopic(tag: string): void {
    setTopics(topics.filter((t) => t !== tag));
  }
  function handleTopicKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTopic(topicInput);
    } else if (e.key === "Backspace" && topicInput === "" && topics.length > 0) {
      removeTopic(topics[topics.length - 1]);
    }
  }

  async function saveIdentity(): Promise<void> {
    setSavingIdentity(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: { siteName, siteTagline, audiences, audienceIds, tone },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") toast("Identity saved", "success");
      else toast(data.message ?? "Failed to save", "error");
    } catch {
      toast("Failed to save identity", "error");
    } finally {
      setSavingIdentity(false);
    }
  }

  async function saveBrief(): Promise<void> {
    setSavingBrief(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: {
            topics,
            contentGuidelines: guidelines,
            articlesPerDay,
            preferredDays,
            quality_threshold: qualityThreshold,
            quality_weights: qualityWeights,
          },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") toast("Content brief saved", "success");
      else toast(data.message ?? "Failed to save", "error");
    } catch {
      toast("Failed to save content brief", "error");
    } finally {
      setSavingBrief(false);
    }
  }

  async function saveGroups(): Promise<void> {
    setSavingGroups(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: { groups },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") toast("Groups saved", "success");
      else toast(data.message ?? "Failed to save", "error");
    } catch {
      toast("Failed to save groups", "error");
    } finally {
      setSavingGroups(false);
    }
  }

  // --- Sub-tab content ---

  const identityContent = (
    <div className="space-y-6">
      <div className="space-y-4">
        <Input label="Site Name" value={siteName} onChange={(e): void => setSiteName(e.target.value)} />
        <Input label="Tagline" value={siteTagline} onChange={(e): void => setSiteTagline(e.target.value)} />
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Target Audiences
          </label>
          {audienceIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {audienceIds.map((id) => {
                const name = audienceOptions.find((a) => a.id === id)?.name ?? id;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={(): void => {
                        setAudienceIds(audienceIds.filter((x) => x !== id));
                        setAudiences(audiences.filter((_, i) => audienceIds[i] !== id));
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
            options={audienceOptions
              .filter((a) => !audienceIds.includes(a.id))
              .map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Add audience..."
            value=""
            onChange={(e): void => {
              const id = e.target.value;
              if (!id) return;
              const name = audienceOptions.find((a) => a.id === id)?.name ?? "";
              setAudienceIds([...audienceIds, id]);
              setAudiences([...audiences, name]);
            }}
          />
        </div>
        <Input label="Tone" value={tone} onChange={(e): void => setTone(e.target.value)} />
      </div>
      <AttachDomainPanel
        domain={domain}
        customDomain={customDomain ?? null}
      />
      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button onClick={saveIdentity} loading={savingIdentity}>Save Identity</Button>
      </div>
    </div>
  );

  const contentBriefContent = (
    <div className="space-y-6">
      {/* Topics, schedule, guidelines */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Topics
          </label>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 focus-within:ring-2 focus-within:ring-cyan/50 focus-within:border-cyan transition-colors">
            {topics.map((tag) => (
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
              placeholder={topics.length === 0 ? "Type a topic and press Enter or comma..." : "Add more..."}
              value={topicInput}
              onChange={(e): void => setTopicInput(e.target.value)}
              onKeyDown={handleTopicKeyDown}
              onBlur={(): void => { if (topicInput.trim()) addTopic(topicInput); }}
            />
          </div>
        </div>
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

      {/* Generate Articles */}
      <div className="border-t border-[var(--border-primary)] pt-4">
        <ContentGenerationPanel
          domain={domain}
          pagesProject={pagesProject ?? null}
          pagesSubdomain={pagesSubdomain ?? null}
          stagingBranch={stagingBranch ?? null}
        />
      </div>

      {/* Quality */}
      <div className="border-t border-[var(--border-primary)] pt-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">Quality</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Articles scoring below the threshold are flagged for review instead of auto-published.
        </p>

        {/* Threshold slider */}
        <div className="space-y-2 mb-4">
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

      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button onClick={saveBrief} loading={savingBrief}>Save Content Brief</Button>
      </div>
    </div>
  );

  const unassignedGroups = availableGroups.filter((g) => !groups.includes(g.id));

  const groupsContent = (
    <div className="space-y-6">
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
      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button onClick={saveGroups} loading={savingGroups}>Save Groups</Button>
      </div>
    </div>
  );

  const overridesContent = (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Config overrides that apply to this site — either targeting it directly or via group membership.
        Edit overrides from the <Link href="/overrides" className="text-cyan hover:underline">Overrides</Link> page.
      </p>

      {overridesLoading ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading overrides...</p>
      ) : overrides.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No overrides apply to this site.</p>
      ) : (
        <div className="space-y-2">
          {overrides.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <div className="flex-1 min-w-0">
                <Link
                  href={`/overrides/${encodeURIComponent(o.id)}`}
                  className="text-sm font-medium hover:text-cyan transition-colors"
                >
                  {o.name ?? o.id}
                </Link>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    priority: {o.priority ?? 0}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{o.reason}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const tabs = [
    { id: "identity", label: "Identity", content: identityContent },
    { id: "brief", label: "Content Brief", content: contentBriefContent },
    { id: "groups", label: "Groups", content: groupsContent },
    { id: "overrides", label: `Overrides${!overridesLoading && overrides.length > 0 ? ` (${overrides.length})` : ""}`, content: overridesContent },
    { id: "config", label: "Config", content: <SiteConfigTab domain={domain} /> },
  ];

  return <Tabs tabs={tabs} defaultTab="identity" />;
}
