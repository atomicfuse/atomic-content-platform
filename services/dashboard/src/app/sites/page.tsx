import { readDashboardIndex } from "@/lib/github";
import { SitesTable } from "@/components/dashboard/SitesTable";

export const dynamic = "force-dynamic";

export default async function SitesPage(): Promise<React.ReactElement> {
  const index = await readDashboardIndex();
  // Excludes zone-only entries from syncDomainsFromCloudflare. Wizard-created
  // sites have null pages_project post-migration, so we gate on staging_branch
  // (which the wizard always sets) and keep pages_project as a backward-compat
  // fallback for legacy entries.
  const sites = index.sites.filter(
    (s) => s.staging_branch !== null || s.pages_project !== null,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
      </div>
      <SitesTable sites={sites} />
    </div>
  );
}
