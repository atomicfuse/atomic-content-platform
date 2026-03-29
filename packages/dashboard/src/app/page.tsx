import { readDashboardIndex, fetchRecentActivity, countArticlesThisWeek, countFailedBuilds } from "@/lib/github";
import { StatsPanel } from "@/components/layout/StatsPanel";
import { ActivityFeed } from "@/components/layout/ActivityFeed";
import { SitesTable } from "@/components/dashboard/SitesTable";
import { SyncDomainsButton } from "@/components/dashboard/SyncDomainsButton";
import { AddDomainButton } from "@/components/dashboard/AddDomainButton";
import type { DashboardStats } from "@/types/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const [index, activity, articlesThisWeek, failedBuilds] = await Promise.all([
    readDashboardIndex(),
    fetchRecentActivity(10),
    countArticlesThisWeek(),
    countFailedBuilds(),
  ]);

  const pendingReview = index.sites.filter((s) => s.status === "Preview").length;

  const stats: DashboardStats = {
    totalSites: index.sites.length,
    articlesThisWeek,
    pendingReview,
    failedBuilds,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3">
          <AddDomainButton />
          <SyncDomainsButton />
        </div>
      </div>

      {/* Stats */}
      <StatsPanel stats={stats} />

      {/* Main content: table + activity feed */}
      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div>
          <SitesTable sites={index.sites} />
        </div>
        <ActivityFeed events={activity} />
      </div>
    </div>
  );
}
