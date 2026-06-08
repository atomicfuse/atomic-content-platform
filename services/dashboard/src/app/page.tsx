import { readDashboardIndex } from "@/lib/github";
import type { DashboardIndex } from "@/types/dashboard";
import OpsDashboard from "@/components/ops/OpsDashboard";

/** Cache page output for 60s — navigating back within the window is instant. */
export const revalidate = 60;

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3001";
  try {
    const resp = await fetch(`${base}${path}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return {};
    return await resp.json();
  } catch {
    return {};
  }
}

/** Read dashboard-index with a strict timeout so rate limits don't block the page. */
async function safeReadIndex(): Promise<DashboardIndex> {
  try {
    return await Promise.race([
      readDashboardIndex(),
      new Promise<DashboardIndex>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5_000),
      ),
    ]);
  } catch {
    return { sites: [] };
  }
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const [index, stats, checks, costs, attention, r2] = await Promise.all([
    safeReadIndex(),
    fetchJson("/api/site-stats"),
    fetchJson("/api/site-checks"),
    fetchJson("/api/site-costs"),
    fetchJson("/api/attention"),
    fetchJson("/api/r2-usage"),
  ]);

  return (
    <OpsDashboard
      initialIndex={index.sites}
      initialStats={stats as never}
      initialChecks={checks as never}
      initialCosts={costs as never}
      initialAttention={attention as never}
      initialR2={r2 as never}
    />
  );
}
