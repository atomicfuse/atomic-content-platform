// services/dashboard/src/app/api/agent/generate-dedicated/route.ts
import { NextRequest, NextResponse } from "next/server";
import { invalidateSiteCaches } from "@/lib/github";
import { revalidatePath } from "next/cache";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

/**
 * POST /api/agent/generate-dedicated
 *
 * Proxies to content-pipeline's /content-generate-dedicated endpoint.
 * Generates a single article based on a user-supplied prompt rather
 * than sourcing from the content aggregator.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteDomain: string;
    branch?: string | null;
    userPrompt: string;
  };

  if (!body.siteDomain) {
    return NextResponse.json(
      { status: "error", message: "siteDomain is required" },
      { status: 400 },
    );
  }

  if (!body.userPrompt || body.userPrompt.trim().length === 0) {
    return NextResponse.json(
      { status: "error", message: "userPrompt is required and must be non-empty" },
      { status: 400 },
    );
  }

  const branch = body.branch ?? `staging/${body.siteDomain}`;

  const agentUrl = getAgentUrl();
  try {
    const agentResponse = await fetch(`${agentUrl}/content-generate-dedicated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteDomain: body.siteDomain,
        branch,
        userPrompt: body.userPrompt.trim(),
      }),
    });
    const raw = (await agentResponse.json()) as Record<string, unknown>;
    if (agentResponse.ok) {
      invalidateSiteCaches(body.siteDomain, branch);
      revalidatePath(`/sites/${encodeURIComponent(body.siteDomain)}`);
    }

    // The dedicated agent returns a flat result ({ status, slug, ... }).
    // The UI expects the same shape as the regular generate endpoint:
    // { siteDomain, results: [{ status, slug, ... }] }
    // Wrap it so ContentGenerationPanel can handle both flows identically.
    const wrapped = {
      siteDomain: body.siteDomain,
      results: [raw],
    };
    return NextResponse.json(wrapped, { status: agentResponse.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running?`,
      },
      { status: 502 },
    );
  }
}
