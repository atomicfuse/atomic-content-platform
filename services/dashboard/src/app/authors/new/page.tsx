import { listAuthors } from "@/lib/authors/store";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";
import { AuthorProfileEditor } from "@/components/authors/AuthorProfileEditor";
import type { GenerateContext } from "@/lib/authors/generate-flow";

export const dynamic = "force-dynamic";

export default async function NewAuthorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<React.ReactElement> {
  const sp = await searchParams;
  const [all, index] = await Promise.all([listAuthors(), getDashboardIndex()]);
  const context: GenerateContext = {};
  if (sp.beat) context.beatHint = sp.beat;
  const entry = sp.site ? index.sites.find((s) => s.domain === sp.site) : undefined;
  if (entry) {
    const cfg = await getSiteConfig(entry.domain, entry.staging_branch ?? undefined).catch(() => null);
    const brief = (cfg?.brief ?? {}) as Record<string, unknown>;
    Object.assign(context, {
      site: entry.domain,
      siteName: typeof cfg?.site_name === "string" ? cfg.site_name : entry.domain,
      category: entry.vertical ?? undefined,
      topics: Array.isArray(brief.topics) ? (brief.topics as unknown[]).filter((t): t is string => typeof t === "string") : undefined,
      tone: typeof brief.tone === "string" ? brief.tone : undefined,
    });
  }
  return (
    <AuthorProfileEditor
      author={null}
      mode="create"
      sites={index.sites.map((s) => ({ domain: s.domain }))}
      takenNames={all.map((a) => a.name)}
      autoGenerate={sp.generate === "1"}
      context={context}
    />
  );
}
