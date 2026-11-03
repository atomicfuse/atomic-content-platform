import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { listGridSiteCategories } from "@/lib/db/site-configs";
import { MULTI_CATEGORY } from "@/lib/grid-config";
import { SitesTable } from "@/components/dashboard/SitesTable";

export const dynamic = "force-dynamic";

export default async function SitesPage(): Promise<React.ReactElement> {
  const index = await readDashboardIndex();
  // Excludes zone-only entries from syncDomainsFromCloudflare. Wizard-created
  // sites have null pages_project post-migration, so we gate on staging_branch
  // (which the wizard always sets) and keep pages_project as a backward-compat
  // fallback for legacy entries.
  const listed = index.sites.filter(
    (s) => s.staging_branch !== null || s.pages_project !== null,
  );

  // Grid sites show as "Multi-category" with chips from their topic pills. A failed
  // read only drops the chips; the table still renders.
  const gridCategories = await listGridSiteCategories(
    listed
      .filter((s) => s.vertical === MULTI_CATEGORY)
      .map((s) => ({ domain: s.domain, branch: s.staging_branch ?? undefined })),
  ).catch((error: unknown): Record<string, string[]> => {
    console.warn("[sites] grid categories read failed:", error);
    return {};
  });
  // Display only: Grid sites created before "Multi-category" still carry a single
  // category in dashboard-index; label them the same so filters group them together.
  const sites = listed.map((s) => (s.domain in gridCategories ? { ...s, vertical: MULTI_CATEGORY } : s));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
      </div>
      <SitesTable sites={sites} gridCategories={gridCategories} />
    </div>
  );
}
