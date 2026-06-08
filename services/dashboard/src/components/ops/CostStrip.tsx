"use client";

import type { CostStripData } from "@/lib/ops-helpers";

interface CostStripProps {
  data: CostStripData;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

export function CostStrip({ data }: CostStripProps): React.ReactElement {
  const items = [
    { label: "AI spend today", value: fmt(data.aiSpendToday) },
    { label: "Avg/article (7d)", value: data.avgPerArticle7d > 0 ? fmt(data.avgPerArticle7d) : "—" },
    { label: "Expected monthly", value: data.expectedMonthly > 0 ? fmt(data.expectedMonthly) : "—" },
    { label: "Total tokens", value: `${fmtTokens(data.totalTokensIn)} in · ${fmtTokens(data.totalTokensOut)} out` },
    { label: "R2 storage", value: `${fmtBytes(data.r2.totalBytes)} · ${data.r2.capacityPct.toFixed(0)}% · ${data.r2.totalImages.toLocaleString()} imgs` },
  ];

  return (
    <div className="bg-card border border-card-border rounded-xl px-5 py-2.5 flex justify-between items-center shadow-card text-xs">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-3">
          {i > 0 && <span className="text-divider">│</span>}
          <div>
            <span className="text-secondary">{item.label}</span>{" "}
            <span className="text-primary-text font-semibold">{item.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
