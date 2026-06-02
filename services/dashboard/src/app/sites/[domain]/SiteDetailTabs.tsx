"use client";

import { useState, lazy, Suspense } from "react";
import type { ArticleEntry, SiteStatus } from "@/types/dashboard";

const ContentTab = lazy(() => import("@/components/site-detail/ContentTab").then((m) => ({ default: m.ContentTab })));
const ContentAgentTab = lazy(() => import("@/components/site-detail/ContentAgentTab").then((m) => ({ default: m.ContentAgentTab })));
const StagingTab = lazy(() => import("@/components/site-detail/StagingTab").then((m) => ({ default: m.StagingTab })));

const TabSkeleton = (): React.ReactElement => (
  <div className="animate-pulse space-y-4 pt-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-12 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)]" />
    ))}
  </div>
);

interface SiteDetailTabsProps {
  domain: string;
  stagingTabProps: {
    stagingBranch: string | null;
    previewUrl: string | null;
    savedPreviews: Array<{ url: string; label: string; saved_at: string }> | null;
    siteStatus: SiteStatus;
    customDomain: string | null;
    currentLogoPath: string | null;
    currentFaviconPath: string | null;
  } | null;
  contentTabProps: {
    articles: ArticleEntry[];
    stagingBranch: string | null;
    previewUrl: string;
  };
  identityTabProps: {
    brief: Record<string, unknown> | null;
    siteConfig: Record<string, unknown> | null;
    stagingBranch: string | null;
    pagesProject: string | null;
    pagesSubdomain: string | null;
    customDomain: string | null;
    currentLogoPath: string | null;
    currentFaviconPath: string | null;
    previewUrl: string | null;
  };
}

export function SiteDetailTabs({
  domain,
  stagingTabProps,
  contentTabProps,
  identityTabProps,
}: SiteDetailTabsProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState("site-settings");

  const tabs = [
    { id: "site-settings", label: "Site Settings" },
    ...(stagingTabProps ? [{ id: "deployments", label: "Deployments" }] : []),
    { id: "content", label: "Content" },
  ];

  function renderActiveTab(): React.ReactNode {
    switch (activeTab) {
      case "site-settings":
        return (
          <ContentAgentTab
            domain={domain}
            brief={identityTabProps.brief as never}
            siteConfig={identityTabProps.siteConfig}
            stagingBranch={identityTabProps.stagingBranch}
            pagesProject={identityTabProps.pagesProject}
            pagesSubdomain={identityTabProps.pagesSubdomain}
            customDomain={identityTabProps.customDomain}
            currentLogoPath={identityTabProps.currentLogoPath}
            currentFaviconPath={identityTabProps.currentFaviconPath}
            previewUrl={identityTabProps.previewUrl}
          />
        );
      case "deployments":
        return stagingTabProps ? (
          <StagingTab
            domain={domain}
            stagingBranch={stagingTabProps.stagingBranch}
            previewUrl={stagingTabProps.previewUrl}
            savedPreviews={stagingTabProps.savedPreviews}
            siteStatus={stagingTabProps.siteStatus}
            customDomain={stagingTabProps.customDomain}
            currentLogoPath={stagingTabProps.currentLogoPath}
            currentFaviconPath={stagingTabProps.currentFaviconPath}
          />
        ) : null;
      case "content":
        return (
          <ContentTab
            articles={contentTabProps.articles as never}
            domain={domain}
            stagingBranch={contentTabProps.stagingBranch}
            previewUrl={contentTabProps.previewUrl}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-[var(--border-secondary)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={(): void => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors relative ${
              activeTab === tab.id
                ? "text-cyan"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan rounded-full" />
            )}
          </button>
        ))}
      </div>
      <div className="pt-4">
        <Suspense fallback={<TabSkeleton />}>
          {renderActiveTab()}
        </Suspense>
      </div>
    </div>
  );
}
