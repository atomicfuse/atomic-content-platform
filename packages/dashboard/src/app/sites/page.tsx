import { readDashboardIndex } from "@/lib/github";
import { SitesTable } from "@/components/dashboard/SitesTable";
import { SyncDomainsButton } from "@/components/dashboard/SyncDomainsButton";
import { AddDomainButton } from "@/components/dashboard/AddDomainButton";

export const dynamic = "force-dynamic";

export default async function SitesPage(): Promise<React.ReactElement> {
  const index = await readDashboardIndex();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
        <div className="flex items-center gap-3">
          <AddDomainButton />
          <SyncDomainsButton />
        </div>
      </div>
      <SitesTable sites={index.sites} />
    </div>
  );
}
