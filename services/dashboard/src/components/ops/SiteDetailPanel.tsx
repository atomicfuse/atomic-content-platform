"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OpsRow } from "@/lib/ops-helpers";

interface SiteDetailPanelProps {
  row: OpsRow;
}

export function SiteDetailPanel({ row }: SiteDetailPanelProps): React.ReactElement {
  const router = useRouter();
  const [reseeding, setReseeding] = useState(false);
  const [reseedMsg, setReseedMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleReseed(): Promise<void> {
    setReseeding(true);
    setReseedMsg(null);
    try {
      const resp = await fetch("/api/sites/reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: row.domain }),
      });
      const data = await resp.json();
      setReseedMsg({ ok: resp.ok, text: data.message ?? data.error ?? "Unknown result" });
    } catch (err) {
      setReseedMsg({ ok: false, text: String(err) });
    } finally {
      setReseeding(false);
    }
  }

  return (
    <div className="bg-page border-t-2 border-primary p-4">
      <div className="grid grid-cols-5 gap-3.5">
        {/* Schedule */}
        <div className="bg-card border border-card-border rounded-xl p-3.5 shadow-card">
          <div className="text-primary text-[10px] uppercase font-bold tracking-wider mb-2.5">Schedule</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Days: <span className="text-primary-text font-medium">{row.schedule?.preferredDays.join(", ") ?? "—"}</span></div>
            <div>Per day: <span className="text-primary-text font-medium">{row.schedule?.articlesPerDay ?? "—"}</span></div>
            <div>Next run: <span className="text-primary-text font-medium">{row.schedule?.nextRun ? new Date(row.schedule.nextRun).toLocaleString() : "—"}</span></div>
          </div>
        </div>

        {/* Failed Articles */}
        <div className="bg-card border border-error-border rounded-xl p-3.5 shadow-card">
          <div className="text-error text-[10px] uppercase font-bold tracking-wider mb-2.5">Failed Articles</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Last 7d: <span className="text-error font-bold">{row.failedArticles7d}</span></div>
            <div>Last 30d: <span className="text-warning font-semibold">{row.failedArticles30d}</span></div>
          </div>
        </div>

        {/* Image Gen Failed */}
        <div className="bg-card border border-warning-border rounded-xl p-3.5 shadow-card">
          <div className="text-warning text-[10px] uppercase font-bold tracking-wider mb-2.5">Image Gen Failed</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Last 7d: <span className="text-warning font-bold">{row.imageGenFailed7d}</span></div>
            <div>Last 30d: <span className="text-secondary">{row.imageGenFailed30d}</span></div>
          </div>
        </div>

        {/* Checks */}
        <div className="bg-card border border-card-border rounded-xl p-3.5 shadow-card">
          <div className="text-primary text-[10px] uppercase font-bold tracking-wider mb-2.5">Checks</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Uptime: <span className={row.uptime.ok ? "text-success" : "text-error"}>● {row.uptime.ok ? "Up" : "Down"}{row.uptime.responseTimeMs != null ? ` (${row.uptime.responseTimeMs}ms)` : ""}</span></div>
            <div>Sync: <span className={row.sync.ok ? "text-success" : "text-error"}>● {row.sync.ok ? "OK" : "Fail"}</span>{row.sync.syncedAt ? <span className="text-[9px] ml-1">{new Date(row.sync.syncedAt).toLocaleString()}</span> : null}</div>
            <div>SSL: <span className={row.ssl.status === "active" ? "text-success" : "text-secondary"}>{row.ssl.status === "active" ? "✓ active" : row.ssl.state}</span>{row.ssl.daysLeft != null ? <span className="text-[9px] ml-1">{row.ssl.daysLeft}d left</span> : null}</div>
            <div>GA4: <Dot ok={row.tracking.ga4} /> GTM: <Dot ok={row.tracking.gtm} /> Pixel: <Dot ok={row.tracking.pixel} /></div>
          </div>
        </div>

        {/* Recent Articles */}
        <div className="bg-card border border-primary-border rounded-xl p-3.5 shadow-card">
          <div className="text-primary text-[10px] uppercase font-bold tracking-wider mb-2.5">Recent Articles</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            {row.recentArticles.length === 0 && <div>—</div>}
            {row.recentArticles.map((a) => (
              <div key={a.slug} className="truncate">
                <span className="text-primary-text">{a.title}</span>
                {" · "}
                <span className={a.score != null && a.score >= 75 ? "text-success font-semibold" : "text-warning font-semibold"}>{a.score ?? "—"}</span>
                {" · "}{a.status}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-4 pt-3.5 border-t border-divider flex gap-2.5">
        <button onClick={() => router.push(`/sites/${row.domain}`)} className="px-3.5 py-1.5 bg-primary text-white rounded-lg text-[11px] font-medium cursor-pointer hover:bg-primary-hover">View Site →</button>
        <button onClick={() => router.push(`/sites/${row.domain}?tab=content&filter=review`)} className="px-3.5 py-1.5 bg-card border border-primary-border text-primary rounded-lg text-[11px] font-medium cursor-pointer">Review Queue →</button>
        <button onClick={handleReseed} disabled={reseeding} className="px-3.5 py-1.5 bg-card border border-primary-border text-primary rounded-lg text-[11px] font-medium cursor-pointer disabled:opacity-50">
          {reseeding ? "Seeding..." : "Re-seed KV"}
        </button>
        <button onClick={() => router.push(`/general-images?site=${row.domain}`)} className="px-3.5 py-1.5 bg-card border border-primary-border text-primary rounded-lg text-[11px] font-medium cursor-pointer">Generate Images →</button>
        {reseedMsg && (
          <span className={`text-[11px] self-center ml-2 ${reseedMsg.ok ? "text-success" : "text-error"}`}>{reseedMsg.text}</span>
        )}
      </div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }): React.ReactElement {
  return <span className={ok ? "text-success" : "text-muted"}>●</span>;
}
