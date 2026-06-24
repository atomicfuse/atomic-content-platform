// POST /api/agent/sync-site-configs
// Accepts { configs: Array<{ domain: string; config: Record<string, unknown> }> }
// Upserts each config into the site_configs MongoDB collection.
// Temporary endpoint — remove after production sync is done.
import { NextResponse, type NextRequest } from "next/server";
import { getMongoDb } from "@/lib/mongo";

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
    const coll = db.collection("site_configs");

    let updated = 0;
    const errors: Array<{ domain: string; error: string }> = [];

    for (const entry of configs) {
      const { domain, config } = entry;
      if (!domain || !config) {
        errors.push({ domain: domain ?? "unknown", error: "missing domain or config" });
        continue;
      }
      try {
        await coll.updateOne(
          { domain },
          { $set: { ...config, domain, updatedAt: new Date() } },
          { upsert: true },
        );
        updated++;
      } catch (err) {
        errors.push({
          domain,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ ok: true, updated, errors });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
