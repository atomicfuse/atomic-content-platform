/**
 * Stage 4 migration (option A): Ella Hughes into the library (exclusive to scoopella) and bad bylines
 * (admin, Editorial Team, "… AI …") re-credited to the site's first author. Run AFTER "Give every site an author".
 *
 *   npx tsx src/scripts/migrate-authors.ts plan  [--out authors-migration.json]
 *   npx tsx src/scripts/migrate-authors.ts apply --plan authors-migration.json
 *
 * plan  — reads origin/main and every origin/staging/<site> of the network repo (NETWORK_REPO_PATH, default
 *         ../../../atomic-labs-network; `git fetch` there first). Writes the review file (every file it would change)
 *         and prints a summary. Nothing is changed.
 * apply — commits in temporary worktrees: one on main (Ella's file, scoopella's published site.yaml, main's
 *         re-credited articles), one per staging branch. It does NOT push: it prints the push commands, main first.
 * After pushing: sync-authors.yml writes author:ella-hughes; re-seed the changed sites; run backfill-mongo for those
 * sites (site-configs + articles) so production's dashboard shows the new bylines.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import { normalizeSiteAuthors } from "../authors/bylines.js";
import { authorFileYaml, deletedSiteIds, headerAuthor, isBadByline, planMigration, recreditFrontmatter, type LibraryAuthor, type MigrationPlan, type SiteState } from "./migrate-authors-lib.js";

const repo = process.env.NETWORK_REPO_PATH ?? path.resolve(process.cwd(), "../../../atomic-labs-network");
const git = (args: string[], cwd = repo): string => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const tryGit = (args: string[]): string | null => { try { return git(args); } catch { return null; } };
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

/** Articles whose HEADER author is a bad byline. git grep finds candidates; each is confirmed from its header. */
function badArticles(ref: string, site: string, as: "staging" | "main"): SiteState["badArticles"] {
  const out = tryGit(["grep", "-E", "^author:", ref, "--", `sites/${site}/articles/*.md`]) ?? "";
  const candidates = new Set<string>();
  for (const line of out.split("\n")) {
    const m = /^[^:]+:([^:]+):author:\s*(.*)$/.exec(line);
    if (m && isBadByline(m[2]!.replace(/^["']|["']$/g, "").trim())) candidates.add(m[1]!);
  }
  const found: SiteState["badArticles"] = [];
  for (const p of candidates) {
    const author = headerAuthor(tryGit(["show", `${ref}:${p}`]) ?? "");
    if (author && isBadByline(author)) found.push({ path: p, author, ref: as });
  }
  return found;
}

function deletedSites(): Set<string> {
  return deletedSiteIds(tryGit(["show", "origin/main:dashboard-index.yaml"]) ?? "");
}

function collect(): { sites: SiteState[]; library: LibraryAuthor[] } {
  const branches = git(["branch", "-r", "--format=%(refname:short)"]).split("\n").filter((b) => b.startsWith("origin/staging/"));
  const sites: SiteState[] = [];
  const deleted = deletedSites();
  for (const b of branches) {
    const site = b.slice("origin/staging/".length);
    if (deleted.has(site)) continue;
    const raw = tryGit(["show", `${b}:sites/${site}/site.yaml`]);
    if (!raw) continue;
    const cfg = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    sites.push({ site, authors: normalizeSiteAuthors(cfg.authors), badArticles: [...badArticles(b, site, "staging"), ...badArticles("origin/main", site, "main")] });
  }
  const library: LibraryAuthor[] = (tryGit(["ls-tree", "--name-only", "origin/main", "authors/"]) ?? "")
    .split("\n").filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const doc = (parseYaml(git(["show", `origin/main:${f}`])) ?? {}) as { id?: unknown; name?: unknown; exclusive_sites?: unknown };
      return typeof doc.id === "string" && typeof doc.name === "string"
        ? { id: doc.id, name: doc.name, exclusive_sites: Array.isArray(doc.exclusive_sites) ? doc.exclusive_sites.filter((s): s is string => typeof s === "string") : [] }
        : null;
    })
    .filter((a): a is LibraryAuthor => a !== null);
  return { sites, library };
}

/** Worktrees made by this run that hold no commit yet; removed if apply fails part-way. */
const openWorktrees = new Set<string>();

function worktree(ref: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "authors-mig-"));
  git(["worktree", "add", "--detach", dir, ref]);
  openWorktrees.add(dir);
  return dir;
}

function setSiteAuthors(file: string, authors: MigrationPlan["siteAuthors"][number]["authors"]): void {
  if (!existsSync(file)) return;
  const doc = parseDocument(readFileSync(file, "utf8"));
  doc.set("authors", authors);
  writeFileSync(file, doc.toString({ lineWidth: 0 }));
}

function recredit(dir: string, items: MigrationPlan["recredit"]): void {
  for (const r of items) {
    const f = path.join(dir, r.path);
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf8");
    // Re-check: the header may have changed since the plan was made.
    const current = headerAuthor(raw);
    if (current && isBadByline(current)) writeFileSync(f, recreditFrontmatter(raw, r.to, r.authorId));
  }
}

