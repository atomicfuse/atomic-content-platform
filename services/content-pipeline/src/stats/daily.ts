import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";

/**
 * Count articles created today (UTC) for a single site.
 * Sums `created` from generation_events where status=success
 * and finishedAt >= start of today UTC.
 */
export async function countTodayCreated(
  domain: string,
  now: Date,
): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const db = await getMongoDb();
  const coll = db.collection(COLLECTIONS.generationEvents);

  const pipeline = [
    {
      $match: {
        siteDomain: domain,
        finishedAt: { $gte: startOfDay },
        status: { $in: ["success", "partial"] },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$created" },
      },
    },
  ];

  const results = await coll.aggregate(pipeline).toArray();
  return results[0]?.total ?? 0;
}
