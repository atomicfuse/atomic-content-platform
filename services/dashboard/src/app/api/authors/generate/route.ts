import { NextResponse, type NextRequest } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";
import { listAuthors } from "@/lib/authors/store";

/**
 * The pipeline refuses generated names already in use. The browser's list comes from page load, so the library's
 * current names are added here (except the name being replaced, so an author can keep their own).
 */
async function withLibraryNames(raw: string): Promise<string> {
  let parsed: { takenNames?: unknown; draft?: { name?: unknown } };
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { return raw; }
  if (!parsed || typeof parsed !== "object") return raw;
  const own = typeof parsed.draft?.name === "string" ? parsed.draft.name.trim().toLowerCase() : "";
  const fromClient = Array.isArray(parsed.takenNames) ? parsed.takenNames.filter((n): n is string => typeof n === "string") : [];
  const library = (await listAuthors().catch(() => [])).map((a) => a.name).filter((n) => n.toLowerCase() !== own);
  const seen = new Set<string>();
  const takenNames = [...fromClient, ...library].filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return JSON.stringify({ ...parsed, takenNames });
}

/** Proxy to the pipeline: one profile part per request (each well under the ~60 s gateway limit). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await withLibraryNames(await req.text());
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
    return NextResponse.json({ status: "error", message: timedOut ? "Generation took too long. Try again." : String(err) }, { status: 504 });
  }
}
