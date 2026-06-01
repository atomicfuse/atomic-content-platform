import { ReviewQueueClient } from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

export default function ReviewQueuePage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Review Queue</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Articles flagged by the quality agent for human review
        </p>
      </div>

      <ReviewQueueClient />
    </div>
  );
}
