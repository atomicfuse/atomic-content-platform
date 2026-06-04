import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex } from "@/lib/github";
import { readFromR2 } from "@/lib/r2-upload";

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  const file = req.nextUrl.searchParams.get("file");

  if (!domain || !file) {
    return NextResponse.json({ error: "domain and file required" }, { status: 400 });
  }

  // Sanitize file path — only allow assets subdirectory
  if (!file.startsWith("assets/") || file.includes("..")) {
    return NextResponse.json({ error: "invalid file path" }, { status: 400 });
  }

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  // Assets are R2-native (logos/favicons live in R2, not git). The Worker
  // serves them at /<siteId>/assets/<file>; the R2 key is <domain>/<file>.
  const buffer = await readFromR2(`${domain}/${file}`, domain);

  if (!buffer) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  const ext = file.split(".").pop()?.toLowerCase() ?? "png";
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-cache",
    },
  });
}
