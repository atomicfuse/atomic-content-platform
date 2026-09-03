"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
}

interface Coords {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

export function Tooltip({
  content,
  children,
  maxWidth = 320,
}: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback((): void => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const placement = rect.top < 200 ? "bottom" : "top";
    const left = rect.left + rect.width / 2;
    const top = placement === "top" ? rect.top - 8 : rect.bottom + 8;
    setCoords({ top, left, placement });
  }, []);

  const show = useCallback((): void => {
    reposition();
    setVisible(true);
  }, [reposition]);

  const hide = useCallback((): void => setVisible(false), []);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setVisible(false);
    }
    document.addEventListener("keydown", handleKey);
    return (): void => document.removeEventListener("keydown", handleKey);
  }, [visible]);

  // Clamp tooltip horizontally so it doesn't overflow the viewport
  useEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const r = el.getBoundingClientRect();
    if (r.left < 8) {
      el.style.transform = `translateX(${8 - r.left}px)`;
    } else if (r.right > window.innerWidth - 8) {
      el.style.transform = `translateX(${window.innerWidth - 8 - r.right}px)`;
    }
  }, [visible, coords]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && coords && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className="fixed z-[9999] px-3 py-2.5 text-sm text-left leading-relaxed rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-xl"
          style={{
            top: coords.placement === "top" ? undefined : coords.top,
            bottom: coords.placement === "top" ? `${window.innerHeight - coords.top}px` : undefined,
            left: coords.left,
            transform: "translateX(-50%)",
            maxWidth,
            width: "max-content",
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Small info icon that shows a tooltip on hover. */
export function InfoTooltip({
  content,
  maxWidth,
}: {
  content: React.ReactNode;
  maxWidth?: number;
}): React.ReactElement {
  return (
    <Tooltip content={content} maxWidth={maxWidth}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help transition-colors">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
      </span>
    </Tooltip>
  );
}
