"use client";

import type { AdPlacement } from "./AdPlacementsEditor";

interface PlacementPreviewProps {
  placements: AdPlacement[];
  /** When true, the sticky-bottom and sidebar slots are rendered as overlays. */
  showOverlays?: boolean;
}

const PARAGRAPH_LINES: string[] = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue.",
  "Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus.",
  "Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum.",
  "Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus.",
  "Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante. Etiam sit amet orci eget eros faucibus tincidunt.",
  "Duis leo. Sed fringilla mauris sit amet nibh. Donec sodales sagittis magna. Sed consequat, leo eget bibendum sodales.",
  "Augue velit cursus nunc, quis gravida magna mi a libero. Fusce vulputate eleifend sapien. Vestibulum purus quam.",
  "Sed augue ipsum, egestas nec, vestibulum et, malesuada adipiscing, dui. Vestibulum facilisis, purus nec pulvinar.",
];

const PARAGRAPH_COUNT = PARAGRAPH_LINES.length;

interface AdSlotRowProps {
  placements: AdPlacement[];
}

function AdSlotRow({ placements }: AdSlotRowProps): React.ReactElement {
  return (
    <div className="space-y-1.5">
      {placements.map((p, i) => (
        <div
          key={`${p.id}-${i}`}
          className="rounded-md border border-dashed border-cyan/50 bg-cyan/10 px-3 py-3 text-center"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan">
            Ad slot · {p.position}
          </div>
          <div className="mt-1 text-xs font-medium text-[var(--text-primary)]">
            {p.id}
          </div>
          {p.sizes.length > 0 && (
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              {p.sizes.join(" · ")} · {p.device}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function PlacementPreview({
  placements,
  showOverlays = true,
}: PlacementPreviewProps): React.ReactElement {
  // Bucket placements by position so we can render them in the right spots.
  const at = (position: string): AdPlacement[] =>
    placements.filter((p) => p.position === position);

  const aboveContent = at("above-content");
  const belowContent = at("below-content");
  const sidebar = at("sidebar");
  const stickyBottom = at("sticky-bottom");

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
        Live preview
      </div>

      <div className="relative grid grid-cols-3 gap-4">
        {/* Article body */}
        <div className="col-span-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 space-y-3">
          {/* Header */}
          <div className="space-y-2 pb-3 border-b border-[var(--border-secondary)]">
            <div className="h-4 w-3/4 rounded bg-[var(--text-primary)]/20" />
            <div className="h-2 w-1/2 rounded bg-[var(--text-muted)]/30" />
          </div>

          {aboveContent.length > 0 && <AdSlotRow placements={aboveContent} />}

          {Array.from({ length: PARAGRAPH_COUNT }).map((_, i) => {
            const paragraphIndex = i + 1;
            const afterSlot = at(`after-paragraph-${paragraphIndex}`);
            return (
              <div key={i} className="space-y-2">
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] mr-1">
                    p{paragraphIndex}.
                  </span>
                  {PARAGRAPH_LINES[i]}
                </p>
                {afterSlot.length > 0 && <AdSlotRow placements={afterSlot} />}
              </div>
            );
          })}

          {belowContent.length > 0 && <AdSlotRow placements={belowContent} />}
        </div>

        {/* Sidebar */}
        <aside className="col-span-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Sidebar
          </div>
          <div className="h-2 w-3/4 rounded bg-[var(--text-muted)]/20" />
          <div className="h-2 w-2/3 rounded bg-[var(--text-muted)]/20" />

          {sidebar.length > 0 && <AdSlotRow placements={sidebar} />}

          <div className="h-2 w-full rounded bg-[var(--text-muted)]/20" />
          <div className="h-2 w-1/2 rounded bg-[var(--text-muted)]/20" />
        </aside>
      </div>

      {showOverlays && stickyBottom.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-500 font-semibold mb-2">
            Sticky bottom (always visible at runtime)
          </div>
          <AdSlotRow placements={stickyBottom} />
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
