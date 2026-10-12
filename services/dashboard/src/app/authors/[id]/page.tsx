import { notFound } from "next/navigation";
import { listAuthors, readAuthor } from "@/lib/authors/store";
import { withSites } from "@/lib/authors/with-sites";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { AuthorProfileEditor } from "@/components/authors/AuthorProfileEditor";

export const dynamic = "force-dynamic";

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  const author = await readAuthor(id);
  if (!author) notFound();
  const [[withConnected], all, index] = await Promise.all([withSites([author]), listAuthors(), getDashboardIndex()]);
  return <AuthorProfileEditor author={withConnected!} mode="edit" sites={index.sites.map((s) => ({ domain: s.domain, vertical: s.vertical || undefined }))} takenNames={all.map((a) => a.name)} takenIds={all.map((a) => a.id)} />;
}
