"use client";

import { Tabs } from "@/components/ui/Tabs";

interface SiteDetailTabsProps {
  domain: string;
  stagingTab: React.ReactNode | null;
  contentTab: React.ReactNode;
  identityTab: React.ReactNode;
}

export function SiteDetailTabs({
  stagingTab,
  contentTab,
  identityTab,
}: SiteDetailTabsProps): React.ReactElement {
  const tabItems = [
    { id: "site-settings", label: "Site Settings", content: identityTab },
  ];
  if (stagingTab) {
    tabItems.push({ id: "deployments", label: "Deployments", content: stagingTab });
  }
  tabItems.push(
    { id: "content", label: "Content", content: contentTab },
  );
  return <Tabs tabs={tabItems} />;
}
