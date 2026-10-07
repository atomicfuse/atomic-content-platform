"use client";

import type { BundleOption, GridFields, SiteOption } from "@/types/grid";
import { TopicsEditor } from "./TopicsEditor";
import { SiteMultiPicker } from "./SiteMultiPicker";
import { ChipMultiSelect } from "./ChipMultiSelect";
import { categoryOptions } from "./categoryOptions";
import type { CategoryItem } from "@/lib/reference-data";

interface GridSettingsFormProps {
  value: GridFields;
  onChange: (next: GridFields) => void;
  sites: SiteOption[];
  verticals: string[];
  /** Content Aggregator bundles for the pill editor. */
  bundles?: BundleOption[];
  /** Content Aggregator taxonomy for "Blocked categories". */
  categories?: CategoryItem[];
}

type NumberKey = "per_site_limit" | "per_bundle_limit" | "max_age_days" | "excerpt_paragraphs" | "feed_ad_every" | "page_size";

const NUMBER_FIELDS: ReadonlyArray<{ key: NumberKey; label: string; min: number; max: number; hint: string }> = [
  {
    key: "per_site_limit",
    label: "Articles per source site",
    min: 1,
    max: 100,
    hint: "Newest N published articles pulled from each source (default 10).",
  },
  {
    key: "per_bundle_limit",
    label: "Stories per bundle",
    min: 1,
    max: 100,
    hint: "Newest N stories pulled from each aggregator bundle (default 20).",
  },
  { key: "max_age_days", label: "Maximum age (days)", min: 1, max: 3650, hint: "Empty means no age limit." },
  {
    key: "page_size",
    label: "Cards per page",
    min: 6,
    max: 60,
    hint: "Also the infinite-scroll batch size (default 20).",
  },
  {
    key: "feed_ad_every",
    label: "Ad every Nth tile",
    min: 0,
    max: 50,
    hint: "0 disables in-feed ads; 1 is treated as 2 (default 3).",
  },
  {
    key: "excerpt_paragraphs",
    label: "Excerpt paragraphs",
    min: 1,
    max: 10,
    hint: "Also used as the AI-summary fallback length (default 3).",
  },
];

const inputClass =
  "w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors";

/**
 * Grid template feed settings: topic pills, source-site include/exclude
 * lists, and the numeric/story-mode knobs that shape the feed. Clearing a
 * numeric input removes the key so the value inherits from group/org.
 * `pinned` is managed from the site's Stories tab and is preserved untouched
 * here.
 */
export function GridSettingsForm({ value, onChange, sites, verticals, bundles = [], categories = [] }: GridSettingsFormProps): React.ReactElement {
  const set = <K extends keyof GridFields>(key: K, v: GridFields[K] | undefined): void => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Topic pills</h4>
        <p className="text-xs text-[var(--text-muted)]">
          Each pill shows stories from Live network sites in the selected verticals and from the selected
          aggregator bundles.
        </p>
        <TopicsEditor value={value.topics ?? []} onChange={(t): void => set("topics", t)} verticals={verticals} bundles={bundles} />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Blocked categories</h4>
        <p className="text-xs text-[var(--text-muted)]">
          Aggregator stories in any of these categories never appear on this site. A main category also blocks its subcategories.
        </p>
        <ChipMultiSelect
          label="Blocked categories"
          addLabel="Add category"
          emptyText="Nothing blocked"
          value={value.blocked_categories ?? []}
          options={categoryOptions(categories)}
          onChange={(v): void => set("blocked_categories", v.length ? v : undefined)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <SiteMultiPicker
          label="Also include sites"
          value={value.include_sites ?? []}
          onChange={(v): void => set("include_sites", v)}
          options={sites}
        />
        <SiteMultiPicker
          label="Never include sites"
          value={value.exclude_sites ?? []}
          onChange={(v): void => set("exclude_sites", v)}
          options={sites}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Network stories
          </span>
          <select
            aria-label="Network stories"
            className={inputClass}
            value={value.story_mode ?? ""}
            onChange={(e): void =>
              set("story_mode", e.target.value ? (e.target.value as GridFields["story_mode"]) : undefined)
            }
          >
            <option value="">Inherit (default: excerpt)</option>
            <option value="excerpt">Excerpt of the source article</option>
            <option value="ai_summary">AI summary (editable)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Aggregator stories
          </span>
          <select
            aria-label="Aggregator stories"
            className={inputClass}
            value={value.external_story_mode ?? ""}
            onChange={(e): void =>
              set(
                "external_story_mode",
                e.target.value ? (e.target.value as GridFields["external_story_mode"]) : undefined,
              )
            }
          >
            <option value="">Inherit (default: What It Covers)</option>
            <option value="what_it_covers">What It Covers (from the aggregator)</option>
            <option value="ai_summary">AI summary (editable)</option>
          </select>
        </label>

        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {f.label}
            </span>
            <input
              aria-label={f.label}
              type="number"
              min={f.min}
              max={f.max}
              className={inputClass}
              value={value[f.key] ?? ""}
              onChange={(e): void => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
            />
            <span className="text-xs text-[var(--text-muted)]">{f.hint}</span>
          </label>
        ))}

        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={value.show_intro === true}
            onChange={(e): void => set("show_intro", e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-primary)] text-cyan focus:ring-cyan/50"
          />
          Show description under card headlines
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={value.outbound_utm !== false}
            onChange={(e): void => set("outbound_utm", e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-primary)] text-cyan focus:ring-cyan/50"
          />
          Add UTM tags to &quot;Read full story&quot; links
        </label>
      </section>
    </div>
  );
}
