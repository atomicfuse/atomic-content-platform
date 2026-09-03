/**
 * One-time script to rebuild dedup-index.json for a site by scanning all
 * existing article files. Run after migration to fix sites that were imported
 * without a dedup index.
 *
 * Usage: npx tsx src/scripts/rebuild-dedup-index.ts <siteDomain> [--all]
 *
 * With --all: rebuilds for ALL sites in the network repo's sites/ directory.
 */
import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import { normalizeUrl, normalizeTitleKey, dedupIndexPath, serializeDedupIndex } from "../agents/content-generation/agent.js";

const args = process.argv.slice(2);
const doAll = args.includes("--all");
const siteDomain = doAll ? undefined : args[0];

if (!siteDomain && !doAll) {
  console.error("Usage: npx tsx src/scripts/rebuild-dedup-index.ts <siteDomain>");
  console.error("       npx tsx src/scripts/rebuild-dedup-index.ts --all");
  process.exit(1);
}

const networkPath = process.env.NETWORK_DATA_PATH
  ?? path.resolve(process.cwd(), "../../../atomic-labs-network");

async function rebuildForSite(domain: string): Promise<void> {
  const articlesDir = path.join(networkPath, "sites", domain, "articles");
  const urls = new Set<string>();
  const titles = new Set<string>();
  const ids = new Set<string>();

  let files: string[];
  try {
    files = await fs.readdir(articlesDir);
  } catch {
    console.warn(`  Skipping ${domain} — no articles directory`);
    return;
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) {
    console.warn(`  Skipping ${domain} — no .md files`);
    return;
  }

  for (const file of mdFiles) {
    try {
      const content = await fs.readFile(path.join(articlesDir, file), "utf-8");
      const { data } = matter(content);
      if (data.source_url) {
        try { urls.add(normalizeUrl(data.source_url as string)); } catch { /* skip */ }
      }
      if (data.title) titles.add(normalizeTitleKey(data.title as string));
      if (data.source_title) titles.add(normalizeTitleKey(data.source_title as string));
      if (data.source_item_id) ids.add(String(data.source_item_id));
    } catch {
      console.warn(`  Skipping unparseable file: ${file}`);
    }
  }

  const indexPath = path.join(networkPath, dedupIndexPath(domain));
  const indexContent = serializeDedupIndex({ urls, titles, ids });
  await fs.writeFile(indexPath, indexContent, "utf-8");

  console.log(`  ${domain}: ${urls.size} URLs, ${titles.size} titles, ${ids.size} ids (from ${mdFiles.length} articles)`);
}

async function main(): Promise<void> {
  console.log(`Network path: ${networkPath}`);

  if (doAll) {
    const sitesDir = path.join(networkPath, "sites");
    let entries: string[];
    try {
      entries = await fs.readdir(sitesDir);
    } catch {
      console.error(`Cannot read ${sitesDir}`);
      process.exit(1);
    }

    let count = 0;
    for (const entry of entries) {
      const stat = await fs.stat(path.join(sitesDir, entry));
      if (!stat.isDirectory()) continue;
      await rebuildForSite(entry);
      count++;
    }
    console.log(`\nRebuilt dedup indexes for ${count} site(s).`);
  } else {
    await rebuildForSite(siteDomain!);
    console.log("Done.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
