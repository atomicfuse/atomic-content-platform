"use client";

import { useCallback } from "react";
import { SizeConfigPanel } from "./SizeConfigPanel";
import type { AdSizeConfig } from "./ad-size-config";
import {
  createDefaultSizeConfig,
  configToSizeTuples,
  sizeTuplesToConfig,
} from "./ad-size-config";
/** Ad placement — mirrors @atomic-platform/shared-types */
interface AdPlacementSizes {
  desktop?: number[][];
  mobile?: number[][];
}

export interface AdPlacement {
  id: string;
  position: string;
  sizes: AdPlacementSizes;
  device: "all" | "desktop" | "mobile";
  /** Whether visitors can dismiss this ad. Only meaningful for sticky-bottom. Default: true. */
  dismissible?: boolean;
  /** Structured desktop size config for the editor UI. */
  desktopSizeConfig?: AdSizeConfig;
  /** Structured mobile size config for the editor UI. */
  mobileSizeConfig?: AdSizeConfig;
}

export { validatePlacementConfigs } from "./ad-size-config";

export interface AdsConfigFormValue {
  interstitial: boolean;
  layout: string;
  ad_placements: AdPlacement[];
}

interface AdsConfigFormProps {
  value: AdsConfigFormValue;
  onChange: (value: AdsConfigFormValue) => void;
}

const LAYOUT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "high-density", label: "High Density" },
];

const DEVICE_OPTIONS: Array<{ value: AdPlacement["device"]; label: string }> = [
  { value: "all", label: "All Devices" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

const POSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "above-content", label: "Above Content" },
  { value: "after-paragraph-1", label: "After Paragraph 1" },
  { value: "after-paragraph-2", label: "After Paragraph 2" },
  { value: "after-paragraph-3", label: "After Paragraph 3" },
  { value: "after-paragraph-4", label: "After Paragraph 4" },
  { value: "after-paragraph-5", label: "After Paragraph 5" },
  { value: "after-paragraph-6", label: "After Paragraph 6" },
  { value: "after-paragraph-7", label: "After Paragraph 7" },
  { value: "after-paragraph-8", label: "After Paragraph 8" },
  { value: "below-content", label: "Below Content" },
  { value: "sidebar", label: "Sidebar" },
  { value: "sticky-bottom", label: "Sticky Bottom" },
  { value: "homepage-top", label: "Homepage Top" },
  { value: "homepage-mid", label: "Homepage Mid" },
  { value: "category-top", label: "Category Top" },
];

