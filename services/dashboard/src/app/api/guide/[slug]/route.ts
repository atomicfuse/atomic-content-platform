import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Guide markdown lives in public/ so Next.js standalone output bundles it.
// process.cwd() is services/dashboard/ in dev and the standalone root in prod,
// both of which contain public/guide/.
const GUIDE_DIR = join(process.cwd(), "public", "guide");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  try {
    const filePath = join(GUIDE_DIR, `${slug}.md`);
    const content = await readFile(filePath, "utf-8");
    return NextResponse.json({ slug, content });
  } catch {
    return NextResponse.json(
      { error: "Guide page not found" },
      { status: 404 },
    );
  }
}
