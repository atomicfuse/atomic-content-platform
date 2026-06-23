"use client";

import Link from "next/link";
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
  { id: "ALL_LIVE", label: "All Sites (Live)", icon: "\u25C9", colorClass: "text-primary", bgClass: "bg-primary-light" },
  { id: "ATTENTION", label: "Needs Attention", icon: "\u26A0", colorClass: "text-warning", bgClass: "bg-warning-light" },
  { id: "FAILED_ARTICLES", label: "Failed Articles (7d)", icon: "\u2715", colorClass: "text-error", bgClass: "bg-error-light" },
  { id: "SITES_DOWN", label: "Sites Down", icon: "\u2193", colorClass: "text-error", bgClass: "bg-error-light" },
  { id: "SYNC_FAILED", label: "Sync Failed (24h)", icon: "\u27F2", colorClass: "text-warning", bgClass: "bg-warning-light" },
  { id: "IN_REVIEW", label: "In Review", icon: "\u25CE", colorClass: "text-primary", bgClass: "bg-primary-light" },
];

interface FilterCardsProps {
  rows: OpsRow[];
  activeCard: CardId | null;
  onCardClick: (card: CardId) => void;
  reviewTotal: number;
}

export function FilterCards({ rows, activeCard, onCardClick, reviewTotal }: FilterCardsProps): React.ReactElement {
  const todayCreated = rows.reduce((sum, r) => sum + r.todayCreated, 0);
  const todayExpected = rows.reduce((sum, r) => sum + r.todayExpected, 0);

  return (
    <div className="grid grid-cols-7 gap-2.5">
      {CARDS.map((card) => {
        const isActive = activeCard === card.id;
        const count = computeCount(card.id, rows, reviewTotal);
        const inner = (
          <>
            <div className={`inline-flex w-7 h-7 rounded-lg ${card.bgClass} items-center justify-center mb-1.5`}>
              <span className={`${card.colorClass} text-sm`}>{card.icon}</span>
            </div>
            <div className="text-secondary text-[9px] uppercase tracking-wider mb-1">{card.label}</div>
            <div className="text-2xl font-bold text-primary-text">{count}</div>
          </>
        );

        const classes = `
          rounded-xl p-3 text-center transition-all cursor-pointer
          bg-card border shadow-card
          ${isActive ? "border-primary border-2" : "border-card-border"}
          hover:shadow-card-hover
        `;

        if (card.id === "IN_REVIEW") {
          return (
            <Link key={card.id} href="/review" className={classes}>
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={card.id}
            onClick={() => onCardClick(card.id)}
            className={classes}
          >
            {inner}
          </button>
        );
      })}

      {/* Article Generation — display-only card */}
      <div className="rounded-xl p-3 text-center bg-card border border-card-border shadow-card">
        <div className="inline-flex w-7 h-7 rounded-lg bg-success-light items-center justify-center mb-1.5">
          <span className="text-success text-sm">{"\u270E"}</span>
        </div>
        <div className="text-secondary text-[9px] uppercase tracking-wider mb-1">Articles Today</div>
        <div className="text-2xl font-bold text-primary-text">
          {todayCreated}
          <span className="text-secondary text-sm font-normal"> / {todayExpected}</span>
        </div>
      </div>
    </div>
  );
}

function computeCount(cardId: CardId, rows: OpsRow[], reviewTotal: number): number {
  if (cardId === "IN_REVIEW") {
    return reviewTotal;
  }
  return rows.filter(cardPredicate(cardId)).length;
}