function commitIfChanged(dir: string, paths: string[], message: string, branch: string, pushes: string[]): void {
  if (!git(["status", "--porcelain"], dir).trim()) { git(["worktree", "remove", "--force", dir]); openWorktrees.delete(dir); return; }
  git(["add", "--", ...paths], dir);
  git(["commit", "-m", message], dir);
  openWorktrees.delete(dir);
  pushes.push(`git -C ${dir} push origin HEAD:${branch} && git -C ${repo} worktree remove ${dir}`);
}

function plan(): void {
  const { sites, library } = collect();
  const p = planMigration(sites, library);
  const out = arg("--out") ?? "authors-migration.json";
  writeFileSync(out, JSON.stringify(p, null, 2));
  const by = (k: "from" | "site"): string => Object.entries(p.recredit.reduce<Record<string, number>>((acc, r) => { acc[r[k]] = (acc[r[k]] ?? 0) + 1; return acc; }, {})).map(([n, c]) => `${n} ${c}`).join(", ");
  console.log(`Sites read: ${sites.length}. Library authors: ${library.length}.`);
  console.log(`New library authors: ${p.createAuthors.map((a) => `${a.name} (exclusive to ${a.exclusive_sites.join(", ")})`).join(", ") || "none"}.`);
  console.log(`No longer exclusive (created by the first bulk run): ${p.clearExclusive.join(", ") || "none"}.`);
  console.log(`Articles re-credited: ${p.recredit.length} (by old byline: ${by("from") || "none"}).`);
  console.log(`Sites still without authors (their bad bylines wait): ${p.waiting.map((w) => `${w.site} ${w.articles}`).join(", ") || "none"}.`);
  console.log(`Review ${out}, then: npx tsx src/scripts/migrate-authors.ts apply --plan ${out}`);
}

function apply(): void {
  const file = arg("--plan");
  if (!file) throw new Error("apply needs --plan <file>");
  const p = JSON.parse(readFileSync(file, "utf8")) as MigrationPlan;
  const now = new Date().toISOString();
  const pushes: string[] = [];

  const main = worktree("origin/main");
  for (const a of p.createAuthors) {
    const f = path.join(main, "authors", `${a.id}.yaml`);
    // The plan may be older than the library: never overwrite an author created since.
    if (existsSync(f)) { console.warn(`skip: authors/${a.id}.yaml already exists`); continue; }
    writeFileSync(f, authorFileYaml(a, now));
  }
  for (const x of p.addExclusive) {
    const f = path.join(main, "authors", `${x.id}.yaml`);
    const doc = parseDocument(readFileSync(f, "utf8"));
    const cur = (doc.get("exclusive_sites") as { toJSON(): unknown } | undefined)?.toJSON();
    doc.set("exclusive_sites", [...new Set([...(Array.isArray(cur) ? (cur as string[]) : []), ...x.sites])]);
    doc.set("updated_at", now);
    writeFileSync(f, doc.toString({ lineWidth: 0 }));
  }
  for (const id of p.clearExclusive ?? []) {
    const f = path.join(main, "authors", `${id}.yaml`);
    if (!existsSync(f)) continue;
    const doc = parseDocument(readFileSync(f, "utf8"));
    doc.set("exclusive_sites", []);
    doc.set("updated_at", now);
    writeFileSync(f, doc.toString({ lineWidth: 0 }));
  }
  for (const s of p.siteAuthors) setSiteAuthors(path.join(main, "sites", s.site, "site.yaml"), s.authors);
  const onMain = p.recredit.filter((r) => r.ref === "main");
  recredit(main, onMain);
  commitIfChanged(main, ["authors", "sites"], "authors: Ella Hughes to the library; re-credit admin/Editorial Team/AI bylines", "main", pushes);

  const stagingSites = [...new Set([...p.siteAuthors.map((s) => s.site), ...p.recredit.filter((r) => r.ref === "staging").map((r) => r.site)])];
  for (const site of stagingSites) {
    const dir = worktree(`origin/staging/${site}`);
    const sa = p.siteAuthors.find((s) => s.site === site);
    if (sa) setSiteAuthors(path.join(dir, "sites", site, "site.yaml"), sa.authors);
    recredit(dir, p.recredit.filter((r) => r.ref === "staging" && r.site === site));
    commitIfChanged(dir, [`sites/${site}`], `authors: ${site} bylines`, `staging/${site}`, pushes);
  }
  console.log(`\nReview the commits, then push (main first):\n${pushes.join("\n")}`);
}

const cmd = process.argv[2];
if (cmd === "plan") plan();
else if (cmd === "apply") {
  try {
    apply();
  } catch (err) {
    for (const dir of openWorktrees) tryGit(["worktree", "remove", "--force", dir]);
    throw err;
  }
}
else console.log("usage: migrate-authors.ts plan [--out file] | apply --plan file");
