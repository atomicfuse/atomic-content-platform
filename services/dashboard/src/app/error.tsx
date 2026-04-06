"use client";

import { Button } from "@/components/ui/Button";

interface ErrorPageProps {
  error: Error;
  reset: () => void;
}

export default function ErrorPage({
  error,
  reset,
}: ErrorPageProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <h1 className="text-2xl font-bold text-error">Something went wrong</h1>
      <p className="text-[var(--text-secondary)] max-w-md text-center">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button onClick={reset}>Try Again</Button>
    </div>
  );
}
