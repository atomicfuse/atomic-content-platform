/**
 * One-time backfill: assign random author names to all existing sites
 * that don't have one.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> npx tsx scripts/backfill-authors.ts
 *
 * Reads dashboard-index.yaml, iterates sites with staging branches,
 * reads site.yaml, adds author if missing, commits to staging branch.
 */

import { Octokit } from "@octokit/rest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const REPO_OWNER = "atomicfuse";
const REPO_NAME = "atomic-labs-network";

// Inline name lists (same as services/dashboard/src/lib/author-names.ts)
const FIRST_NAMES = [
  "James", "Sarah", "Michael", "Elena", "David",
  "Olivia", "Daniel", "Sophia", "Andrew", "Maya",
  "Nathan", "Rachel", "Marcus", "Ava", "Ethan",
  "Lily", "Ryan", "Chloe", "Lucas", "Emma",
  "Alex", "Zoe", "Ben", "Mia", "Sam",
  "Julia", "Leo", "Hannah", "Max", "Nora",
];

const LAST_NAMES = [
  "Mitchell", "Carter", "Rodriguez", "Chen", "Bennett",
  "Brooks", "Sullivan", "Kim", "Parker", "Hayes",
  "Foster", "Reed", "Morgan", "Torres", "Cooper",
  "Bell", "Ward", "Rivera", "Gray", "Scott",
  "Adams", "Murphy", "Price", "Ross", "Perry",
  "Powell", "Long", "Hughes", "Sanders", "West",
];

function generateAuthorName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

interface DashboardIndex {
  sites: Array<{
    domain: string;
    status?: string;
    staging_branch?: string | null;
  }>;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN env var is required");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  // Read dashboard-index.yaml from main
  const indexRes = await octokit.repos.getContent({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: "dashboard-index.yaml",
    ref: "main",
  });

  if (!("content" in indexRes.data)) {
    console.error("Could not read dashboard-index.yaml");
    process.exit(1);
  }

  const indexContent = Buffer.from(indexRes.data.content, "base64").toString("utf-8");
  const index = parseYaml(indexContent) as DashboardIndex;

  const sites = index.sites.filter(
    (s) => s.staging_branch && s.status !== "Deleted",
  );

  console.log(`Found ${sites.length} sites with staging branches`);

  let updated = 0;
  let skipped = 0;

  for (const site of sites) {
    const branch = site.staging_branch!;
    const path = `sites/${site.domain}/site.yaml`;

    try {
      const fileRes = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path,
        ref: branch,
      });

      if (!("content" in fileRes.data)) {
        console.log(`  [skip] ${site.domain} — not a file`);
        skipped++;
        continue;
      }

      const yaml = Buffer.from(fileRes.data.content, "base64").toString("utf-8");
      const config = parseYaml(yaml) as Record<string, unknown>;

      if (config.author) {
        console.log(`  [skip] ${site.domain} — already has author: ${config.author}`);
        skipped++;
        continue;
      }

      const authorName = generateAuthorName();
      config.author = authorName;

      const updatedYaml = stringifyYaml(config, { lineWidth: 0 });

      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path,
        message: `feat: add default author "${authorName}" to ${site.domain}`,
        content: Buffer.from(updatedYaml).toString("base64"),
        sha: fileRes.data.sha,
        branch,
      });

      console.log(`  [done] ${site.domain} — assigned author: ${authorName}`);
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [error] ${site.domain} — ${msg}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
