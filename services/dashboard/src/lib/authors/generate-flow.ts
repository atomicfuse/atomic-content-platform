import type { AuthorInput, AuthorPart, AuthorRecord, PortraitStyle } from "./types";

/**
 * Browser-side order of profile generation. Each part is its own request (CloudGrid cuts requests at ~60 s), and
 * every result feeds the next part (a bio is written for the generated name and beats). Nothing is saved here.
 */
export const ALL_PARTS: AuthorPart[] = ["name", "tagline", "bio", "beats", "portrait"];

export interface GenerateContext {
  site?: string;
  siteName?: string;
  category?: string;
  topics?: string[];
  tone?: string;
  beatHint?: string;
}

export type PartStatus = "pending" | "running" | "done" | "error";

export async function generatePart(
  part: AuthorPart,
  draft: Partial<AuthorInput>,
  opts: { authorId?: string; context?: GenerateContext; takenNames: string[]; portraitStyle?: PortraitStyle },
  fetchFn: typeof fetch = fetch,
): Promise<Partial<AuthorInput>> {
  const res = await fetchFn("/api/authors/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      part,
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
      ...(part === "portrait" && opts.portraitStyle ? { portraitStyle: opts.portraitStyle } : {}),
      draft: { name: draft.name, tagline: draft.tagline, bio: draft.bio, beats: draft.beats },
      siteContext: opts.context ?? {},
      takenNames: opts.takenNames,
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { status?: string; value?: unknown; message?: string };
  if (!res.ok || out.status !== "ok") throw new Error(out.message ?? `Generation failed (${res.status})`);
  return { [part]: out.value } as Partial<AuthorInput>;
}

export async function runParts(
  parts: AuthorPart[],
  draft: Partial<AuthorInput>,
  opts: {
    authorIdFor(draft: Partial<AuthorInput>): string;
    context?: GenerateContext;
    takenNames: string[];
    portraitStyle?: PortraitStyle;
    /** Each part's result as soon as it lands, so the caller can apply just that field. */
    onPatch?: (patch: Partial<AuthorInput>) => void;
  },
  onStatus: (part: AuthorPart, status: PartStatus, error?: string) => void,
  fetchFn: typeof fetch = fetch,
): Promise<Partial<AuthorInput>> {
  let current = { ...draft };
  parts.forEach((p) => onStatus(p, "pending"));
  for (const part of parts) {
    onStatus(part, "running");
    try {
      const patch = await generatePart(part, current, { authorId: part === "portrait" ? opts.authorIdFor(current) : undefined, context: opts.context, takenNames: opts.takenNames, portraitStyle: opts.portraitStyle }, fetchFn);
      current = { ...current, ...patch };
      opts.onPatch?.(patch);
      onStatus(part, "done");
    } catch (err) {
      onStatus(part, "error", err instanceof Error ? err.message : String(err));
    }
  }
  return current;
}

export function missingParts(a: Pick<AuthorRecord, "tagline" | "bio" | "beats" | "portrait">): AuthorPart[] {
  const parts: AuthorPart[] = [];
  if (!a.bio.trim()) {
    if (!a.tagline.trim()) parts.push("tagline");
    parts.push("bio");
    if (a.beats.length === 0) parts.push("beats");
  }
  if (!a.portrait) parts.push("portrait");
  return parts;
}
