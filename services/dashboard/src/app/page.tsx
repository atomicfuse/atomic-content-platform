import { readDashboardIndex, fetchRecentActivity, countArticlesThisWeek, countFailedBuilds } from "@/lib/github";
import { StatsPanel } from "@/components/layout/StatsPanel";
import { ActivityFeed } from "@/components/layout/ActivityFeed";
import { SitesTable } from "@/components/dashboard/SitesTable";
import type { DashboardStats } from "@/types/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const [index, activity, articlesThisWeek, failedBuilds] = await Promise.all([
    readDashboardIndex(),
    fetchRecentActivity(10),
    countArticlesThisWeek(),
    countFailedBuilds(),
  ]);

  // Excludes zone-only entries from syncDomainsFromCloudflare. Wizard-created
  // sites have null pages_project post-migration, so we gate on staging_branch
  // (which the wizard always sets) and keep pages_project as a backward-compat
  // fallback for legacy entries.
  const sites = index.sites.filter(
    (s) => s.staging_branch !== null || s.pages_project !== null,
  );
  const pendingReview = sites.filter((s) => s.status === "Preview").length;

  const stats: DashboardStats = {
    totalSites: sites.length,
    articlesThisWeek,
    pendingReview,
    failedBuilds,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      {/* Stats */}
      <StatsPanel stats={stats} />

      {/* Main content: table + activity feed */}
      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div>
          <SitesTable sites={sites} />
        </div>
        <ActivityFeed events={activity} />
      </div>
    </div>
  );
}
