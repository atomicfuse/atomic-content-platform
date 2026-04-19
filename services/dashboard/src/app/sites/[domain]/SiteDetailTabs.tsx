"use client";

import { Tabs } from "@/components/ui/Tabs";
import { EmailRoutingPanel } from "@/components/site-detail/EmailRoutingPanel";

interface SiteDetailTabsProps {
  domain: string;
  stagingTab: React.ReactNode | null;
  contentTab: React.ReactNode;
  identityTab: React.ReactNode;
}

export function SiteDetailTabs({
  domain,
  stagingTab,
  contentTab,
  identityTab,
}: SiteDetailTabsProps): React.ReactElement {
  const tabItems = [];
  if (stagingTab) {
    tabItems.push({ id: "staging", label: "Staging & Preview", content: stagingTab });
  }
  tabItems.push(
    { id: "content", label: "Content", content: contentTab },
    { id: "identity", label: "Site Identity", content: identityTab },
  );
  tabItems.push({
    id: "email",
    label: "Email",
    content: <EmailRoutingPanel domain={domain} />,
  });
  return <Tabs tabs={tabItems} />;
}
