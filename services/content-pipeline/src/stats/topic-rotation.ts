import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { TopicRotation } from "./types.js";

/**
 * Pure function: pick the next `count` topic names from `topicNames` starting
 * at `nextIndex`, wrapping around. Returns the selected names and the new index.
 */
export function selectTopicsRoundRobin(
  topicNames: string[],
  count: number,
  nextIndex: number,
): { selected: string[]; newNextIndex: number } {
  if (topicNames.length === 0 || count <= 0) {
    return { selected: [], newNextIndex: nextIndex };
  }
  const start = nextIndex % topicNames.length;
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(topicNames[(start + i) % topicNames.length]!);
  }
  const newNextIndex = (start + count) % topicNames.length;
  return { selected, newNextIndex };
}

/**
 * Read the current topic rotation state for a site from MongoDB.
 * Returns null if no rotation has been recorded yet.
 */
export async function readTopicRotation(
  siteDomain: string,
): Promise<TopicRotation | null> {
  const db = await getMongoDb();
  const doc = await db.collection(COLLECTIONS.siteStats).findOne(
    { _id: siteDomain as any },
    { projection: { topicRotation: 1 } },
  );
  return (doc as any)?.topicRotation ?? null;
}

/**
 * Persist updated topic rotation state after a scheduler run.
 */
export async function saveTopicRotation(
  siteDomain: string,
  rotation: TopicRotation,
): Promise<void> {
  const db = await getMongoDb();
  await db.collection(COLLECTIONS.siteStats).updateOne(
    { _id: siteDomain as any },
    { $set: { topicRotation: rotation } },
    { upsert: true },
  );
}
