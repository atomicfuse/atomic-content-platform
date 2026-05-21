import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { domain, slug, title, branch } = (await req.json()) as {
    domain: string;
    slug: string;
    title: string;
    branch?: string;
  };

  if (!domain || !slug || !title) {
    return NextResponse.json({ error: "domain, slug, title required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${getAgentUrl()}/trigger-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteDomain: domain,
        slug,
        articleTitle: title,
        branch: branch ?? `staging/${domain}`,
      }),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach content pipeline";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
