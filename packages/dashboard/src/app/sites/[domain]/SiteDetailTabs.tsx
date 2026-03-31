"use client";

import { Tabs } from "@/components/ui/Tabs";

interface SiteDetailTabsProps {
  stagingTab: React.ReactNode | null;
  contentTab: React.ReactNode;
  agentTab: React.ReactNode;
  monetizationTab: React.ReactNode | null;
}

export function SiteDetailTabs({
  stagingTab,
  contentTab,
  agentTab,
  monetizationTab,
}: SiteDetailTabsProps): React.ReactElement {
  const tabItems = [];
  if (stagingTab) {
    tabItems.push({ id: "staging", label: "Staging & Preview", content: stagingTab });
  }
  tabItems.push(
    { id: "content", label: "Content", content: contentTab },
    { id: "agent", label: "Site Identity", content: agentTab },
  );
  if (monetizationTab) {
    tabItems.push({ id: "monetization", label: "Monetization", content: monetizationTab });
  }
  return <Tabs tabs={tabItems} />;
}
