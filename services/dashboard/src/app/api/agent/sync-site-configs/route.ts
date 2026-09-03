// POST /api/agent/sync-site-configs
// Accepts { configs: Array<{ domain: string; config: Record<string, unknown> }> }
// Upserts each config into site_configs AND updates site_stats.schedule.
// Temporary endpoint — remove after production sync is done.
import { NextResponse, type NextRequest } from "next/server";
import { getMongoDb } from "@/lib/mongo";
import { buildSiteConfigDoc } from "@/lib/db/site-configs";

/** Extract schedule snapshot from a site config's brief.schedule. */
function extractSchedule(config: Record<string, unknown>): {
  articlesPerDay: number;
  preferredDays: string[];
  weeklyTarget: number;
} | null {
  const brief = config.brief as Record<string, unknown> | undefined;
  const sched = brief?.schedule as Record<string, unknown> | undefined;
  if (!sched) return null;

  const preferredDays = Array.isArray(sched.preferred_days)
    ? (sched.preferred_days as string[])
    : [];

  let articlesPerDay = 0;
  if (typeof sched.articles_per_day === "number" && sched.articles_per_day > 0) {
    articlesPerDay = sched.articles_per_day;
  } else {
    const perWeek = typeof sched.articles_per_week === "number" ? sched.articles_per_week : 0;
    if (perWeek > 0) {
      const daysCount = preferredDays.length || 7;
      articlesPerDay = Math.max(1, Math.ceil(perWeek / daysCount));
    }
  }

  return {
    articlesPerDay,
    preferredDays,
    weeklyTarget: articlesPerDay * (preferredDays.length || 7),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const configs = body?.configs;
    if (!Array.isArray(configs) || configs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Expected { configs: [{ domain, config }] }" },
        { status: 400 },
      );
    }

    const db = await getMongoDb();
    const siteConfigsColl = db.collection("site_configs");
    const siteStatsColl = db.collection("site_stats");

    let configsUpdated = 0;
    let schedulesUpdated = 0;
    const errors: Array<{ domain: string; error: string }> = [];

    for (const entry of configs) {
      const { domain, config } = entry;
      if (!domain || !config) {
        errors.push({ domain: domain ?? "unknown", error: "missing domain or config" });
        continue;
      }
      try {
        // 1. Upsert site_configs
        // buildSiteConfigDoc keeps config.domain (the hostname) from being
        // overwritten by the collection key (the siteId).
        await siteConfigsColl.updateOne(
          { domain },
          { $set: buildSiteConfigDoc(domain, config) },
          { upsert: true },
        );
        configsUpdated++;

        // 2. Update site_stats.schedule (only if schedule exists in config)
        const schedule = extractSchedule(config);
        if (schedule) {
          await siteStatsColl.updateOne(
            { _id: domain as any },
            { $set: { schedule } },
          );
          schedulesUpdated++;
        }
      } catch (err) {
        errors.push({
          domain,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Optionally reset this week's weekly_summaries so the scheduler
    //    summary table re-computes expected values from the new schedules.
    let weeklyReset = false;
    if (body?.resetWeeklySummary) {
      // Compute current week's Sunday date (weekOf key)
      const now = new Date();
      const dayIndex = now.getUTCDay(); // 0=Sun
      const sundayMs = now.getTime() - dayIndex * 86_400_000;
      const weekOf = new Date(sundayMs).toISOString().slice(0, 10);
      await db.collection("weekly_summaries").deleteOne({ _id: weekOf as any });
      weeklyReset = true;
    }

    return NextResponse.json({ ok: true, configsUpdated, schedulesUpdated, weeklyReset, errors });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
