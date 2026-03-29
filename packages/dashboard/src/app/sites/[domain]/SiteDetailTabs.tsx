"use client";

import { Tabs } from "@/components/ui/Tabs";

interface SiteDetailTabsProps {
  contentTab: React.ReactNode;
  agentTab: React.ReactNode;
  monetizationTab: React.ReactNode;
}

export function SiteDetailTabs({
  contentTab,
  agentTab,
  monetizationTab,
}: SiteDetailTabsProps): React.ReactElement {
  return (
    <Tabs
      tabs={[
        { id: "content", label: "Content", content: contentTab },
        { id: "agent", label: "Content Agent", content: agentTab },
        { id: "monetization", label: "Monetization", content: monetizationTab },
      ]}
    />
  );
}
