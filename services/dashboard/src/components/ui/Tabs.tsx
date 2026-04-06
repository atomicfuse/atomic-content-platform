"use client";

import { useState } from "react";

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export function Tabs({ tabs, defaultTab }: TabsProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const activeContent = tabs.find((t) => t.id === activeTab)?.content;

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
      <div className="pt-4">{activeContent}</div>
    </div>
  );
}
