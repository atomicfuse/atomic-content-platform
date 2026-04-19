import { fetchDomains } from "@/actions/domains";
import { DomainsTable } from "@/components/dashboard/DomainsTable";
import { SyncDomainsButton } from "@/components/dashboard/SyncDomainsButton";

export const dynamic = "force-dynamic";

export default async function SettingsDomainsPage(): Promise<React.ReactElement> {
  const domains = await fetchDomains();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Domains</h2>
        <div className="flex items-center gap-3">
          <SyncDomainsButton />
        </div>
      </div>
      <DomainsTable initialDomains={domains} />
    </div>
  );
}
