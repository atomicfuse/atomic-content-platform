import { NextResponse, type NextRequest } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";

/** Proxy to the pipeline: one profile part per request (each well under the ~60 s gateway limit). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  try {
    const res = await fetch(`${getAgentUrl()}/authors/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(55_000),
    });
    const out = (await res.json().catch(() => ({ status: "error", message: `pipeline returned ${res.status}` }))) as Record<string, unknown>;
    return NextResponse.json(out, { status: res.status });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json({ status: "error", message: timedOut ? "Generation took too long — try again" : String(err) }, { status: 504 });
  }
}
