import { NextResponse } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";

/**
 * Start the Grid AI-summary job now instead of waiting for the hourly cron (:30).
 * The pipeline runs it in the background and answers at once with
 * "started" or "already_running"; the job covers every Grid site in AI-summary mode.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const res = await fetch(`${getAgentUrl()}/grid-summaries`, { signal: AbortSignal.timeout(15_000) });
    const out = (await res.json().catch(() => ({}))) as { status?: unknown };
    if (!res.ok || (out.status !== "started" && out.status !== "already_running")) {
      return NextResponse.json({ ok: false, error: `pipeline answered ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, status: out.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
