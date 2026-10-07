/**
 * Renames existing articles whose slug isn't brand-safe (lib/brand-safety.ts), with a review step.
 *
 *   npx tsx src/scripts/brand-safe-slugs.ts plan  --sites scoopella[,other] | --all  [--deep] [--out plan.json]
 *   npx tsx src/scripts/brand-safe-slugs.ts apply --plan plan.json
 *
 * plan  — reads origin/main and origin/staging/<site> of the network repo (NETWORK_REPO_PATH, default
 *         ../../../atomic-labs-network), finds unsafe slugs, asks the AI for safe ones (unique per site)
 *         and writes a review file. Nothing is changed. --deep also asks the AI reviewer about every
 *         slug the word list passes (one small AI call per article — use per site, not --all).
 * apply — for every branch in the plan: a temporary worktree, the files renamed with `slug:` updated
 *         and the old slug added to `redirect_from:` (seed-kv → 301 from the old URL), one commit.
 *         It does NOT push: it prints the push commands. After pushing, run the dashboard's
 *         backfill-mongo for the sites so the article list drops the old slugs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import matter from "gray-matter";
import { aiSlugJudge, brandSafeSlug, findUnsafeSlugTerms } from "../lib/brand-safety.js";
import { renameArticleText, uniqueSlug } from "./brand-safe-slugs-lib.js";

dotenv.config({ override: true });

interface PlanEntry { site: string; oldSlug: string; newSlug: string; title: string; terms: string[]; branches: string[] }

const repo = process.env.NETWORK_REPO_PATH ?? path.resolve(process.cwd(), "../../../atomic-labs-network");

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function remoteBranchExists(branch: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function slugsOn(branch: string, site: string): string[] {
  const out = git(["ls-tree", "--name-only", `origin/${branch}`, `sites/${site}/articles/`]);
  return out.split("\n").filter((f) => f.endsWith(".md")).map((f) => path.basename(f, ".md"));
}

function allSites(): string[] {
  const out = git(["ls-tree", "-d", "--name-only", "origin/main", "sites/"]);
  return out.split("\n").filter(Boolean).map((d) => path.basename(d));
}

async function plan(): Promise<void> {
  const sites = process.argv.includes("--all") ? allSites() : (arg("--sites") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (sites.length === 0) throw new Error("plan: pass --sites a,b or --all");
  const out = arg("--out") ?? "brand-safe-plan.json";
  git(["fetch", "--quiet", "origin"]);

  const entries: PlanEntry[] = [];
  for (const site of sites) {
    const branches = ["main", `staging/${site}`].filter(remoteBranchExists);
    const slugsByBranch = new Map(branches.map((b) => [b, slugsOn(b, site)] as const));
    const taken = new Set([...slugsByBranch.values()].flat());
    const unsafe = [...taken].filter((s) => findUnsafeSlugTerms(s).length > 0).sort();
    if (process.argv.includes("--deep")) {
      // Second layer: the AI reviewer on every slug the word list passed.
      for (const s of [...taken].filter((x) => !unsafe.includes(x)).sort()) {
        const branch = branches.find((b) => slugsByBranch.get(b)!.includes(s))!;
        const title = String(matter(git(["show", `origin/${branch}:sites/${site}/articles/${s}.md`])).data.title ?? s);
        try {
          if (!(await aiSlugJudge(s, title)).safe) unsafe.push(s);
        } catch (err) {
          console.warn(`  review failed for ${s}:`, err instanceof Error ? err.message : err);
        }
      }
    }
    for (const oldSlug of unsafe) {
      const onBranches = branches.filter((b) => slugsByBranch.get(b)!.includes(oldSlug));
      const raw = git(["show", `origin/${onBranches[0]}:sites/${site}/articles/${oldSlug}.md`]);
      const title = String(matter(raw).data.title ?? oldSlug);
      const safe = await brandSafeSlug(oldSlug, title);
      // The full check (list + reviewer) can pass a slug the first look flagged — the reviewer isn't
      // deterministic. Keep it as is rather than "renaming" it to itself with a -2 suffix.
      if (safe === oldSlug) continue;
      const newSlug = uniqueSlug(safe, taken);
      taken.add(newSlug);
      entries.push({ site, oldSlug, newSlug, title, terms: findUnsafeSlugTerms(oldSlug).map((h) => h.term), branches: onBranches });
      console.log(`${site}: ${oldSlug}\n   → ${newSlug}`);
    }
  }
  writeFileSync(out, JSON.stringify(entries, null, 2));
  console.log(`\n${entries.length} slug(s) across ${sites.length} site(s). Review/edit ${out} (change any newSlug you like), then run apply.`);
}

function apply(): void {
  const file = arg("--plan");
  if (!file) throw new Error("apply: pass --plan <file>");
  const entries = JSON.parse(readFileSync(file, "utf8")) as PlanEntry[];
  git(["fetch", "--quiet", "origin"]);

  const branches = [...new Set(entries.flatMap((e) => e.branches))];
  const pushes: string[] = [];
  for (const branch of branches) {
    const dir = mkdtempSync(path.join(tmpdir(), `brand-safe-${branch.replace(/\W+/g, "-")}-`));
    git(["worktree", "add", "--detach", dir, `origin/${branch}`]);
    let renamed = 0;
    for (const e of entries.filter((x) => x.branches.includes(branch))) {
      const from = path.join(dir, "sites", e.site, "articles", `${e.oldSlug}.md`);
      const to = path.join(dir, "sites", e.site, "articles", `${e.newSlug}.md`);
      if (!existsSync(from)) { console.warn(`  skip ${branch}: ${e.site}/${e.oldSlug} (gone)`); continue; }
      if (existsSync(to)) { console.warn(`  skip ${branch}: ${e.site}/${e.newSlug} already exists`); continue; }
      writeFileSync(from, renameArticleText(readFileSync(from, "utf8"), e.oldSlug, e.newSlug));
      renameSync(from, to);
      git(["add", "-A", "--", path.join("sites", e.site, "articles")], dir);
      renamed++;
    }
    if (renamed === 0) { git(["worktree", "remove", "--force", dir]); continue; }
    const sites = [...new Set(entries.filter((x) => x.branches.includes(branch)).map((x) => x.site))];
    git(["commit", "--quiet", "-m", `content(${sites.length === 1 ? sites[0] : "network"}): brand-safe slugs (${renamed} renamed; old URLs 301)`], dir);
    console.log(`${branch}: ${renamed} renamed, committed in ${dir}`);
    pushes.push(`git -C ${dir} push origin HEAD:${branch} && git -C ${repo} worktree remove ${dir}`);
  }
  console.log(`\nReview the commits, then push:\n${pushes.join("\n")}`);
  console.log("\nAfter the push: the KV sync adds the redirects; then run backfill-mongo for these sites so the dashboard drops the old slugs.");
}

const mode = process.argv[2];
(mode === "plan" ? plan() : mode === "apply" ? Promise.resolve(apply()) : Promise.reject(new Error("usage: plan | apply")))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
