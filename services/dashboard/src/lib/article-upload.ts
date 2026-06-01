import { parse as parseYaml } from "yaml";

export interface ParsedArticle {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(markdown: string): ParsedArticle | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const frontmatter = parseYaml(match[1]!) as Record<string, unknown>;
    return { frontmatter, body: match[2] ?? "" };
  } catch {
    return null;
  }
}

const REQUIRED_FIELDS = ["title", "slug"] as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateArticleFrontmatter(
  fm: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!fm[field] || (typeof fm[field] === "string" && !(fm[field] as string).trim())) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (fm.slug && typeof fm.slug === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.slug)) {
    errors.push("slug must be kebab-case (lowercase letters, numbers, hyphens)");
  }

  if (!fm.status) warnings.push("No status field — will default to 'draft'");
  if (!fm.publishDate) warnings.push("No publishDate — will default to today");
  if (!fm.author) warnings.push("No author — will default to 'Editorial Team'");
  if (!fm.description) warnings.push("No description — recommended for SEO");
  if (!fm.tags || !Array.isArray(fm.tags) || fm.tags.length === 0) {
    warnings.push("No tags — recommended for categorization");
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function slugFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildArticlePath(domain: string, slug: string): string {
  return `sites/${domain}/articles/${slug}.md`;
}

export function buildImageR2Key(domain: string, slug: string, ext: string): string {
  return `${domain}/assets/images/${slug}.${ext}`;
}

export function buildImageFrontmatterPath(slug: string, ext: string): string {
  return `/assets/images/${slug}.${ext}`;
}
