import Link from "next/link";

const TABS = [
  { label: "Overrides", href: "/overrides" },
  { label: "Shared Pages", href: "/overrides/shared-pages" },
] as const;

export default function OverridesLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overrides</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Targeted config exceptions and shared page management
        </p>
      </div>

      <nav className="flex gap-1 border-b border-[var(--border-secondary)]">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="px-4 py-2.5 text-sm font-semibold transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] relative"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div>{children}</div>
    </div>
  );
}
