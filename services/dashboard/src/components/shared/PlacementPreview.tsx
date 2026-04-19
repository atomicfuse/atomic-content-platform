"use client";

import type { AdPlacement } from "@/components/settings/AdsConfigForm";

interface PlacementPreviewProps {
  placements: AdPlacement[];
}

const LOREM_PARAGRAPHS = [
  "p1. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "p2. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "p3. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "p4. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "p5. Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra.",
  "p6. Sed cursus turpis vitae tortor. Donec posuere vulputate arcu. Phasellus accumsan cursus velit.",
  "p7. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Sed aliquam nisi quis porttitor congue.",
  "p8. Praesent vestibulum dapibus nibh. Etiam iaculis nunc ac metus. Ut id nisl quis enim dignissim sagittis.",
];

function formatSizeList(sizes?: number[][]): string {
  if (!sizes || sizes.length === 0) return "";
  return sizes.map((s) => `${s[0]}x${s[1]}`).join(", ");
}

function PlacementBox({ placement }: { placement: AdPlacement }): React.ReactElement {
  const desktopSizes = formatSizeList(placement.sizes.desktop);
  const mobileSizes = formatSizeList(placement.sizes.mobile);

  return (
    <div className="border-2 border-dashed border-cyan/60 rounded-lg bg-cyan/5 px-3 py-2 my-2 text-xs text-[var(--text-secondary)]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-cyan">
          {placement.position || "no-position"}
        </span>
        <span className="text-[var(--text-muted)]">
          {placement.device !== "all" ? placement.device : "all devices"}
        </span>
      </div>
      {placement.id && (
        <div className="text-[var(--text-muted)] font-mono mt-0.5">
          {placement.id}
        </div>
      )}
      {(desktopSizes || mobileSizes) && (
        <div className="mt-1 space-y-0.5">
          {desktopSizes && <div>Desktop: {desktopSizes}</div>}
          {mobileSizes && <div>Mobile: {mobileSizes}</div>}
        </div>
      )}
    </div>
  );
}

export function PlacementPreview({ placements }: PlacementPreviewProps): React.ReactElement {
  if (placements.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-muted)]">
        Add ad placements to see a live preview.
      </div>
    );
  }

  // Categorize placements
  const aboveContent = placements.filter((p) => p.position === "above-content");
  const belowContent = placements.filter((p) => p.position === "below-content");
  const sidebarPlacements = placements.filter((p) => p.position === "sidebar");
  const stickyBottom = placements.filter((p) => p.position === "sticky-bottom");
  const afterParagraph: Record<number, AdPlacement[]> = {};
  for (const p of placements) {
    const match = p.position.match(/^after-paragraph-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!afterParagraph[n]) afterParagraph[n] = [];
      afterParagraph[n].push(p);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Placement Preview
      </h4>

      <div className="grid grid-cols-3 gap-4">
        {/* Article body: 2 columns */}
        <div className="col-span-2 space-y-0">
          {/* Above content */}
          {aboveContent.map((p, i) => (
            <PlacementBox key={`above-${i}`} placement={p} />
          ))}

          {/* Paragraphs with after-paragraph slots */}
          {LOREM_PARAGRAPHS.map((text, idx) => {
            const paragraphNum = idx + 1;
            const slots = afterParagraph[paragraphNum] ?? [];
            return (
              <div key={idx}>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed py-1.5">
                  {text}
                </p>
                {slots.map((p, si) => (
                  <PlacementBox key={`after-p${paragraphNum}-${si}`} placement={p} />
                ))}
              </div>
            );
          })}

          {/* Below content */}
          {belowContent.map((p, i) => (
            <PlacementBox key={`below-${i}`} placement={p} />
          ))}
        </div>

        {/* Sidebar: 1 column */}
        <div className="col-span-1 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Sidebar
          </div>
          {sidebarPlacements.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic">No sidebar ads</p>
          ) : (
            sidebarPlacements.map((p, i) => (
              <PlacementBox key={`sidebar-${i}`} placement={p} />
            ))
          )}
        </div>
      </div>

      {/* Sticky bottom */}
      {stickyBottom.length > 0 && (
        <div className="border-t border-amber-500/30 pt-3 mt-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-2">
            Sticky Bottom
          </div>
          {stickyBottom.map((p, i) => (
            <div
              key={`sticky-${i}`}
              className="border-2 border-dashed border-amber-500/60 rounded-lg bg-amber-500/5 px-3 py-2 text-xs text-[var(--text-secondary)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-amber-500">sticky-bottom</span>
                <span className="text-[var(--text-muted)]">
                  {p.device !== "all" ? p.device : "all devices"}
                </span>
              </div>
              {p.id && (
                <div className="text-[var(--text-muted)] font-mono mt-0.5">{p.id}</div>
              )}
              {(formatSizeList(p.sizes.desktop) || formatSizeList(p.sizes.mobile)) && (
                <div className="mt-1 space-y-0.5">
                  {formatSizeList(p.sizes.desktop) && (
                    <div>Desktop: {formatSizeList(p.sizes.desktop)}</div>
                  )}
                  {formatSizeList(p.sizes.mobile) && (
                    <div>Mobile: {formatSizeList(p.sizes.mobile)}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
