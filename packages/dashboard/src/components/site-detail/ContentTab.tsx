import type { ArticleEntry } from "@/types/dashboard";
import { Badge } from "@/components/ui/Badge";

interface ContentTabProps {
  articles: ArticleEntry[];
  domain: string;
}

function scoreColor(score: number | undefined): string {
  if (score === undefined) return "text-[var(--text-muted)]";
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

function statusVariant(
  status: string
): "success" | "warning" | "error" | "default" {
  switch (status) {
    case "published":
      return "success";
    case "review":
      return "warning";
    case "draft":
      return "default";
    default:
      return "default";
  }
}

export function ContentTab({
  articles,
  domain,
}: ContentTabProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          Articles ({articles.length})
        </h3>
      </div>

      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-secondary)]">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Title
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Score
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Published
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Preview
              </th>
            </tr>
          </thead>
          <tbody>
            {articles.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No articles yet
                </td>
              </tr>
            )}
            {articles.map((article) => (
              <tr
                key={article.slug}
                className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
              >
                <td className="px-4 py-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
                  {article.title}
                </td>
                <td className="px-4 py-3">
                  <Badge label={article.type} variant="info" />
                </td>
                <td className={`px-4 py-3 font-mono text-sm ${scoreColor(article.score)}`}>
                  {article.score !== undefined ? article.score : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    label={article.status}
                    variant={statusVariant(article.status)}
                  />
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {article.publishDate
                    ? new Date(article.publishDate).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <a
                    href={`https://${domain}/${article.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan hover:underline text-xs"
                  >
                    Preview
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
