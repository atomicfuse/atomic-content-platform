import type { ActivityEvent } from "@/types/dashboard";

const EVENT_COLORS: Record<ActivityEvent["type"], string> = {
  article_published: "bg-green-400",
  build_failed: "bg-red-400",
  article_flagged: "bg-yellow-400",
  site_created: "bg-cyan",
  override_activated: "bg-magenta",
};

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
}

export function ActivityFeed({ events }: ActivityFeedProps): React.ReactElement {
  return (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-5">
      <h3 className="text-sm font-bold text-[var(--text-primary)] mb-4">
        Recent Activity
      </h3>
      <div className="space-y-3">
        {events.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No recent activity</p>
        )}
        {events.map((event) => (
          <div key={event.id} className="flex items-start gap-3">
            <span
              className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${EVENT_COLORS[event.type]}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--text-primary)] truncate">
                {event.description}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {formatRelativeTime(event.timestamp)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
