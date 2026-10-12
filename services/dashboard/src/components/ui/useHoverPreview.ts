"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Open/close state for an image preview popover: opens on hover, focus or tap, closes shortly after the pointer or
 * focus leaves (so moving onto the popover doesn't flicker it shut) and on Escape.
 */
export function useHoverPreview(): { open: boolean; show: () => void; hideSoon: () => void; toggle: () => void } {
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
  function toggle(): void {
    setOpen((o) => !o);
  }

  return { open, show, hideSoon, toggle };
}
