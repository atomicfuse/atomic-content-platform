import { createHash } from "node:crypto";
import sharp from "sharp";
import { NextResponse, type NextRequest } from "next/server";
import { readFromR2, uploadToR2 } from "@/lib/r2-upload";
import { AUTHOR_ID_RE } from "@/lib/authors/record";

/** Serve a portrait from R2 for the dashboard (sites use their own /authors/assets/* route). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!path.startsWith("/authors/assets/") || path.includes("..")) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  const buf = await readFromR2(path.slice(1));
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
}

/** Upload a real photo: square-cropped 512 px WebP, content-hashed name. Not saved to the author until Save. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const authorId = String(form?.get("authorId") ?? "");
  if (!(file instanceof Blob) || !AUTHOR_ID_RE.test(authorId)) return NextResponse.json({ error: "file and authorId are required" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Image must be under 8 MB" }, { status: 400 });
  try {
    const webp = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
    const key = `authors/assets/${authorId}-${createHash("sha256").update(webp).digest("hex").slice(0, 10)}.webp`;
    if (!(await uploadToR2(key, webp, "image/webp"))) return NextResponse.json({ error: "Upload failed" }, { status: 502 });
    return NextResponse.json({ portrait: { kind: "uploaded", path: `/${key}` } });
  } catch {
    return NextResponse.json({ error: "That file isn't an image we can read" }, { status: 400 });
  }
}
