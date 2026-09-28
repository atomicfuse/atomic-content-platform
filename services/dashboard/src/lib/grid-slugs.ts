/**
 * Pill (topic) slugs exactly as the Grid worker derives them.
 * Mirror of site-worker normalize.ts (`slugifyTopic` + the duplicate-suffix logic in `normalizeTopics`)
 * — keep the two in sync, or the Sources preview will attribute sites to the wrong pill.
 */

/** Label → URL slug: lowercase, accents stripped, `&` → "and", non-alphanumerics → "-". */
export function slugifyTopic(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolves each topic's slug in order: label-less topics skipped, explicit slug slugified, duplicates get -2, -3… */
export function resolveTopicSlugs(topics: ReadonlyArray<{ label?: string; slug?: string }>): Array<{ label: string; slug: string }> {
  const used = new Set<string>();
  const out: Array<{ label: string; slug: string }> = [];
  for (const t of topics) {
    const label = typeof t.label === "string" ? t.label.trim() : "";
    if (!label) continue;
    const source = typeof t.slug === "string" && t.slug.trim() ? t.slug : label;
    const base = slugifyTopic(source) || "topic";
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    out.push({ label, slug });
  }
  return out;
}
