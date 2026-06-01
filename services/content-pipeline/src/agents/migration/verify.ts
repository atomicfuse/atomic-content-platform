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

interface VerificationCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface VerificationReport {
  site: string;
  totalArticles: number;
  checks: VerificationCheck[];
  passed: boolean;
}

export function verifyMigrationFiles(
  site: string,
  mdContents: Array<{ path: string; content: string }>,
  expectedSlugs: string[],
  menuItems: string[],
): VerificationReport {
  const checks: VerificationCheck[] = [];

  // Parse all files once upfront
  const parsed = mdContents.map((f) => ({
    path: f.path,
    ...matter(f.content),
  }));

  // 1. Article count
  const countMatch = parsed.length === expectedSlugs.length;
  checks.push({
    name: "Article count match",
    passed: countMatch,
    details: countMatch ? undefined : `Expected ${expectedSlugs.length}, got ${parsed.length}`,
  });

  // 2. Slug integrity
  const fileSlugs = new Set(parsed.map((f) => f.path.split("/").pop()?.replace(".md", "")));
  const missingSlugs = expectedSlugs.filter((s) => !fileSlugs.has(s));
  checks.push({
    name: "Slug integrity",
    passed: missingSlugs.length === 0,
    details: missingSlugs.length > 0 ? `Missing: ${missingSlugs.slice(0, 5).join(", ")}` : undefined,
  });

  // 3. Frontmatter completeness
  let frontmatterErrors = 0;
  for (const file of parsed) {
    if (validateArticleFrontmatter(file.data).length > 0) frontmatterErrors++;
  }
  checks.push({
    name: "Frontmatter completeness",
    passed: frontmatterErrors === 0,
    details: frontmatterErrors > 0 ? `${frontmatterErrors} articles with missing fields` : undefined,
  });

  // 4. No empty bodies
  const emptyBodies = parsed.filter((f) => f.content.trim().length < 100);
  checks.push({
    name: "No empty bodies",
    passed: emptyBodies.length === 0,
    details: emptyBodies.length > 0 ? `${emptyBodies.length} articles with <100 chars body` : undefined,
  });

  // 5. Category coverage — every article should have at least one tag matching a menu item
  const menuLower = new Set(menuItems.map((m) => m.toLowerCase()));
  const unmapped = parsed.filter((f) => {
    const tags = (f.data.tags as string[]) ?? [];
    return tags.length === 0 || !tags.some((t) => menuLower.has(t.toLowerCase()));
  });
  checks.push({
    name: "Category coverage",
    passed: unmapped.length === 0,
    details: unmapped.length > 0 ? `${unmapped.length} articles with no matching menu category` : undefined,
  });

  // 6. No duplicate slugs
  const slugs = parsed.map((f) => f.data.slug as string);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  checks.push({
    name: "No duplicate slugs",
    passed: dupes.length === 0,
    details: dupes.length > 0 ? `Duplicates: ${[...new Set(dupes)].join(", ")}` : undefined,
  });

  return {
    site,
    totalArticles: parsed.length,
    checks,
    passed: checks.every((c) => c.passed),
  };
}
