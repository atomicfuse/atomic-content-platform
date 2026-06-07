/**
 * Read-side queries over the `alert_state` collection for the ops console.
 *
 * The runner (`run.ts`) writes per-(site,condition) and network-scoped docs.
 * Here we surface the "what needs attention right now" view: every doc whose
 * `status === "alerting"`, grouped by site, with network-scoped reminder docs
 * (`_id` prefixed `__network__:`) excluded.
 */

import { getMongoDb } from "../lib/mongo.js";
import { ALERT_STATE_COLLECTION } from "./run.js";
import type { AlertState } from "./types.js";

export interface AttentionItem {
  condition: string;
  severity: "warn" | "critical";
  since: Date | null;
  value: number | null;
}

export interface SiteAttention {
  siteDomain: string;
  alerting: AttentionItem[];
}

const NETWORK_PREFIX = "__network__:";

/** Split `${domain}:${conditionId}` on the final `:`. */
function splitId(id: string): { domain: string; condition: string } {
  const idx = id.lastIndexOf(":");
  return { domain: id.slice(0, idx), condition: id.slice(idx + 1) };
}

/** Map an alerting state doc → an AttentionItem. */
function toItem(condition: string, doc: AlertState): AttentionItem {
  return {
    condition,
    severity: condition === "sync_failed" ? "critical" : "warn",
    since: doc.firstDetectedAt,
    value:
      condition === "failed_articles" || condition === "in_review"
        ? doc.lastValue
        : null,
  };
}

/** Read all currently-alerting, site-scoped docs (network reminders excluded). */
async function readAlerting(): Promise<AlertState[]> {
  const db = await getMongoDb();
  const docs = await db
    .collection<AlertState>(ALERT_STATE_COLLECTION)
    .find({ status: "alerting" })
    .toArray();
  return docs.filter((doc) => !doc._id.startsWith(NETWORK_PREFIX));
}

/** Attention items for a single site. */
export async function getAttention(
  domain: string,
  _now?: Date,
): Promise<SiteAttention> {
  const docs = await readAlerting();
  const alerting: AttentionItem[] = [];
  for (const doc of docs) {
    const { domain: docDomain, condition } = splitId(doc._id);
    if (docDomain === domain) {
      alerting.push(toItem(condition, doc));
    }
  }
  return { siteDomain: domain, alerting };
}

/** Attention items for every site that has at least one alerting condition. */
export async function getAllAttention(_now?: Date): Promise<SiteAttention[]> {
  const docs = await readAlerting();
  const byDomain = new Map<string, AttentionItem[]>();
  for (const doc of docs) {
    const { domain, condition } = splitId(doc._id);
    const items = byDomain.get(domain) ?? [];
    items.push(toItem(condition, doc));
    byDomain.set(domain, items);
  }
  return [...byDomain.entries()].map(([siteDomain, alerting]) => ({
    siteDomain,
    alerting,
  }));
}
