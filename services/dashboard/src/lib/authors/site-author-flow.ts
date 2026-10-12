import { ALL_PARTS, runParts } from "./generate-flow";
import { authorIdFromName } from "./record";
import type { AuthorInput, AuthorPart } from "./types";

export interface SiteForAuthor {
  domain: string;
  siteName: string;
  vertical?: string;
  topics: string[];
  tone?: string;
  /** Who reads the site (brief audiences). */
  audience?: string;
}

/**
 * A complete new author written for this site, generated part by part in the browser (each part is its own short
 * request). Not exclusive: any site can add them later; exclusivity is a deliberate choice on the author's profile.
 * Not saved; null when no name could be generated.
 */
export async function generateSiteAuthor(
  site: SiteForAuthor,
  taken: { names: string[]; ids: string[] },
  verticalOptions: string[],
  onPart?: (part: AuthorPart) => void,
  fetchFn: typeof fetch = fetch,
): Promise<AuthorInput | null> {
  let draft: AuthorInput = { name: "", tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [] };
  await runParts(
    ALL_PARTS.filter((p) => p !== "verticals" || verticalOptions.length > 0),
    draft,
    {
      authorIdFor: (d) => authorIdFromName(d.name || "author", taken.ids),
      context: { site: site.domain, siteName: site.siteName, category: site.vertical, topics: site.topics, tone: site.tone, audience: site.audience },
      takenNames: taken.names,
      verticalOptions,
      portraitStyle: "realistic",
      onPatch: (patch) => { draft = { ...draft, ...patch }; },
    },
    (part, status) => { if (status === "running") onPart?.(part); },
    fetchFn,
  );
  return draft.name.trim() ? draft : null;
}
