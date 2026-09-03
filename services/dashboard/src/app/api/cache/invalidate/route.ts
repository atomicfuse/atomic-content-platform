import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

const SECRET = process.env.CACHE_INVALIDATE_SECRET;

export async function POST(req: Request): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!SECRET || authHeader !== `Bearer ${SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { domain?: string; branch?: string };
  if (!body.domain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }

  // With MongoDB reads, no in-memory caches to invalidate.
  // Revalidate Next.js page cache so subsequent renders fetch fresh data.
  revalidatePath(`/sites/${body.domain}`);
  console.log(`[cache/invalidate] Revalidated path for ${body.domain}`);

  return NextResponse.json({ ok: true });
}