export function AdsConfigForm({ value, onChange }: AdsConfigFormProps): React.ReactElement {
  const updateField = useCallback(
    <K extends keyof AdsConfigFormValue>(key: K, fieldValue: AdsConfigFormValue[K]): void => {
      onChange({ ...value, [key]: fieldValue });
    },
    [value, onChange],
  );

  const updatePlacement = useCallback(
    (index: number, patch: Partial<AdPlacement>): void => {
      const updated = value.ad_placements.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      );
      onChange({ ...value, ad_placements: updated });
    },
    [value, onChange],
  );

  const addPlacement = useCallback((): void => {
    const newPlacement: AdPlacement = {
      id: "",
      position: "above-content",
      device: "all",
      sizes: {},
      desktopSizeConfig: createDefaultSizeConfig(),
      mobileSizeConfig: createDefaultSizeConfig(),
    };
    onChange({ ...value, ad_placements: [...value.ad_placements, newPlacement] });
  }, [value, onChange]);

  const removePlacement = useCallback(
    (index: number): void => {
      onChange({
        ...value,
        ad_placements: value.ad_placements.filter((_, i) => i !== index),
      });
    },
    [value, onChange],
  );

  const movePlacement = useCallback(
    (index: number, direction: -1 | 1): void => {
      const target = index + direction;
      if (target < 0 || target >= value.ad_placements.length) return;
      const updated = [...value.ad_placements];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...value, ad_placements: updated });
    },
    [value, onChange],
  );

  return (
    <div className="space-y-6">
      {/* Toggle fields */}
      <div className="grid grid-cols-2 gap-4">
        <ToggleField
          label="Interstitial Ads"
          checked={value.interstitial}
          onChange={(checked): void => {
            updateField("interstitial", checked);
          }}
        />
      </div>

      {/* Layout dropdown */}
      <div className="space-y-1.5">
        <label
          htmlFor="ads-layout"
          className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
        >
          Ad Layout
        </label>
        <select
          id="ads-layout"
          value={value.layout}
          onChange={(e): void => {
            updateField("layout", e.target.value as AdsConfigFormValue["layout"]);
          }}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
        >
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Ad Placements */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Ad Placements
          </h4>
          <button
            type="button"
            onClick={addPlacement}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            + Add Placement
          </button>
        </div>

        {value.ad_placements.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">No ad placements configured.</p>
        )}

        {value.ad_placements.map((placement, index) => (
          <div
            key={index}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Placement #{index + 1}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(): void => movePlacement(index, -1)}
                  disabled={index === 0}
                  className="rounded-lg px-1.5 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  &#x25B2;
                </button>
                <button
                  type="button"
                  onClick={(): void => movePlacement(index, 1)}
                  disabled={index === value.ad_placements.length - 1}
                  className="rounded-lg px-1.5 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  &#x25BC;
                </button>
                <button
                  type="button"
                  onClick={(): void => {
                    removePlacement(index);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  aria-label="Remove placement"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  ID
                </label>
                <input
                  type="text"
                  value={placement.id}
                  placeholder="ad-slot-id"
                  onChange={(e): void => {
                    updatePlacement(index, { id: e.target.value });
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Position
                </label>
                <select
                  value={placement.position}
                  onChange={(e): void => {
                    updatePlacement(index, { position: e.target.value });
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
                >
                  {POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Device
                </label>
                <select
                  value={placement.device}
                  onChange={(e): void => {
                    updatePlacement(index, {
                      device: e.target.value as AdPlacement["device"],
                    });
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
                >
                  {DEVICE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Size Config Panels */}
            <div className="grid grid-cols-2 gap-3">
              <SizeConfigPanel
                label="Desktop Sizes"
                config={
                  placement.desktopSizeConfig ??
                  sizeTuplesToConfig(placement.sizes.desktop)
                }
                onChange={(cfg): void => {
                  const tuples = configToSizeTuples(cfg);
                  updatePlacement(index, {
                    desktopSizeConfig: cfg,
                    sizes: {
                      ...placement.sizes,
                      desktop: tuples.length > 0 ? tuples : undefined,
                    },
                  });
                }}
                disabled={placement.device === "mobile"}
              />
              <SizeConfigPanel
                label="Mobile Sizes"
                config={
                  placement.mobileSizeConfig ??
                  sizeTuplesToConfig(placement.sizes.mobile)
                }
                onChange={(cfg): void => {
                  const tuples = configToSizeTuples(cfg);
                  updatePlacement(index, {
                    mobileSizeConfig: cfg,
                    sizes: {
                      ...placement.sizes,
                      mobile: tuples.length > 0 ? tuples : undefined,
                    },
                  });
                }}
                disabled={placement.device === "desktop"}
              />
            </div>

            {/* Dismissible toggle — sticky-bottom only */}
            {placement.position === "sticky-bottom" && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={placement.dismissible !== false}
                  onChange={(e): void => {
                    updatePlacement(index, { dismissible: e.target.checked });
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border-primary)] text-cyan accent-cyan"
                />
                <div>
                  <span className="text-sm text-[var(--text-primary)]">
                    Allow visitors to dismiss this ad (&times;)
                  </span>
                  <p className="text-xs text-[var(--text-muted)]">
                    If unchecked, the sticky ad stays until the user leaves the page.
                  </p>
                </div>
              </label>
            )}
          </div>
        ))}
      </div>

      {/* Placement Preview */}
      <PlacementPreview placements={value.ad_placements} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Placement Preview                                                   */
/* ------------------------------------------------------------------ */

const PREVIEW_PARAGRAPHS: string[] = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue.",
  "Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus.",
  "Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum.",
  "Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus.",
  "Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante. Etiam sit amet orci eget eros faucibus tincidunt.",
  "Duis leo. Sed fringilla mauris sit amet nibh. Donec sodales sagittis magna. Sed consequat, leo eget bibendum sodales.",
  "Augue velit cursus nunc, quis gravida magna mi a libero. Fusce vulputate eleifend sapien. Vestibulum purus quam.",
  "Sed augue ipsum, egestas nec, vestibulum et, malesuada adipiscing, dui. Vestibulum facilisis, purus nec pulvinar.",
];

function formatPlacementSizes(sizes: AdPlacementSizes): string {
  const parts: string[] = [];
  if (sizes.desktop?.length) parts.push(sizes.desktop.map((s) => `${s[0]}x${s[1]}`).join(", "));
  if (sizes.mobile?.length) {
    const mobileStr = sizes.mobile.map((s) => `${s[0]}x${s[1]}`).join(", ");
    if (parts.length > 0) parts.push(`mob: ${mobileStr}`);
    else parts.push(mobileStr);
  }
  return parts.join(" · ");
}

function PreviewSlot({ placements }: { placements: AdPlacement[] }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      {placements.map((p, i) => (
        <div
          key={`${p.id}-${i}`}
          className="rounded-md border border-dashed border-cyan/50 bg-cyan/10 px-3 py-3 text-center"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan">
            Ad slot &middot; {p.position}
          </div>
          <div className="mt-1 text-xs font-medium text-[var(--text-primary)]">
            {p.id || "(no id)"}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            {formatPlacementSizes(p.sizes) || "no sizes"} &middot; {p.device}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlacementPreview({ placements }: { placements: AdPlacement[] }): React.ReactElement {
  const at = (position: string): AdPlacement[] =>
    placements.filter((p) => p.position === position);

  const aboveContent = at("above-content");
  const belowContent = at("below-content");
  const sidebar = at("sidebar");
  const stickyBottom = at("sticky-bottom");
  const homepageTop = at("homepage-top");
  const homepageMid = at("homepage-mid");
  const categoryTop = at("category-top");

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
        Placement Preview
      </div>

      <div className="relative grid grid-cols-3 gap-4">
        {/* Article body */}
        <div className="col-span-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 space-y-3">
          {/* Header skeleton */}
          <div className="space-y-2 pb-3 border-b border-[var(--border-secondary)]">
            <div className="h-4 w-3/4 rounded bg-[var(--text-primary)]/20" />
            <div className="h-2 w-1/2 rounded bg-[var(--text-muted)]/30" />
          </div>

          {aboveContent.length > 0 && <PreviewSlot placements={aboveContent} />}

          {PREVIEW_PARAGRAPHS.map((text, i) => {
            const pNum = i + 1;
            const afterSlot = at(`after-paragraph-${pNum}`);
            return (
              <div key={i} className="space-y-2">
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] mr-1">
                    p{pNum}.
                  </span>
                  {text}
                </p>
                {afterSlot.length > 0 && <PreviewSlot placements={afterSlot} />}
              </div>
            );
          })}

          {belowContent.length > 0 && <PreviewSlot placements={belowContent} />}
        </div>

        {/* Sidebar */}
        <aside className="col-span-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Sidebar
          </div>
          <div className="h-2 w-3/4 rounded bg-[var(--text-muted)]/20" />
          <div className="h-2 w-2/3 rounded bg-[var(--text-muted)]/20" />
          {sidebar.length > 0 && <PreviewSlot placements={sidebar} />}
          <div className="h-2 w-full rounded bg-[var(--text-muted)]/20" />
          <div className="h-2 w-1/2 rounded bg-[var(--text-muted)]/20" />
        </aside>
      </div>

      {/* Sticky bottom */}
      {stickyBottom.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-500 font-semibold mb-2">
            Sticky bottom (always visible at runtime)
          </div>
          {stickyBottom.map((p, i) => (
            <div
              key={`${p.id}-sticky-${i}`}
              className="relative rounded-md border border-dashed border-cyan/50 bg-cyan/10 px-3 py-3 text-center"
            >
              {p.dismissible !== false && (
                <span
                  className="absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded-full border border-[var(--text-muted)] text-[var(--text-muted)] text-[10px] leading-none"
                  title="Visitors can dismiss this ad"
                >
                  &times;
                </span>
              )}
              <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan">
                Ad slot &middot; {p.position}
              </div>
              <div className="mt-1 text-xs font-medium text-[var(--text-primary)]">
                {p.id || "(no id)"}
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                {formatPlacementSizes(p.sizes) || "no sizes"} &middot; {p.device}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Homepage / category positions */}
      {(homepageTop.length > 0 || homepageMid.length > 0 || categoryTop.length > 0) && (
        <div className="mt-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">
            Non-article page slots
          </div>
          {homepageTop.length > 0 && <PreviewSlot placements={homepageTop} />}
          {homepageMid.length > 0 && <PreviewSlot placements={homepageMid} />}
          {categoryTop.length > 0 && <PreviewSlot placements={categoryTop} />}
        </div>
      )}

      {placements.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-[var(--border-primary)] py-4 text-center text-xs text-[var(--text-muted)]">
          Add a placement to see it appear in the preview.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function ToggleField({
  label,
  checked,
  onChange: onToggle,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 cursor-pointer">
      <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(): void => {
          onToggle(!checked);
        }}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-cyan" : "bg-[var(--border-primary)]"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

