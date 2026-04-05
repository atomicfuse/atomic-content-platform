import { getReviewQueue } from "@/actions/review";
import { ReviewQueueClient } from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage(): Promise<React.ReactElement> {
  const articles = await getReviewQueue();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Review Queue</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Articles flagged by the quality agent for human review
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
          <svg className="w-12 h-12 text-green-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[var(--text-secondary)] font-medium">
            All clear! No articles pending review.
          </p>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Articles scoring below the site threshold will appear here.
          </p>
        </div>
      ) : (
        <ReviewQueueClient articles={articles} />
      )}
    </div>
  );
}
