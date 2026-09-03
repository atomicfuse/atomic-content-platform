#!/usr/bin/env node
/**
 * One-time backfill: add explicit `topics` field to all articles in the
 * network repo that don't have one, and ensure no topic page is empty.
 *
 * Usage:
 *   node scripts/backfill-topics.mjs [--dry-run]
 *
 * Operates on the LOCAL filesystem checkout of atomic-labs-network.
 * Processes the currently checked-out branch.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(
  join(import.meta.dirname, "..", "services", "content-pipeline", "src", "index.ts"),
);
const { parse: parseYaml } = require("yaml");
const matter = require("gray-matter");

const NETWORK_PATH =
  process.env.NETWORK_DATA_PATH ??
  join(import.meta.dirname, "..", "..", "atomic-labs-network");

const DRY_RUN = process.argv.includes("--dry-run");

// ── helpers ──────────────────────────────────────────────────────────

function slugify(s) {
  return s.toLowerCase().replace(/\s+/g, "-");
}

function wordStemInText(word, text) {
  if (text.includes(word)) return true;
  if (word.endsWith("ing") && word.length > 4 && text.includes(word.slice(0, -3))) return true;
  if (word.endsWith("s") && word.length > 3 && text.includes(word.slice(0, -1))) return true;
  if (word.endsWith("es") && word.length > 4 && text.includes(word.slice(0, -2))) return true;
  if (word.endsWith("ed") && word.length > 4 && text.includes(word.slice(0, -2))) return true;
  return false;
}

function countTopics(articles, siteTopics) {
  const counts = new Map(siteTopics.map((t) => [t, 0]));
  for (const a of articles) {
    for (const t of a.data.topics ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

// ── topic inference ──────────────────────────────────────────────────

function inferTopics(articles, siteTopics) {
  if (siteTopics.length === 0 || articles.length === 0) return;
  const topicSlugs = siteTopics.map(slugify);

  // Pass 1: tag matching (high confidence)
  for (const a of articles) {
    if (Array.isArray(a.data.topics) && a.data.topics.length > 0) continue;
    const tags = a.data.tags ?? [];
    const tagSlugs = tags.map(slugify);
    const tagLower = tags.map((t) => t.toLowerCase());
    const matched = new Set();

    for (let i = 0; i < siteTopics.length; i++) {
      const topic = siteTopics[i];
      const slug = topicSlugs[i];
      if (tagSlugs.includes(slug)) { matched.add(topic); continue; }
      if (tagLower.includes(topic.toLowerCase())) { matched.add(topic); continue; }
      // Partial: tag is suffix/prefix of topic slug
      if (tagSlugs.some((ts) => slug.endsWith(`-${ts}`) || ts.endsWith(`-${slug}`))) {
        matched.add(topic);
        continue;
      }
      // Partial: tag slug is a substring of topic slug or vice versa
      if (tagSlugs.some((ts) => slug.includes(ts) || ts.includes(slug))) {
        matched.add(topic);
      }
    }
    if (matched.size > 0) a.data.topics = Array.from(matched);
  }

  // Identify empty topics after pass 1
  let topicCounts = countTopics(articles, siteTopics);
  let emptyTopics = siteTopics.filter((t) => (topicCounts.get(t) ?? 0) === 0);

  // Pass 2: keyword fill for empty topics
  if (emptyTopics.length > 0) {
    const topicWords = new Map(
      emptyTopics.map((t) => [t, t.toLowerCase().split(/\s+/).filter((w) => w.length > 2)]),
    );
    for (const a of articles) {
      const combined = `${a.data.title ?? ""} ${a.data.description ?? ""} ${(a.data.tags ?? []).join(" ")}`.toLowerCase();
      for (const topic of emptyTopics) {
        const words = topicWords.get(topic);
        if (!words || words.length === 0) continue;
        if (words.some((w) => wordStemInText(w, combined))) {
          if (!a.data.topics) a.data.topics = [];
          if (!a.data.topics.includes(topic)) a.data.topics.push(topic);
        }
      }
    }
  }

  // Recount
  topicCounts = countTopics(articles, siteTopics);
  emptyTopics = siteTopics.filter((t) => (topicCounts.get(t) ?? 0) === 0);

  // Pass 3: forced round-robin — every topic MUST have articles.
  // For truly empty topics with no keyword overlap, distribute articles
  // that currently have the FEWEST topic assignments (to balance load).
  if (emptyTopics.length > 0) {
    const targetPerTopic = Math.max(3, Math.ceil(articles.length / siteTopics.length));

    for (const topic of emptyTopics) {
      // Sort articles: prefer those with fewer existing topics (balance),
      // then by alphabetical slug for determinism
      const candidates = [...articles].sort((a, b) => {
        const aTopics = a.data.topics?.length ?? 0;
        const bTopics = b.data.topics?.length ?? 0;
        if (aTopics !== bTopics) return aTopics - bTopics;
        return (a.file > b.file ? 1 : -1);
      });

      let assigned = 0;
      for (const a of candidates) {
        if (assigned >= targetPerTopic) break;
        if (!a.data.topics) a.data.topics = [];
        if (!a.data.topics.includes(topic)) {
          a.data.topics.push(topic);
          assigned++;
        }
      }
    }
  }

  // Ensure every article has at least one topic
  for (const a of articles) {
    if (!a.data.topics || a.data.topics.length === 0) {
      a.data.topics = [siteTopics[0]];
    }
  }
}

// ── extract site topics from site.yaml ───────────────────────────────

function getSiteTopics(siteYaml) {
  const topics = [];

  if (Array.isArray(siteYaml.topics_v2) && siteYaml.topics_v2.length > 0) {
    for (const t of siteYaml.topics_v2) {
      if (t.name) topics.push(t.name);
    }
  }

  if (topics.length === 0 && siteYaml.brief?.topics) {
    topics.push(...siteYaml.brief.topics);
  }

  return topics;
}

// ── main ─────────────────────────────────────────────────────────────

const sitesDir = join(NETWORK_PATH, "sites");
if (!existsSync(sitesDir)) {
  console.error(`Sites directory not found: ${sitesDir}`);
  process.exit(1);
}

const domains = readdirSync(sitesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let totalUpdated = 0;
let totalArticles = 0;
const siteResults = [];

for (const domain of domains) {
  const siteYamlPath = join(sitesDir, domain, "site.yaml");
  if (!existsSync(siteYamlPath)) continue;

  const siteYaml = parseYaml(readFileSync(siteYamlPath, "utf-8"));
  const siteTopics = getSiteTopics(siteYaml);
  if (siteTopics.length === 0) continue;

  const articlesDir = join(sitesDir, domain, "articles");
  if (!existsSync(articlesDir)) continue;

  const files = readdirSync(articlesDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) continue;

  // Parse all articles — deep-clone data because gray-matter caches and
  // returns shared references for the same input string.
  const articles = [];
  for (const file of files) {
    const filePath = join(articlesDir, file);
    const raw = readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const origTopics = Array.isArray(parsed.data.topics)
      ? [...parsed.data.topics]
      : undefined;
    articles.push({
      file,
      filePath,
      data: parsed.data,
      content: parsed.content,
      origTopics,
    });
  }

  // Run inference
  inferTopics(articles, siteTopics);

  // Write back modified articles
  let updated = 0;
  for (const a of articles) {
    const origStr = JSON.stringify((a.origTopics ?? []).slice().sort());
    const newStr = JSON.stringify((a.data.topics ?? []).slice().sort());

    if (origStr !== newStr) {
      if (!DRY_RUN) {
        const newContent = matter.stringify(a.content, a.data);
        writeFileSync(a.filePath, newContent);
      }
      updated++;
    }
  }

  totalArticles += files.length;
  totalUpdated += updated;

  const topicCounts = countTopics(articles, siteTopics);
  const stillEmpty = siteTopics.filter((t) => (topicCounts.get(t) ?? 0) === 0);

  if (updated > 0 || stillEmpty.length > 0) {
    const topicSummary = siteTopics.map((t) => `${t}(${topicCounts.get(t) ?? 0})`).join(", ");
    siteResults.push({ domain, updated, total: files.length, stillEmpty, topicSummary });
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`BACKFILL TOPICS ${DRY_RUN ? "(DRY RUN)" : ""}`);
console.log(`${"=".repeat(60)}`);
console.log(`Total sites processed: ${domains.length}`);
console.log(`Total articles scanned: ${totalArticles}`);
console.log(`Articles updated: ${totalUpdated}`);
console.log();

for (const r of siteResults) {
  const mark = r.stillEmpty.length > 0 ? "!!" : "OK";
  console.log(`[${mark}] ${r.domain}: ${r.updated}/${r.total} updated | ${r.topicSummary}`);
  if (r.stillEmpty.length > 0) {
    console.log(`     Still empty: ${r.stillEmpty.join(", ")}`);
  }
}

if (siteResults.length === 0) {
  console.log("No changes needed.");
}
