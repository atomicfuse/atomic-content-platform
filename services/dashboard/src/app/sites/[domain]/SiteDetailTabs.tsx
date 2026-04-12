"use client";

import { Tabs } from "@/components/ui/Tabs";
import { EmailRoutingPanel } from "@/components/site-detail/EmailRoutingPanel";

interface SiteDetailTabsProps {
  domain: string;
  stagingTab: React.ReactNode | null;
  contentTab: React.ReactNode;
  identityTab: React.ReactNode;
  agentTab: React.ReactNode;
  monetizationTab: React.ReactNode | null;
}

export function SiteDetailTabs({
  domain,
  stagingTab,
  contentTab,
  identityTab,
  agentTab,
  monetizationTab,
}: SiteDetailTabsProps): React.ReactElement {
  const tabItems = [];
  if (stagingTab) {
    tabItems.push({ id: "staging", label: "Staging & Preview", content: stagingTab });
  }
  tabItems.push(
    { id: "content", label: "Content", content: contentTab },
    { id: "identity", label: "Site Identity", content: identityTab },
    { id: "agent", label: "Content Agent", content: agentTab },
  );
  if (monetizationTab) {
    tabItems.push({ id: "monetization", label: "Monetization", content: monetizationTab });
  }
  tabItems.push({
    id: "email",
    label: "Email",
    content: <EmailRoutingPanel domain={domain} />,
  });
  return <Tabs tabs={tabItems} />;
}
