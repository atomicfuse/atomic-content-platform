"use client";

interface InheritanceIndicatorProps {
  source: "org" | "group" | "custom" | null;
  groupName?: string;
}

export function InheritanceIndicator({
  source,
  groupName,
}: InheritanceIndicatorProps): React.ReactElement | null {
  if (!source) return null;

  const label = getLabelText(source, groupName);
  const styles = getStyles(source);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${styles}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {label}
    </span>
  );
}

function getLabelText(source: "org" | "group" | "custom", groupName?: string): string {
  switch (source) {
    case "org":
      return "Inherited from org";
    case "group":
      return groupName ? `Inherited from group: ${groupName}` : "Inherited from group";
    case "custom":
      return "Custom";
  }
}

function getStyles(source: "org" | "group" | "custom"): string {
  switch (source) {
    case "org":
      return "text-blue-400 bg-blue-500/10";
    case "group":
      return "text-purple-400 bg-purple-500/10";
    case "custom":
      return "text-green-400 bg-green-500/10";
  }
}
