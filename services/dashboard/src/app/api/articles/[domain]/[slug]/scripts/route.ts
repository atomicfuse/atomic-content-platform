import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import { readFileContent, readDashboardIndex, commitNetworkFiles } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";

interface RouteParams {
  params: Promise<{ domain: string; slug: string }>;
}

const MAX_SCRIPTS = 20;
const MAX_CONTENT_SIZE = 50 * 1024; // 50 KB
const POSITION_RE = /^(head|before-content|after-content|after-paragraph-\d+)$/;

interface ScriptInput {
  id: string;
  name: string;
  position: string;
  content: string;
}

function validateScripts(scripts: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(scripts)) {
    return { valid: false, errors: ["scripts must be an array"] };
  }
  if (scripts.length > MAX_SCRIPTS) {
    errors.push(`Maximum ${MAX_SCRIPTS} scripts per article`);
  }

  const ids = new Set<string>();
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i] as ScriptInput;
    const prefix = `scripts[${i}]`;

    if (!s.id || typeof s.id !== "string") {
      errors.push(`${prefix}: id is required`);
    } else if (ids.has(s.id)) {
      errors.push(`${prefix}: duplicate id "${s.id}"`);
    } else {
      ids.add(s.id);
    }

    if (!s.name || typeof s.name !== "string") {
      errors.push(`${prefix}: name is required`);
    } else if (s.name.length > 100) {
      errors.push(`${prefix}: name exceeds 100 characters`);
    }

    if (!s.position || typeof s.position !== "string" || !POSITION_RE.test(s.position)) {
      errors.push(`${prefix}: position must be head, before-content, after-content, or after-paragraph-N`);
    }

    if (!s.content || typeof s.content !== "string") {
      errors.push(`${prefix}: content is required`);
    } else {
      if (!/<script/i.test(s.content)) {
        errors.push(`${prefix}: content must contain a <script tag`);
      }
      if (s.content.length > MAX_CONTENT_SIZE) {
        errors.push(`${prefix}: content exceeds 50 KB`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function PUT(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);

  let body: { scripts: unknown };
  try {
    body = (await req.json()) as { scripts: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate scripts
  const validation = validateScripts(body.scripts);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 400 },
    );
  }

  // Look up staging branch
  const index = await readDashboardIndex();
  const site = index.sites?.find((s) => s.domain === decodedDomain);
  const stagingBranch = site?.staging_branch;

  if (!stagingBranch) {
    return NextResponse.json(
      { error: `No staging branch found for ${decodedDomain}` },
      { status: 400 },
    );
  }

  // Read current article
  const articlePath = buildArticlePath(decodedDomain, slug);
  const content = await readFileContent(articlePath, stagingBranch);

  if (content === null) {
    return NextResponse.json(
      { error: `Article "${slug}" not found on ${stagingBranch}` },
      { status: 404 },
    );
  }

  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse article frontmatter" },
      { status: 500 },
    );
  }

  // Update scripts field only
  const fm = { ...parsed.frontmatter };
  const scripts = body.scripts as ScriptInput[];
  if (scripts.length === 0) {
    delete fm.scripts;
  } else {
    fm.scripts = scripts;
  }

  // Reconstruct markdown
  const yamlStr = stringifyYaml(fm, { lineWidth: 0 }).trim();
  const finalMarkdown = `---\n${yamlStr}\n---\n${parsed.body}`;

  // Commit
  await commitNetworkFiles(
    [{ path: articlePath, content: finalMarkdown }],
    `feat(content): update scripts for ${slug} on ${decodedDomain}`,
    stagingBranch,
  );

  return NextResponse.json({
    status: "updated",
    slug,
    scripts: fm.scripts ?? [],
  });
}
