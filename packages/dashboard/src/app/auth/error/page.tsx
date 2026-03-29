import Link from "next/link";

export default function AuthErrorPage(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-error">Access Denied</h1>
        <p className="text-[var(--text-secondary)]">
          Only @atomiclabs.io email addresses can access this dashboard.
        </p>
        <Link
          href="/auth/signin"
          className="inline-block text-cyan hover:underline"
        >
          Try again
        </Link>
      </div>
    </div>
  );
}
