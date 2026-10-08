"use client";

import { useEffect, useRef, useState } from "react";

interface LogoThumbProps {
  src: string;
  alt: string;
  /** Thumbnail classes (size, radius, background) — the thumbnail looks exactly as before. */
  className: string;
  /** Colour the logo will sit on (header or footer). Omitted → a neutral checkerboard. */
  background?: string;
  /** What `background` is, for the caption ("header", "footer"). */
  backgroundLabel?: string;
  onError?: React.ReactEventHandler<HTMLImageElement>;
}

const CHECKERBOARD =
  "repeating-conic-gradient(var(--bg-elevated) 0% 25%, var(--bg-surface) 0% 50%) 50% / 16px 16px";

/**
 * Logo thumbnail that shows a large preview on hover, keyboard focus or tap — on the colour the logo will
 * actually sit on, so contrast problems are visible before saving.
 */
export function LogoThumb({ src, alt, className, background, backgroundLabel, onError }: LogoThumbProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function show(): void {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function hideSoon(): void {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <span className="relative inline-flex shrink-0" onMouseEnter={show} onMouseLeave={hideSoon}>
      <button
        type="button"
        aria-label={`Enlarge ${alt}`}
        aria-expanded={open}
        onClick={(): void => setOpen((o) => !o)}
        onFocus={show}
        onBlur={hideSoon}
        className="cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
      >
        <img src={src} alt={alt} className={className} onError={onError} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${alt}, enlarged`}
          className="absolute left-0 top-full z-40 mt-2 w-[min(420px,80vw)] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-2 shadow-xl"
        >
          <div
            data-stage
            className="flex h-44 items-center justify-center rounded-lg px-6"
            style={background ? { backgroundColor: background } : { background: CHECKERBOARD }}
          >
            <img src={src} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <p className="px-1 pt-2 text-[11px] text-[var(--text-muted)]">
            {background ? `On ${backgroundLabel ?? "background"} ${background}` : "Transparent background"}
          </p>
        </div>
      )}
    </span>
  );
}
