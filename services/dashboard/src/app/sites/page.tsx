import { readDashboardIndex } from "@/lib/github";
import { SitesTable } from "@/components/dashboard/SitesTable";

export const dynamic = "force-dynamic";

export default async function SitesPage(): Promise<React.ReactElement> {
  const index = await readDashboardIndex();
  const sites = index.sites.filter((s) => s.pages_project !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
      </div>
      <SitesTable sites={sites} />
    </div>
  );
}
