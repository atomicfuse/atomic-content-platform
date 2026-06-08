import { readDashboardIndex } from "@/lib/github";
import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const OpsDashboard = nextDynamic(() => import("@/components/ops/OpsDashboard"), {
  ssr: false,
  loading: () => <div className="p-8 text-secondary text-center">Loading ops dashboard...</div>,
});

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3001";
  try {
    const resp = await fetch(`${base}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return {};
    return await resp.json();
  } catch {
    return {};
  }
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const [index, stats, checks, costs, attention, r2] = await Promise.all([
    readDashboardIndex(),
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
