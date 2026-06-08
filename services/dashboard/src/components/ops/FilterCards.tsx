"use client";

import type { CardId, OpsRow } from "@/lib/ops-helpers";
import { cardPredicate } from "@/lib/ops-helpers";

interface CardConfig {
  id: CardId;
  label: string;
  icon: string;
  colorClass: string;
  bgClass: string;
}

const CARDS: CardConfig[] = [
  { id: "ALL_LIVE", label: "All Sites (Live)", icon: "◉", colorClass: "text-primary", bgClass: "bg-primary-light" },
  { id: "ATTENTION", label: "Needs Attention", icon: "⚠", colorClass: "text-warning", bgClass: "bg-warning-light" },
  { id: "FAILED_ARTICLES", label: "Failed Articles (7d)", icon: "✕", colorClass: "text-error", bgClass: "bg-error-light" },
  { id: "SITES_DOWN", label: "Sites Down", icon: "↓", colorClass: "text-error", bgClass: "bg-error-light" },
  { id: "SYNC_FAILED", label: "Sync Failed (24h)", icon: "⟲", colorClass: "text-warning", bgClass: "bg-warning-light" },
  { id: "PUBLISHED_TODAY", label: "Published Today", icon: "↑", colorClass: "text-success", bgClass: "bg-success-light" },
  { id: "IN_REVIEW", label: "In Review", icon: "◎", colorClass: "text-primary", bgClass: "bg-primary-light" },
];

interface FilterCardsProps {
  rows: OpsRow[];
  activeCard: CardId | null;
  onCardClick: (card: CardId) => void;
}

export function FilterCards({ rows, activeCard, onCardClick }: FilterCardsProps): React.ReactElement {
  return (
    <div className="grid grid-cols-7 gap-2.5">
      {CARDS.map((card) => {
        const isActive = activeCard === card.id;
        const count = computeCount(card.id, rows);
        return (
          <button
            key={card.id}
            onClick={() => onCardClick(card.id)}
            className={`
              rounded-xl p-3 text-center transition-all cursor-pointer
              bg-card border shadow-card
              ${isActive ? "border-primary border-2" : "border-card-border"}
              hover:shadow-card-hover
            `}
          >
            <div className={`inline-flex w-7 h-7 rounded-lg ${card.bgClass} items-center justify-center mb-1.5`}>
              <span className={`${card.colorClass} text-sm`}>{card.icon}</span>
            </div>
            <div className="text-secondary text-[9px] uppercase tracking-wider mb-1">{card.label}</div>
            <div className="text-2xl font-bold text-primary-text">
              {typeof count === "string" ? count : count}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function computeCount(cardId: CardId, rows: OpsRow[]): string | number {
  if (cardId === "PUBLISHED_TODAY") {
    const created = rows.reduce((s, r) => s + r.todayCreated, 0);
    const expected = rows.reduce((s, r) => s + r.todayExpected, 0);
    return `${created} / ${expected}`;
  }
  if (cardId === "IN_REVIEW") {
    return rows.reduce((s, r) => s + r.reviewCount, 0);
  }
  return rows.filter(cardPredicate(cardId)).length;
}
