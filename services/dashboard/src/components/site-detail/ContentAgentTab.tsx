"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { useAudiences, useVerticals, useCategories, useTags } from "@/hooks/useReferenceData";
import { SiteConfigTab } from "@/components/site-detail/SiteConfigTab";
import { SiteThemeTab } from "@/components/site-detail/SiteThemeTab";
import { ContentGenerationPanel } from "@/components/site-detail/ContentGenerationPanel";
import { AttachDomainPanel } from "@/components/site-detail/AttachDomainPanel";
import { generateLogoPreview, createBundleForSite } from "@/actions/wizard";
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
    image_guidelines?: string | string[];
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
  currentLogoPath?: string | null;
  currentFaviconPath?: string | null;
  previewUrl?: string | null;
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
  currentLogoPath,
  currentFaviconPath,
  previewUrl,
}: ContentAgentTabProps): React.ReactElement {
  const { toast } = useToast();
  const router = useRouter();
  const { audiences: audienceOptions } = useAudiences();

  // --- Identity state ---
  const [savingIdentity, setSavingIdentity] = useState(false);
  const initSiteName = (siteConfig?.site_name as string) ?? "";
  const initSiteTagline = (siteConfig?.site_tagline as string) ?? "";
  const briefRaw = siteConfig?.brief as Record<string, unknown> | undefined;
  const initAudienceIds = (() => {
    const raw = briefRaw?.audience_type_ids;
    if (Array.isArray(raw)) return raw as string[];
    const single = briefRaw?.audience_type_id as string | undefined;
    return single ? [single] : [];
  })();
  const initTone = brief?.tone ?? "";
  const [siteName, setSiteName] = useState(initSiteName);
  const [siteTagline, setSiteTagline] = useState(initSiteTagline);
  const initAuthor = (siteConfig?.author as string) ?? "";
  const [author, setAuthor] = useState(initAuthor);
  const [audiences, setAudiences] = useState<string[]>(() => {
    const raw = briefRaw?.audiences;
    if (Array.isArray(raw)) return raw as string[];
    const single = brief?.audience;
    return single ? [single] : [];
  });
  const [audienceIds, setAudienceIds] = useState<string[]>(initAudienceIds);
  const [tone, setTone] = useState(initTone);

  // --- Assets state ---
  const [assetVersion, setAssetVersion] = useState(0);
  function assetUrl(assetPath: string): string {
    const file = assetPath.replace(/^\//, "");
    return `/api/sites/asset?domain=${encodeURIComponent(domain)}&file=${encodeURIComponent(file)}&v=${assetVersion}`;
  }
  const logoFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);
  const [pendingLogo, setPendingLogo] = useState<string | null>(null);
  const [pendingFooterLogo, setPendingFooterLogo] = useState<string | null>(null);
  const [pendingFavicon, setPendingFavicon] = useState<string | null>(null);
  const [faviconSameAsLogo, setFaviconSameAsLogo] = useState(true);
  const [autoFooterVariant, setAutoFooterVariant] = useState(true);
  const [clearLogo, setClearLogo] = useState(false);
  const [clearFooterLogo, setClearFooterLogo] = useState(false);
  const [isGeneratingLogo, startGenLogo] = useTransition();

  // When logo changes and sync is on, auto-copy to favicon
  function setLogoAndSync(base64: string): void {
    setPendingLogo(base64);
    setClearLogo(false);
    if (faviconSameAsLogo) setPendingFavicon(base64);
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please select an image file (PNG, JPG, SVG)", "error"); return; }
    if (file.size > 2 * 1024 * 1024) { toast("Image must be under 2MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = (): void => {
      const base64Data = (reader.result as string).split(",")[1];
      if (base64Data) setLogoAndSync(base64Data);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleFaviconUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "image/x-icon") { toast("Please select an image file (PNG, ICO, SVG)", "error"); return; }
    if (file.size > 500 * 1024) { toast("Favicon must be under 500KB", "error"); return; }
    const reader = new FileReader();
    reader.onload = (): void => {
      const base64Data = (reader.result as string).split(",")[1];
      if (base64Data) {
        setPendingFavicon(base64Data);
        setFaviconSameAsLogo(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleGenerateLogo(): void {
    startGenLogo(async () => {
      try {
        const { logo, footerLogo } = await generateLogoPreview(domain, {
          generateFooterVariant: autoFooterVariant,
        });
        if (logo) {
          setLogoAndSync(logo);
          setPendingFooterLogo(footerLogo);
          setClearFooterLogo(false);
          if (footerLogo) {
            toast("Generated a footer variant — header and footer backgrounds invert", "info");
          }
        } else {
          toast("AI could not generate an image — try again", "error");
        }
      } catch (err) {
        toast(`Generation failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
      }
    });
  }

  function handleRemoveLogo(): void {
    setPendingLogo(null);
    setPendingFavicon(null);
    setClearLogo(true);
  }

  function handleRemoveFooterLogo(): void {
    setPendingFooterLogo(null);
    setClearFooterLogo(true);
  }

  // --- Content Brief state ---
  const [savingBrief, setSavingBrief] = useState(false);
  const initTopics = brief?.topics ?? [];
  const initArticlesPerDay = brief?.articles_per_day
    ?? Math.max(1, Math.ceil((brief?.articles_per_week ?? 5) / Math.max(1, brief?.preferred_days?.length ?? 7)));
  const initPreferredDays = brief?.preferred_days ?? [];
  const initGuidelines = Array.isArray(brief?.content_guidelines)
    ? brief.content_guidelines.join("\n")
    : (brief?.content_guidelines ?? "");
  const initImageGuidelines = Array.isArray(brief?.image_guidelines)
    ? brief.image_guidelines.join("\n")
    : (brief?.image_guidelines ?? "");
  const initQualityThreshold = brief?.quality_threshold ?? 40;
  const initQualityWeights = {
    seo_quality: brief?.quality_weights?.seo_quality ?? 20,
    tone_match: brief?.quality_weights?.tone_match ?? 20,
    content_length: brief?.quality_weights?.content_length ?? 20,
    factual_accuracy: brief?.quality_weights?.factual_accuracy ?? 20,
    keyword_relevance: brief?.quality_weights?.keyword_relevance ?? 20,
  };
  const initVerticalId = (briefRaw?.vertical_id as string) ?? "";
  // Filter out the vertical ID from category_ids — it's stored separately in vertical_id.
  // Legacy wizard builds included it in both; the agent merges them at query time.
  const initCategoryIds = ((briefRaw?.category_ids as string[]) ?? [])
    .filter((id) => id !== initVerticalId);
  const initTagIds = (briefRaw?.tag_ids as string[]) ?? [];
  const initSeoKeywords = (briefRaw?.seo_keywords_focus as string[]) ?? [];
  const [topics, setTopics] = useState<string[]>(initTopics);
  const [topicInput, setTopicInput] = useState("");
  const [articlesPerDay, setArticlesPerDay] = useState(initArticlesPerDay);
  const [preferredDays, setPreferredDays] = useState<string[]>(initPreferredDays);
  const [guidelines, setGuidelines] = useState(initGuidelines);
  const [imageGuidelines, setImageGuidelines] = useState(initImageGuidelines);

  // --- Quality state (part of Content Brief) ---
  const [qualityThreshold, setQualityThreshold] = useState(initQualityThreshold);
  const [qualityWeights, setQualityWeights] = useState(initQualityWeights);
  const weightsTotal = Object.values(qualityWeights).reduce((a, b) => a + b, 0);

  // --- Niche Targeting state ---
  const [verticalId, setVerticalId] = useState<string>(initVerticalId);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(initCategoryIds);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initTagIds);
  const [selectedTagNames, setSelectedTagNames] = useState<Map<string, string>>(new Map());
  const [tagSearch, setTagSearch] = useState("");
  const [seoKeywords, setSeoKeywords] = useState<string[]>(initSeoKeywords);
  const [seoKeywordInput, setSeoKeywordInput] = useState("");
  const [bundleId, setBundleId] = useState<string>((siteConfig?.bundle_id as string) ?? "");
  const [creatingBundle, setCreatingBundle] = useState(false);
  const [verticalSearch, setVerticalSearch] = useState("");
  const [verticalDropdownOpen, setVerticalDropdownOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");

  const { verticals } = useVerticals();
  const { categories } = useCategories(verticalId);
  const { tags: allTags, loading: tagsLoading, refetch: refetchTags } = useTags();
  const [creatingTag, setCreatingTag] = useState(false);

  function toggleCategory(id: string): void {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function addTag(id: string, name: string): void {
    if (!selectedTagIds.includes(id)) {
      setSelectedTagIds((prev) => [...prev, id]);
      setSelectedTagNames((prev) => new Map(prev).set(id, name));
    }
    setTagSearch("");
  }

  function removeTag(id: string): void {
    setSelectedTagIds((prev) => prev.filter((t) => t !== id));
    setSelectedTagNames((prev) => { const m = new Map(prev); m.delete(id); return m; });
  }

  async function createAndAddTag(name: string): Promise<void> {
    setCreatingTag(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok || res.status === 201) {
        const tag = (await res.json()) as { id: string; name: string };
        addTag(tag.id, tag.name);
        refetchTags();
      } else if (res.status === 409) {
        // Duplicate — find in loaded tags and add
        const existing = allTags.find(
          (t) => t.name.toLowerCase() === name.toLowerCase(),
        );
        if (existing) addTag(existing.id, existing.name);
      }
    } catch { /* ignore */ }
    setCreatingTag(false);
    setTagSearch("");
  }

  function addSeoKeyword(raw: string): void {
    const kw = raw.trim();
    if (kw && !seoKeywords.includes(kw)) setSeoKeywords([...seoKeywords, kw]);
    setSeoKeywordInput("");
  }
  function removeSeoKeyword(kw: string): void {
    setSeoKeywords(seoKeywords.filter((k) => k !== kw));
  }
  function handleSeoKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSeoKeyword(seoKeywordInput);
    } else if (e.key === "Backspace" && seoKeywordInput === "" && seoKeywords.length > 0) {
      removeSeoKeyword(seoKeywords[seoKeywords.length - 1]!);
    }
  }

  // Populate tag names from loaded tags for display
  useEffect(() => {
    for (const t of allTags) {
      if (selectedTagIds.includes(t.id) && !selectedTagNames.has(t.id)) {
        setSelectedTagNames((prev) => new Map(prev).set(t.id, t.name));
      }
    }
  }, [allTags, selectedTagIds, selectedTagNames]);

  // --- Groups state ---
  const [savingGroups, setSavingGroups] = useState(false);
  const initGroups = (siteConfig?.groups as string[] | undefined) ?? (siteConfig?.group ? [siteConfig.group as string] : []);
  const [groups, setGroups] = useState<string[]>(initGroups);
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
    // When "same as logo" is on, let the save route auto-extract a square
    // icon favicon from the logo instead of using the full logo as favicon.
    const effectiveFavicon = faviconSameAsLogo ? null : pendingFavicon;
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: pendingLogo ?? null,
          footerLogoBase64: pendingFooterLogo ?? undefined,
          faviconBase64: effectiveFavicon ?? null,
          clearLogo: clearLogo || undefined,
          clearFooterLogo: clearFooterLogo || undefined,
          configUpdates: { siteName, siteTagline, author, audiences, audienceIds, tone },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") {
        toast("Identity saved", "success");
        setPendingLogo(null);
        setPendingFooterLogo(null);
        setPendingFavicon(null);
        setClearLogo(false);
        setClearFooterLogo(false);
        setAssetVersion((v) => v + 1);
        router.refresh();
      } else {
        toast(data.message ?? "Failed to save", "error");
      }
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
            imageGuidelines,
            articlesPerDay,
            preferredDays,
            quality_threshold: qualityThreshold,
            quality_weights: qualityWeights,
            verticalId,
            vertical: verticals.find((v) => v.id === verticalId)?.name,
            categoryIds: selectedCategoryIds,
            tagIds: selectedTagIds,
            seoKeywords,
            bundleId: bundleId || undefined,
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

  const identityDirty =
    siteName !== initSiteName ||
    siteTagline !== initSiteTagline ||
    author !== initAuthor ||
    tone !== initTone ||
    JSON.stringify(audienceIds) !== JSON.stringify(initAudienceIds) ||
    !!pendingLogo ||
    !!pendingFooterLogo ||
    !!pendingFavicon ||
    clearLogo ||
    clearFooterLogo;

  const briefDirty =
    JSON.stringify(topics) !== JSON.stringify(initTopics) ||
    articlesPerDay !== initArticlesPerDay ||
    JSON.stringify(preferredDays) !== JSON.stringify(initPreferredDays) ||
    guidelines !== initGuidelines ||
    qualityThreshold !== initQualityThreshold ||
    JSON.stringify(qualityWeights) !== JSON.stringify(initQualityWeights) ||
    verticalId !== initVerticalId ||
    JSON.stringify(selectedCategoryIds) !== JSON.stringify(initCategoryIds) ||
    JSON.stringify(selectedTagIds) !== JSON.stringify(initTagIds) ||
    JSON.stringify(seoKeywords) !== JSON.stringify(initSeoKeywords);

  const groupsDirty = JSON.stringify(groups) !== JSON.stringify(initGroups);

  const identityContent = (
    <div className="space-y-6">
      <div className="space-y-4">
        <Input label="Site Name" value={siteName} onChange={(e): void => setSiteName(e.target.value)} />
        <Input label="Tagline" value={siteTagline} onChange={(e): void => setSiteTagline(e.target.value)} />
        <Input label="Default Author" value={author} onChange={(e): void => setAuthor(e.target.value)} placeholder="e.g. Sarah Mitchell" />
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
      {/* Assets (Logo & Favicon) */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Assets (optional)</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Optional — AI will generate a logo if you skip this
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Logo */}
          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Logo</h4>

            {!pendingLogo && currentLogoPath && (
              <div className="flex items-center gap-3">
                <img
                  src={assetUrl(currentLogoPath)}
                  alt="Current logo"
                  className="w-14 h-14 rounded-lg object-contain bg-white border border-[var(--border-secondary)]"
                  onError={(e): void => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <p className="text-xs text-[var(--text-muted)]">Current logo</p>
              </div>
            )}

            {pendingLogo && (
              <div className="flex items-center gap-3">
                <img
                  src={`data:image/png;base64,${pendingLogo}`}
                  alt="Logo preview"
                  className="w-14 h-14 rounded-lg object-contain bg-white border border-[var(--border-secondary)]"
                />
                <div className="flex-1">
                  <p className="text-xs font-medium text-[var(--text-primary)]">New logo ready</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Save to apply</p>
                </div>
                <button
                  type="button"
                  onClick={(): void => setPendingLogo(null)}
                  className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1"
                  title="Discard logo"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={(): void => logoFileRef.current?.click()}>
                {pendingLogo || currentLogoPath ? "Replace Logo" : "Upload Logo"}
              </Button>
              <Button variant="secondary" size="sm" loading={isGeneratingLogo} onClick={handleGenerateLogo}>
                {isGeneratingLogo ? "Generating..." : "Generate with AI"}
              </Button>
              {(currentLogoPath || pendingLogo) && !clearLogo && (
                <Button variant="ghost" size="sm" onClick={handleRemoveLogo}>
                  Remove Logo
                </Button>
              )}
              {clearLogo && (
                <span className="text-xs text-red-400">
                  Logo will be removed on save.{" "}
                  <button type="button" onClick={(): void => setClearLogo(false)} className="underline hover:text-red-300">
                    Undo
                  </button>
                </span>
              )}
              <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFooterVariant}
                onChange={(e): void => setAutoFooterVariant(e.target.checked)}
                className="accent-cyan"
              />
              <span className="text-xs text-[var(--text-secondary)]">
                Auto-generate footer variant when header/footer contrast inverts
              </span>
            </label>
            {(!!pendingFooterLogo || !!(siteConfig?.theme as Record<string, unknown> | undefined)?.footer_logo) && !clearFooterLogo && (
              <div className="flex items-center gap-2">
                {pendingFooterLogo && (
                  <img
                    src={`data:image/png;base64,${pendingFooterLogo}`}
                    alt="Footer logo preview"
                    className="w-10 h-10 rounded object-contain bg-[var(--bg-elevated)] border border-[var(--border-secondary)]"
                  />
                )}
                <span className="text-xs text-[var(--text-muted)]">
                  {pendingFooterLogo ? "Footer variant ready" : "Footer variant set"}
                </span>
                <Button variant="ghost" size="sm" onClick={handleRemoveFooterLogo}>
                  Remove Footer Logo
                </Button>
              </div>
            )}
            {clearFooterLogo && (
              <span className="text-xs text-red-400">
                Footer logo will be removed on save.{" "}
                <button type="button" onClick={(): void => setClearFooterLogo(false)} className="underline hover:text-red-300">
                  Undo
                </button>
              </span>
            )}
            <p className="text-xs text-[var(--text-muted)]">PNG, JPG or SVG, max 2MB.</p>
          </div>

          {/* Favicon */}
          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Favicon</h4>

            {/* Sync toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={faviconSameAsLogo}
                onChange={(e): void => {
                  const checked = e.target.checked;
                  setFaviconSameAsLogo(checked);
                  if (checked && pendingLogo) setPendingFavicon(pendingLogo);
                }}
                className="accent-cyan"
              />
              <span className="text-xs text-[var(--text-secondary)]">Same as logo</span>
            </label>

            {faviconSameAsLogo ? (
              /* Synced mode — show preview of whatever logo is */
              <div className="space-y-3">
                {(pendingLogo || pendingFavicon) ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={`data:image/png;base64,${pendingLogo ?? pendingFavicon}`}
                      alt="Favicon preview"
                      className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
                    />
                    <p className="text-xs text-[var(--text-muted)]">Will use the logo as favicon</p>
                  </div>
                ) : currentLogoPath ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={assetUrl(currentLogoPath)}
                      alt="Current favicon"
                      className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
                      onError={(e): void => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <p className="text-xs text-[var(--text-muted)]">Using logo as favicon</p>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">Favicon will match the logo</p>
                )}
              </div>
            ) : (
              /* Independent mode — full favicon controls */
              <div className="space-y-3">
                {!pendingFavicon && currentFaviconPath && (
                  <div className="flex items-center gap-3">
                    <img
                      src={assetUrl(currentFaviconPath)}
                      alt="Current favicon"
                      className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
                      onError={(e): void => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <p className="text-xs text-[var(--text-muted)]">Current favicon</p>
                  </div>
                )}

                {pendingFavicon && (
                  <div className="flex items-center gap-3">
                    <img
                      src={`data:image/png;base64,${pendingFavicon}`}
                      alt="Favicon preview"
                      className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
                    />
                    <div className="flex-1">
                      <p className="text-xs font-medium text-[var(--text-primary)]">New favicon ready</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Save to apply</p>
                    </div>
                    <button
                      type="button"
                      onClick={(): void => setPendingFavicon(null)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1"
                      title="Discard favicon"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={(): void => faviconFileRef.current?.click()}>
                    {pendingFavicon || currentFaviconPath ? "Replace Favicon" : "Upload Favicon"}
                  </Button>
                  <input ref={faviconFileRef} type="file" accept=".png,.ico,.svg,image/png,image/x-icon,image/svg+xml" className="hidden" onChange={handleFaviconUpload} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">PNG, ICO or SVG, max 500KB.</p>
              </div>
            )}

            {/* Browser tab mockup — always visible */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Browser tab preview</p>
              <div className="inline-block">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg bg-[var(--bg-elevated)] border border-b-0 border-[var(--border-secondary)] max-w-[180px]">
                  {(() => {
                    const favSrc = faviconSameAsLogo
                      ? (pendingLogo ? `data:image/png;base64,${pendingLogo}` : currentLogoPath ? assetUrl(currentLogoPath) : null)
                      : (pendingFavicon ? `data:image/png;base64,${pendingFavicon}` : currentFaviconPath ? assetUrl(currentFaviconPath) : null);
                    return favSrc
                      ? <img src={favSrc} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" />
                      : <div className="w-4 h-4 rounded-sm bg-[var(--border-secondary)] flex-shrink-0" />;
                  })()}
                  <span className="text-xs text-[var(--text-primary)] truncate">
                    {domain.replace(/\.pages\.dev$/, "").split(".")[0] ?? domain}
                  </span>
                </div>
                <div className="border border-[var(--border-secondary)] rounded-tr-lg rounded-b-lg bg-[var(--bg-primary)] px-3 py-2 w-56">
                  <div className="h-2 w-3/4 rounded bg-[var(--border-secondary)]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AttachDomainPanel
        domain={domain}
        customDomain={customDomain ?? null}
      />
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        {identityDirty ? (
          <p className="text-xs text-amber-500">You have unsaved changes — click Save Identity to apply.</p>
        ) : (
          <span />
        )}
        <Button onClick={saveIdentity} loading={savingIdentity} disabled={!identityDirty || savingIdentity}>Save Identity</Button>
      </div>
    </div>
  );

  const selectedVerticalName = verticals.find((v) => v.id === verticalId)?.name ?? "";
  const filteredVerticals = verticalSearch
    ? verticals.filter((v) => v.name.toLowerCase().includes(verticalSearch.toLowerCase()))
    : verticals;

  const filteredCategories = categoryFilter
    ? categories.filter((c) => c.name.toLowerCase().includes(categoryFilter.toLowerCase()))
    : categories;

  const filteredTags = tagSearch
    ? allTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
    : allTags;

  const contentBriefContent = (
    <div className="space-y-6">
      {/* Niche Targeting */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Niche Targeting</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Controls which content the aggregator returns for article generation.
        </p>

        {/* Category (tier-1) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Category
          </label>
          <div className="relative">
            <input
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
              placeholder="Search categories..."
              value={verticalDropdownOpen ? verticalSearch : selectedVerticalName || verticalSearch}
              onChange={(e): void => {
                setVerticalSearch(e.target.value);
                setVerticalDropdownOpen(true);
              }}
              onFocus={(): void => {
                setVerticalDropdownOpen(true);
                setVerticalSearch("");
              }}
              onBlur={(): void => {
                // Delay so click on option registers before close
                setTimeout(() => setVerticalDropdownOpen(false), 200);
              }}
            />
            {verticalId && !verticalDropdownOpen && (
              <button
                type="button"
                onClick={(): void => {
                  setVerticalId("");
                  setVerticalSearch("");
                  setSelectedCategoryIds([]);
                  setSelectedTagIds([]);
                  setSelectedTagNames(new Map());
                  setTagSearch("");
                  setCategoryFilter("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                title="Clear category"
              >
                &times;
              </button>
            )}
            {verticalDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg max-h-48 overflow-y-auto">
                {filteredVerticals.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] px-3 py-2">No categories found</p>
                ) : (
                  filteredVerticals.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onMouseDown={(e): void => e.preventDefault()}
                      onClick={(): void => {
                        if (v.id !== verticalId) {
                          setVerticalId(v.id);
                          setSelectedCategoryIds([]);
                          setSelectedTagIds([]);
                          setSelectedTagNames(new Map());
                          setTagSearch("");
                          setCategoryFilter("");
                        }
                        setVerticalSearch("");
                        setVerticalDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-surface)] flex items-center justify-between ${
                        v.id === verticalId ? "text-cyan font-medium" : "text-[var(--text-primary)]"
                      }`}
                    >
                      <span>{v.name}</span>
                      {v.iab_code && (
                        <span className="text-[10px] text-[var(--text-muted)]">{v.iab_code}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Subcategories */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Subcategories
            {selectedCategoryIds.length > 0 && (
              <span className="ml-1.5 text-cyan font-mono">({selectedCategoryIds.length})</span>
            )}
          </label>
          {!verticalId ? (
            <p className="text-xs text-[var(--text-muted)] py-2">Select a category to browse subcategories.</p>
          ) : (
            <>
              <input
                className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                placeholder="Filter subcategories..."
                value={categoryFilter}
                onChange={(e): void => setCategoryFilter(e.target.value)}
              />
              {/* Selected subcategory pills */}
              {selectedCategoryIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedCategoryIds.map((id) => {
                    const cat = categories.find((c) => c.id === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 text-violet-400 px-2 py-0.5 text-xs font-semibold"
                      >
                        {cat?.name ?? id}
                        <button
                          type="button"
                          onClick={(): void => toggleCategory(id)}
                          className="hover:text-red-400 transition-colors"
                        >
                          &times;
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {/* Select all filtered button */}
              {categoryFilter.trim() && filteredCategories.length > 0 && (
                <button
                  type="button"
                  onClick={(): void => {
                    const newIds = filteredCategories
                      .map((c) => c.id)
                      .filter((id) => !selectedCategoryIds.includes(id));
                    if (newIds.length > 0) {
                      setSelectedCategoryIds((prev) => [...prev, ...newIds]);
                    }
                  }}
                  className="text-xs font-semibold text-cyan hover:text-cyan/80 transition-colors"
                >
                  + Select all filtered ({filteredCategories.filter((c) => !selectedCategoryIds.includes(c.id)).length})
                </button>
              )}
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 space-y-1">
                {filteredCategories.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-1 px-2">No categories found</p>
                ) : (
                  filteredCategories.map((cat) => (
                    <label
                      key={cat.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategoryIds.includes(cat.id)}
                        onChange={(): void => toggleCategory(cat.id)}
                        className="accent-cyan"
                      />
                      <span className="text-sm text-[var(--text-primary)]">{cat.name}</span>
                      {cat.iab_code && (
                        <span className="text-[10px] text-[var(--text-muted)] ml-auto">{cat.iab_code}</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Tags
            {selectedTagIds.length > 0 && (
              <span className="ml-1.5 text-cyan font-mono">({selectedTagIds.length})</span>
            )}
          </label>
          {!verticalId ? (
            <p className="text-xs text-[var(--text-muted)] py-2">Select a category to browse tags.</p>
          ) : (
            <>
              <input
                className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                placeholder="Filter or create tags..."
                value={tagSearch}
                onChange={(e): void => setTagSearch(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 space-y-1">
                {tagsLoading ? (
                  <p className="text-xs text-[var(--text-muted)] py-1 px-2">Loading tags...</p>
                ) : filteredTags.length === 0 && !tagSearch.trim() ? (
                  <p className="text-xs text-[var(--text-muted)] py-1 px-2">No tags found</p>
                ) : (
                  <>
                    {filteredTags.map((tag) => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface)] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTagIds.includes(tag.id)}
                          onChange={(): void => {
                            if (selectedTagIds.includes(tag.id)) {
                              removeTag(tag.id);
                            } else {
                              addTag(tag.id, tag.name);
                            }
                          }}
                          className="accent-cyan"
                        />
                        <span className="text-sm text-[var(--text-primary)]">{tag.name}</span>
                        {tag.usage_count !== undefined && (
                          <span className="text-[10px] text-[var(--text-muted)] ml-auto">{tag.usage_count} items</span>
                        )}
                      </label>
                    ))}
                    {tagSearch.trim() && !allTags.some((t) => t.name.toLowerCase() === tagSearch.trim().toLowerCase()) && (
                      <button
                        type="button"
                        onClick={(): void => void createAndAddTag(tagSearch.trim())}
                        disabled={creatingTag}
                        className="w-full text-left px-2 py-1.5 text-sm text-cyan hover:bg-[var(--bg-surface)] font-medium rounded"
                      >
                        {creatingTag ? "Creating..." : `+ Create "${tagSearch.trim()}"`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Bundle */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Content Bundle
          </label>
          {bundleId ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-[var(--text-primary)] font-mono">{bundleId}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[var(--text-muted)]">No content bundle assigned.</p>
              <button
                type="button"
                disabled={creatingBundle || !verticalId || selectedCategoryIds.length === 0}
                onClick={async (): Promise<void> => {
                  setCreatingBundle(true);
                  try {
                    const bundle = await createBundleForSite(
                      siteName || domain,
                      verticalId,
                      selectedCategoryIds,
                      selectedTagIds,
                    );
                    setBundleId(bundle.id);
                    // Save the bundleId to the site config
                    await fetch("/api/sites/save", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        domain,
                        logoBase64: null,
                        faviconBase64: null,
                        configUpdates: { bundleId: bundle.id },
                      }),
                    });
                    toast("Content bundle created", "success");
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Failed to create bundle", "error");
                  } finally {
                    setCreatingBundle(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan/10 text-cyan border border-cyan/20 hover:bg-cyan/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creatingBundle ? (
                  <>
                    <span className="w-3 h-3 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  "+ Create Bundle"
                )}
              </button>
              {!verticalId && (
                <p className="text-xs text-amber-400">Select a category above first.</p>
              )}
              {verticalId && selectedCategoryIds.length === 0 && (
                <p className="text-xs text-amber-400">Select at least one subcategory above.</p>
              )}
            </div>
          )}
        </div>

        {/* SEO Keywords */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            SEO Keywords
          </label>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 focus-within:ring-2 focus-within:ring-cyan/50 focus-within:border-cyan transition-colors">
            {seoKeywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-0.5 text-xs font-semibold"
              >
                {kw}
                <button type="button" onClick={(): void => removeSeoKeyword(kw)} className="hover:text-red-400 transition-colors">
                  &times;
                </button>
              </span>
            ))}
            <input
              className="flex-1 min-w-[120px] bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              placeholder={seoKeywords.length === 0 ? "Type a keyword and press Enter..." : "Add more..."}
              value={seoKeywordInput}
              onChange={(e): void => setSeoKeywordInput(e.target.value)}
              onKeyDown={handleSeoKeywordKeyDown}
              onBlur={(): void => { if (seoKeywordInput.trim()) addSeoKeyword(seoKeywordInput); }}
            />
          </div>
        </div>
      </div>

      {/* Topics, schedule, guidelines */}
      <div className="border-t border-[var(--border-primary)] pt-4 space-y-4">
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
        <Textarea
          label="Image Guidelines"
          rows={3}
          value={imageGuidelines}
          onChange={(e): void => setImageGuidelines(e.target.value)}
          placeholder="One guideline per line (e.g., style, colors, composition)"
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

      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        {briefDirty ? (
          <p className="text-xs text-amber-500">You have unsaved changes — click Save Content Brief to apply.</p>
        ) : (
          <span />
        )}
        <Button onClick={saveBrief} loading={savingBrief} disabled={!briefDirty || savingBrief}>Save Content Brief</Button>
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
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        {groupsDirty ? (
          <p className="text-xs text-amber-500">You have unsaved changes — click Save Groups to apply.</p>
        ) : (
          <span />
        )}
        <Button onClick={saveGroups} loading={savingGroups} disabled={!groupsDirty || savingGroups}>Save Groups</Button>
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
    { id: "theme", label: "Theme", content: <SiteThemeTab domain={domain} /> },
    { id: "brief", label: "Content Brief", content: contentBriefContent },
    { id: "groups", label: "Groups", content: groupsContent },
    { id: "overrides", label: `Overrides${!overridesLoading && overrides.length > 0 ? ` (${overrides.length})` : ""}`, content: overridesContent },
    { id: "config", label: "Config", content: <SiteConfigTab domain={domain} /> },
  ];

  return <Tabs tabs={tabs} defaultTab="identity" />;
}
