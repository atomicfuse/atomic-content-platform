import { NextRequest, NextResponse } from "next/server";
import { readFileBase64, readDashboardIndex } from "@/lib/github";

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

  const branch = site.staging_branch ?? undefined;
  const path = `sites/${domain}/${file}`;
  const base64 = await readFileBase64(path, branch);

  if (!base64) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  const ext = file.split(".").pop()?.toLowerCase() ?? "png";
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const buffer = Buffer.from(base64, "base64");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-cache",
    },
  });
}
