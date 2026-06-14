"use client";

import { useEffect, useState } from "react";

interface DayCell {
  expected: number;
  created: number;
}

interface SiteSummary {
  domain: string;
  days: DayCell[];
  needReview: number;
}

interface SchedulerSummaryData {
  weekOf: string;
  timezone: string;
  days: string[];
  sites: SiteSummary[];
}

function formatWeekRange(weekOf: string): string {
  const sunday = new Date(weekOf + "T00:00:00Z");
  const saturday = new Date(sunday.getTime() + 6 * 86_400_000);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(sunday)} – ${fmt.format(saturday)}`;
}

function cellColor(cell: DayCell): string {
  if (cell.expected === 0 && cell.created === 0) return "text-zinc-400 dark:text-zinc-600";
  if (cell.created === 0 && cell.expected > 0) return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950";
  if (cell.created > 0 && cell.created < cell.expected) return "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950";
  return "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950";
}

function reviewColor(count: number): string {
  if (count === 0) return "text-zinc-400 dark:text-zinc-600";
  return "text-amber-600 dark:text-amber-400";
}

export default function SchedulerSummaryPage(): React.ReactElement {
  const [data, setData] = useState<SchedulerSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scheduler-summary")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<SchedulerSummaryData>;
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-zinc-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-4">Scheduler Summary</h1>
        <p className="text-red-600 dark:text-red-400">Failed to load: {error}</p>
      </div>
    );
  }

  if (!data) return <></>;

  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Scheduler Summary</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Week of {formatWeekRange(data.weekOf)} ({data.timezone})
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left py-2 px-3 font-medium">Site</th>
              {DAY_SHORT.map((d) => (
                <th key={d} className="text-center py-2 px-2 font-medium w-16">{d}</th>
              ))}
              <th className="text-center py-2 px-3 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {data.sites.map((site) => (
              <tr key={site.domain} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <td className="py-1.5 px-3 font-mono text-xs">{site.domain}</td>
                {site.days.map((cell, i) => (
                  <td key={i} className={`text-center py-1.5 px-2 font-mono text-xs ${cellColor(cell)}`}>
                    {cell.created}/{cell.expected}
                  </td>
                ))}
                <td className={`text-center py-1.5 px-3 font-mono text-xs font-medium ${reviewColor(site.needReview)}`}>
                  {site.needReview}
                </td>
              </tr>
            ))}
            {data.sites.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-zinc-400">
                  No data yet — scheduler hasn&apos;t run this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
