export type GenerationSource = "scheduler" | "dashboard" | "wp-import";
export type RunStatus = "success" | "partial" | "error" | "no_content";

export interface GenerationEvent {
  _id?: string;               // deterministic for backfill; auto otherwise
  siteDomain: string;
  source: GenerationSource;
  forced: boolean;
  topicName: string | null;
  requested: number;
  created: number;
  failed: number;             // results[] with status "error"
  status: RunStatus;
  message: string | null;
  startedAt: Date;
  finishedAt: Date;
}

export interface ScheduleSnapshot {
  articlesPerDay: number;
  preferredDays: string[];
  weeklyTarget: number;
}

export interface SiteStats {
  _id: string;                // siteDomain
  lastRunAt: Date;
  lastAddedAt: Date | null;
  lastAddedSource: GenerationSource | null;
  lastAddedCount: number | null;
  lastFailedAt: Date | null;  // status==="error" && created===0
  totalCreated: number;
  schedule: ScheduleSnapshot | null;
  updatedAt: Date;
}

export interface ImageGenEvent {
  _id?: string;
  siteDomain: string;
  slug: string;
  ok: boolean;
  provider: string | null;
  error: string | null;
  at: Date;
}

export const COLLECTIONS = {
  generationEvents: "generation_events",
  siteStats: "site_stats",
  imageGenEvents: "image_gen_events",
} as const;
