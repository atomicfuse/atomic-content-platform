import { getMongoDb } from "../lib/mongo.js";
import { COST_COLLECTIONS } from "./types.js";
import { COLLECTIONS as STATS_COLLECTIONS } from "../stats/types.js";

export interface ExtendedWindows {
  todayUsd: number;
  allTimeTokens: { input: number; output: number };
  avgPerArticle7dUsd: number;
  created7d: number;
}

export async function extendWindows(
  domain: string,
  now: Date,
): Promise<ExtendedWindows> {
  const db = await getMongoDb();
  const costColl = db.collection(COST_COLLECTIONS.costEvents);
  const genColl = db.collection(STATS_COLLECTIONS.generationEvents);

  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [todayResult, allTimeResult, cost7dResult, created7dResult] =
    await Promise.all([
      costColl
        .aggregate([
          { $match: { siteDomain: domain, at: { $gte: startOfDay } } },
          { $group: { _id: null, total: { $sum: "$costUsd" } } },
        ])
        .toArray(),

      costColl
        .aggregate([
          { $match: { siteDomain: domain } },
          {
            $group: {
              _id: null,
              input: { $sum: "$inputTokens" },
              output: { $sum: "$outputTokens" },
            },
          },
        ])
        .toArray(),

      costColl
        .aggregate([
          { $match: { siteDomain: domain, at: { $gte: sevenDaysAgo } } },
          { $group: { _id: null, total: { $sum: "$costUsd" } } },
        ])
        .toArray(),

      genColl
        .aggregate([
          {
            $match: {
              siteDomain: domain,
              finishedAt: { $gte: sevenDaysAgo },
              status: "success",
            },
          },
          { $group: { _id: null, total: { $sum: "$created" } } },
        ])
        .toArray(),
    ]);

  const todayUsd = (todayResult[0] as { total?: number } | undefined)?.total ?? 0;
  const allTimeTokens = {
    input: (allTimeResult[0] as { input?: number } | undefined)?.input ?? 0,
    output: (allTimeResult[0] as { output?: number } | undefined)?.output ?? 0,
  };
  const cost7d = (cost7dResult[0] as { total?: number } | undefined)?.total ?? 0;
  const created7d = (created7dResult[0] as { total?: number } | undefined)?.total ?? 0;
  const avgPerArticle7dUsd = created7d > 0 ? cost7d / created7d : 0;

  return { todayUsd, allTimeTokens, avgPerArticle7dUsd, created7d };
}
