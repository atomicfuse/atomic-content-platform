"use client";

import { LogoThumb } from "@/components/ui/LogoThumb";
import type { LogoStep } from "@/lib/logo-generation-flow";

interface GeneratedLogoSetProps {
  step: LogoStep;
  model: string | null;
  logo: string | null;
  footerLogo: string | null;
  favicon: string | null;
  /** Header and footer backgrounds invert and the footer variant is switched on. */
  footerExpected: boolean;
  headerBg?: string;
  footerBg?: string;
}

function statusText(step: LogoStep, footerExpected: boolean): string {
  switch (step) {
    case "logo":
      return "Step 1 of 2 · Creating the logo…";
    case "retry":
      return "Step 1 of 2 · The logo was faint on the header — trying once more…";
    case "extras":
      return `Step 2 of 2 · Making the favicon${footerExpected ? " and footer logo" : ""}…`;
    case "done":
      return "Done — save to apply";
  }
}

const SLOT_BOX = "w-16 h-16 rounded-lg border border-[var(--border-secondary)]";

function Slot({
  label, image, alt, background, backgroundLabel, state,
}: {
  label: string;
  image: string | null;
  alt: string;
  background?: string;
  backgroundLabel?: string;
  /** Shown when there is no image yet. */
  state: "making" | "not-needed" | "not-made";
}): React.ReactElement {
  return (
    <figure className="flex flex-col items-center gap-1.5 m-0">
      {image ? (
        <LogoThumb
          src={`data:image/png;base64,${image}`}
          alt={alt}
          background={background}
          backgroundLabel={backgroundLabel}
          className={`${SLOT_BOX} object-contain p-1`}
        />
      ) : state === "making" ? (
        <div className={`${SLOT_BOX} bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none`} aria-hidden="true" />
      ) : (
        <div className={`${SLOT_BOX} border-dashed`} aria-hidden="true" />
      )}
      <figcaption className="text-center leading-tight">
        <span className="block text-[11px] font-medium text-[var(--text-primary)]">{label}</span>
        <span className="block text-[10px] text-[var(--text-muted)]">
          {image ? "Ready" : state === "making" ? "Making…" : state === "not-needed" ? "Not needed" : "Not made"}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * The AI logo set while it's being made and after: step status plus the header logo, footer logo and
 * favicon side by side — each previewable on hover/focus/tap (on the colour it will sit on).
 */
export function GeneratedLogoSet({
  step, model, logo, footerLogo, favicon, footerExpected, headerBg, footerBg,
}: GeneratedLogoSetProps): React.ReactElement {
  const logoState = step === "logo" || step === "retry" ? "making" : "not-made";
  const extrasState = step === "done" ? "not-made" : "making";
  return (
    <div className="rounded-lg border border-cyan/20 bg-cyan/5 p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p role="status" aria-live="polite" className="text-xs font-medium text-[var(--text-primary)]">
          {statusText(step, footerExpected)}
        </p>
        {model && <span className="text-[10px] text-[var(--text-muted)]">by {model}</span>}
      </div>
      <div className="flex items-start gap-4">
        <Slot label="Header logo" image={logo} alt="Header logo" background={headerBg} backgroundLabel="header" state={logoState} />
        <Slot
          label="Footer logo"
          image={footerLogo}
          alt="Footer logo"
          background={footerBg}
          backgroundLabel="footer"
          state={footerExpected ? (step === "done" ? "not-made" : "making") : "not-needed"}
        />
        <Slot label="Favicon" image={favicon} alt="Favicon" state={extrasState} />
      </div>
    </div>
  );
}
