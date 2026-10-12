import { listAuthors } from "@/lib/authors/store";
import { withSites } from "@/lib/authors/with-sites";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { AuthorsPageClient } from "@/components/authors/AuthorsPageClient";

export const dynamic = "force-dynamic";

export default async function AuthorsPage(): Promise<React.ReactElement> {
  const [authors, index] = await Promise.all([listAuthors().then(withSites), getDashboardIndex()]);
  return <AuthorsPageClient authors={authors} sites={index.sites.map((s) => ({ domain: s.domain }))} />;
}
