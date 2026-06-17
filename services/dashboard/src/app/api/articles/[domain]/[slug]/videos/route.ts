import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import { readFileContent, readDashboardIndex, commitNetworkFiles } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";
import { upsertArticleMeta } from "@/lib/db/articles";

interface RouteParams {
  params: Promise<{ domain: string; slug: string }>;
}

const MAX_VIDEOS = 10;
const POSITION_RE = /^(before-content|after-content|after-paragraph-\d+)$/;
const YOUTUBE_RE = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)/;

interface VideoInput {
  id: string;
  url: string;
  position: string;
}

function validateVideos(videos: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(videos)) {
    return { valid: false, errors: ["videos must be an array"] };
  }
  if (videos.length > MAX_VIDEOS) {
    errors.push(`Maximum ${MAX_VIDEOS} videos per article`);
  }

  const ids = new Set<string>();
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i] as VideoInput;
    const prefix = `videos[${i}]`;

    if (!v.id || typeof v.id !== "string") {
      errors.push(`${prefix}: id is required`);
    } else if (ids.has(v.id)) {
      errors.push(`${prefix}: duplicate id "${v.id}"`);
    } else {
      ids.add(v.id);
    }

    if (!v.url || typeof v.url !== "string") {
      errors.push(`${prefix}: url is required`);
    } else if (!YOUTUBE_RE.test(v.url)) {
      errors.push(`${prefix}: url must be a valid YouTube URL`);
    }

    if (!v.position || typeof v.position !== "string" || !POSITION_RE.test(v.position)) {
      errors.push(`${prefix}: position must be before-content, after-content, or after-paragraph-N`);
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

  let body: { videos: unknown };
  try {
    body = (await req.json()) as { videos: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate videos
  const validation = validateVideos(body.videos);
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

  // Update videos field only
  const fm = { ...parsed.frontmatter };
  const videos = body.videos as VideoInput[];
  if (videos.length === 0) {
    delete fm.videos;
  } else {
    fm.videos = videos;
  }

  // Reconstruct markdown
  const yamlStr = stringifyYaml(fm, { lineWidth: 0 }).trim();
  const finalMarkdown = `---\n${yamlStr}\n---\n${parsed.body}`;

  // Commit
  await commitNetworkFiles(
    [{ path: articlePath, content: finalMarkdown }],
    `feat(content): update videos for ${slug} on ${decodedDomain}`,
    stagingBranch,
  );

  // Dual-write to MongoDB (soft-fail)
  await upsertArticleMeta(decodedDomain, slug, stagingBranch, { videos: fm.videos ?? [] });

  return NextResponse.json({
    status: "updated",
    slug,
    videos: fm.videos ?? [],
  });
}
