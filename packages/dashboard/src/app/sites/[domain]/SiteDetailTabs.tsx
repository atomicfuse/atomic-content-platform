"use client";

import { Tabs } from "@/components/ui/Tabs";

interface SiteDetailTabsProps {
  stagingTab: React.ReactNode | null;
  contentTab: React.ReactNode;
  agentTab: React.ReactNode;
  monetizationTab: React.ReactNode;
}

export function SiteDetailTabs({
  stagingTab,
  contentTab,
  agentTab,
  monetizationTab,
}: SiteDetailTabsProps): React.ReactElement {
  const tabItems = [];
  if (stagingTab) {
    tabItems.push({ id: "staging", label: "Staging", content: stagingTab });
  }
  tabItems.push(
    { id: "content", label: "Content", content: contentTab },
    { id: "agent", label: "Content Agent", content: agentTab },
    { id: "monetization", label: "Monetization", content: monetizationTab },
  );
  return <Tabs tabs={tabItems} />;
}
