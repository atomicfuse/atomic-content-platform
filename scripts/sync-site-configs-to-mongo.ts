/**
 * Sync site_configs from local filesystem to MongoDB.
 *
 * Reads site.yaml files from the local network repo and upserts them
 * into the site_configs collection. No Git/GitHub API calls.
 *
 * Usage:
 *   MONGODB_URL=<url> npx tsx scripts/sync-site-configs-to-mongo.ts
 *
 * With cloudgrid dev running:
 *   MONGODB_URL=mongodb://...@localhost:63694/sites-platform-e297?... npx tsx scripts/sync-site-configs-to-mongo.ts
 */

import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { parse as parseYaml } from "yaml";

const NETWORK_REPO =
  process.env.NETWORK_DATA_PATH ??
  path.resolve(
    import.meta.dirname ?? __dirname,
    "../../atomic-labs-network",
  );

const SITES_DIR = path.join(NETWORK_REPO, "sites");

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGODB_URL ?? process.env.MONGODB_URI;
  if (!mongoUrl) {
    console.error("MONGODB_URL (or MONGODB_URI) is required");
    process.exit(1);
  }

  console.log(`Network repo: ${NETWORK_REPO}`);
  console.log(`Sites dir:    ${SITES_DIR}`);

  if (!fs.existsSync(SITES_DIR)) {
    console.error(`Sites directory not found: ${SITES_DIR}`);
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  // Let the driver use the DB name from the connection string
  const db = client.db();
  console.log(`MongoDB DB:   ${db.databaseName}`);
  const coll = db.collection("site_configs");

  const dirs = fs
    .readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  console.log(`\nFound ${dirs.length} site directories\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const domain of dirs) {
    const yamlPath = path.join(SITES_DIR, domain, "site.yaml");
    if (!fs.existsSync(yamlPath)) {
      console.log(`  SKIP ${domain} — no site.yaml`);
      skipped++;
      continue;
    }

    try {
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const config = parseYaml(raw) as Record<string, unknown>;

      // Show schedule for verification
      const brief = config.brief as Record<string, unknown> | undefined;
      const sched = brief?.schedule as Record<string, unknown> | undefined;
      const days = sched?.preferred_days ?? "none";
      const apd = sched?.articles_per_day ?? "?";

      await coll.updateOne(
        { domain },
        { $set: { ...config, domain, updatedAt: new Date() } },
        { upsert: true },
      );

      console.log(`  OK   ${domain.padEnd(25)} days=${JSON.stringify(days)} apd=${apd}`);
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERR  ${domain}: ${msg}`);
      errors++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Updated: ${updated}  Skipped: ${skipped}  Errors: ${errors}`);
  console.log(`========================================\n`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
