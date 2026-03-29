import Link from "next/link";

export default function SiteNotFound(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <h1 className="text-2xl font-bold">Site Not Found</h1>
      <p className="text-[var(--text-secondary)]">
        This domain doesn&apos;t exist in the dashboard index.
      </p>
      <Link href="/" className="text-cyan hover:underline">
        Back to Dashboard
      </Link>
    </div>
  );
}
