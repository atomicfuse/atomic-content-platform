import type { GenerationSource } from "../stats/types.js";

export interface CostEvent {
  siteDomain: string;
  kind: "text" | "image";
  model: string;
  source: GenerationSource;
  inputTokens: number;
  outputTokens: number;
  images: number;
  estimated: boolean;
  costUsd: number;
  at: Date;
}

export interface ModelRollup {
  inputTokens: number;
  outputTokens: number;
  images: number;
  costUsd: number;
  estimated: boolean;
}

export interface SiteCosts {
  _id: string;
  byModel: Record<string, ModelRollup>;
  totalCostUsd: number;
  updatedAt: Date;
}

export const COST_COLLECTIONS = {
  costEvents: "cost_events",
  siteCosts: "site_costs",
} as const;
