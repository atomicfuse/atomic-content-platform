import { NextResponse, type NextRequest } from "next/server";
import { createAuthor, listAuthors } from "@/lib/authors/store";
import { validateAuthorInput } from "@/lib/authors/record";
import { withSites } from "@/lib/authors/with-sites";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ authors: await withSites(await listAuthors()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { author?: unknown };
  const v = validateAuthorInput(body.author);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json({ author: await createAuthor(v.value) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
