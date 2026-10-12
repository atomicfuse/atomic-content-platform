import type { AuthorPortrait } from "@/lib/authors/types";

const SIZES = { sm: "w-10 h-10 text-sm", md: "w-14 h-14 text-base", lg: "w-40 h-40 text-4xl" } as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export function portraitSrc(path: string): string {
  return `/api/authors/portrait?path=${encodeURIComponent(path)}`;
}

/** Portrait (rounded-2xl) or initials on the accent tint. Decorative — the name is always shown beside it. */
export function AuthorAvatar({ name, portrait, size = "md" }: { name: string; portrait: AuthorPortrait | null; size?: keyof typeof SIZES }): React.ReactElement {
  return portrait ? (
    <img src={portraitSrc(portrait.path)} alt="" className={`${SIZES[size]} rounded-2xl object-cover bg-[var(--bg-elevated)] shrink-0`} />
  ) : (
    <span aria-hidden="true" className={`${SIZES[size]} rounded-2xl bg-cyan/10 text-cyan font-semibold flex items-center justify-center shrink-0`}>
      {initialsOf(name)}
    </span>
  );
}
