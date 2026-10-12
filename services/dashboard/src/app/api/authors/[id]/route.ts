import { NextResponse, type NextRequest } from "next/server";
import { deleteAuthor, readAuthor, updateAuthor } from "@/lib/authors/store";
import { validateAuthorInput } from "@/lib/authors/record";
import { connectedSitesStrict, withSites } from "@/lib/authors/with-sites";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const author = await readAuthor(id);
  if (!author) return NextResponse.json({ error: "Author not found" }, { status: 404 });
  return NextResponse.json({ author: (await withSites([author]))[0] });
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!(await readAuthor(id))) return NextResponse.json({ error: "Author not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { author?: unknown };
  const v = validateAuthorInput(body.author);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json({ author: await updateAuthor(id, v.value) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Stage 3: an author still on sites can't be deleted (removing them from sites arrives with Stage 4's editing). */
export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const author = await readAuthor(id);
  if (!author) return NextResponse.json({ error: "Author not found" }, { status: 404 });
  let sites: string[];
  try {
    sites = await connectedSitesStrict(id);
  } catch {
    return NextResponse.json({ error: "Can't check which sites use this author right now, so it wasn't deleted. Try again from the production dashboard." }, { status: 503 });
  }
  if (sites.length > 0) {
    return NextResponse.json({ error: "Remove this author from their sites first", sites }, { status: 409 });
  }
  await deleteAuthor(id);
  return NextResponse.json({ ok: true });
}
