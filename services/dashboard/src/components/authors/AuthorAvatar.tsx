"use client";

import type { AuthorPortrait } from "@/lib/authors/types";
import { useHoverPreview } from "@/components/ui/useHoverPreview";

const SIZES = { sm: "w-10 h-10 text-sm", md: "w-14 h-14 text-base", lg: "w-40 h-40 text-4xl" } as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export function portraitSrc(path: string): string {
  return `/api/authors/portrait?path=${encodeURIComponent(path)}`;
}

interface AuthorAvatarProps {
  name: string;
  portrait: AuthorPortrait | null;
  size?: keyof typeof SIZES;
  /**
   * Large preview of the portrait. "button": hover, focus or tap (profile editor). "hover": mouse hover only, for
   * avatars inside a link (library cards), where a nested button isn't allowed and a click opens the profile.
   */
  preview?: "button" | "hover";
}

/** Portrait (rounded-2xl) or initials on the accent tint. Decorative — the name is always shown beside it. */
export function AuthorAvatar({ name, portrait, size = "md", preview }: AuthorAvatarProps): React.ReactElement {
  if (!portrait) {
    return (
      <span aria-hidden="true" className={`${SIZES[size]} rounded-2xl bg-cyan/10 text-cyan font-semibold flex items-center justify-center shrink-0`}>
        {initialsOf(name)}
      </span>
    );
  }
  const img = <img src={portraitSrc(portrait.path)} alt="" className={`${SIZES[size]} rounded-2xl object-cover bg-[var(--bg-elevated)] shrink-0`} />;
  return preview ? <PreviewableAvatar name={name} portrait={portrait} mode={preview} centred={size === "lg"}>{img}</PreviewableAvatar> : img;
}

function PreviewableAvatar({ name, portrait, mode, centred, children }: {
  name: string; portrait: AuthorPortrait; mode: "button" | "hover"; centred: boolean; children: React.ReactNode;
}): React.ReactElement {
  const { open, show, hideSoon, toggle } = useHoverPreview();
  const placement = centred ? "left-1/2 -translate-x-1/2" : "left-0";
  return (
    <span className="relative inline-flex shrink-0" data-preview-trigger onMouseEnter={show} onMouseLeave={hideSoon}>
      {mode === "button" ? (
        <button
          type="button"
          aria-label={`Enlarge portrait of ${name}`}
          aria-expanded={open}
          onClick={toggle}
          onFocus={show}
          onBlur={hideSoon}
          className="cursor-zoom-in rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
        >
          {children}
        </button>
      ) : children}
      {open && (
        <div
          role="dialog"
          aria-label={`Portrait of ${name}, enlarged`}
          className={`absolute top-full z-40 mt-2 w-[min(320px,80vw)] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-2 shadow-[0_16px_40px_-16px_rgb(6_182_212/0.35)] ${placement}`}
        >
          <img src={portraitSrc(portrait.path)} alt="" className="aspect-square w-full rounded-lg object-cover" />
          <p className="px-1 pt-2 text-[11px] text-[var(--text-muted)]">
            {name}{" "}<span className="text-[var(--text-muted)]/80">({portrait.kind === "uploaded" ? "uploaded photo" : "generated"})</span>
          </p>
        </div>
      )}
    </span>
  );
}
