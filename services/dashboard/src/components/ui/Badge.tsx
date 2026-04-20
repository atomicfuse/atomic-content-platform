import type { SiteStatus } from "@/types/dashboard";
import { STATUS_CONFIG } from "@/lib/constants";

interface BadgeProps {
  status: SiteStatus;
}

export function StatusBadge({ status }: BadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${config.color} ${config.bgColor}`}
    >
      {config.label}
    </span>
  );
}

interface GenericBadgeProps {
  label: string;
  variant?: "default" | "success" | "warning" | "error" | "info";
}

const VARIANT_STYLES: Record<string, string> = {
  default: "text-gray-700 dark:text-gray-300 bg-gray-500/20",
  success: "text-green-700 dark:text-green-300 bg-green-500/20",
  warning: "text-yellow-700 dark:text-yellow-300 bg-yellow-500/20",
  error: "text-red-700 dark:text-red-300 bg-red-500/20",
  info: "text-cyan bg-cyan/20",
};

export function Badge({
  label,
  variant = "default",
}: GenericBadgeProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${VARIANT_STYLES[variant]}`}
    >
      {label}
    </span>
  );
}
