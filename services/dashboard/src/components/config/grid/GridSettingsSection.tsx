"use client";

import { useEffect, useState } from "react";
import { useVerticals } from "@/hooks/useReferenceData";
import type { GridFields, SiteOption } from "@/types/grid";
import { GridSettingsForm } from "./GridSettingsForm";

interface GridSettingsSectionProps {
  value: GridFields;
  onChange: (next: GridFields) => void;
}

/** GridSettingsForm wired up with its reference data (source sites + verticals). */
export function GridSettingsSection({ value, onChange }: GridSettingsSectionProps): React.ReactElement {
  const { verticals } = useVerticals();
  const [sites, setSites] = useState<SiteOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sites/list")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ domain: string; status: string; vertical: string | null }>) => {
        if (!cancelled) setSites(rows.map((r) => ({ domain: r.domain, status: r.status, vertical: r.vertical ?? "" })));
      })
      .catch((err: unknown) => console.error("[grid] failed to load sites", err));
    return (): void => {
      cancelled = true;
    };
  }, []);

  return <GridSettingsForm value={value} onChange={onChange} sites={sites} verticals={verticals.map((v) => v.name)} />;
}
