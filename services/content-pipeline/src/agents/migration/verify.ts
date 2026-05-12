import matter from "gray-matter";

const REQUIRED_FIELDS = ["title", "description", "slug", "publishDate", "author", "tags", "status", "type"];

export function validateArticleFrontmatter(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (typeof data.description === "string" && data.description.length === 0) {
    errors.push("Empty description — SEO risk");
  }

  if (typeof data.slug === "string" && !/^[a-z0-9][a-z0-9-]*$/.test(data.slug)) {
    errors.push(`Invalid slug format: ${data.slug}`);
  }

  return errors;
}

export interface VerificationReport {
  site: string;
  totalArticles: number;
  checks: Array<{ name: string; passed: boolean; details?: string }>;
  passed: boolean;
}

export function verifyMigrationFiles(
  mdContents: Array<{ path: string; content: string }>,
  expectedSlugs: string[],
  menuItems: string[],
): VerificationReport {
  const checks: Array<{ name: string; passed: boolean; details?: string }> = [];

  // Check 1: Article count
  const countMatch = mdContents.length === expectedSlugs.length;
  checks.push({
    name: "Article count match",
    passed: countMatch,
    details: countMatch ? undefined : `Expected ${expectedSlugs.length}, got ${mdContents.length}`,
  });

  // Check 2: Slug integrity
  const fileSlugs = new Set(mdContents.map((f) => f.path.split("/").pop()?.replace(".md", "")));
  const missingSlugs = expectedSlugs.filter((s) => !fileSlugs.has(s));
  checks.push({
    name: "Slug integrity",
    passed: missingSlugs.length === 0,
    details: missingSlugs.length > 0 ? `Missing: ${missingSlugs.slice(0, 5).join(", ")}` : undefined,
  });

  // Check 3: Frontmatter completeness
  let frontmatterErrors = 0;
  for (const file of mdContents) {
    const { data } = matter(file.content);
    const errors = validateArticleFrontmatter(data);
    if (errors.length > 0) frontmatterErrors++;
  }
  checks.push({
    name: "Frontmatter completeness",
    passed: frontmatterErrors === 0,
    details: frontmatterErrors > 0 ? `${frontmatterErrors} articles with missing fields` : undefined,
  });

  // Check 4: No empty bodies
  const emptyBodies = mdContents.filter((f) => matter(f.content).content.trim().length < 100);
  checks.push({
    name: "No empty bodies",
    passed: emptyBodies.length === 0,
    details: emptyBodies.length > 0 ? `${emptyBodies.length} articles with <100 chars body` : undefined,
  });

  // Check 5: Category coverage
  const noTags = mdContents.filter((f) => {
    const { data } = matter(f.content);
    const tags = (data.tags as string[]) ?? [];
    return tags.length === 0 || !tags.some((t) => menuItems.map((m) => m.toLowerCase()).includes(t.toLowerCase()));
  });
  checks.push({
    name: "Category coverage",
    passed: noTags.length === 0,
    details: noTags.length > 0 ? `${noTags.length} articles with no matching menu category` : undefined,
  });

  // Check 6: No duplicate slugs
  const slugs = mdContents.map((f) => matter(f.content).data.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  checks.push({
    name: "No duplicate slugs",
    passed: dupes.length === 0,
    details: dupes.length > 0 ? `Duplicates: ${[...new Set(dupes)].join(", ")}` : undefined,
  });

  return {
    site: "",
    totalArticles: mdContents.length,
    checks,
    passed: checks.every((c) => c.passed),
  };
}
