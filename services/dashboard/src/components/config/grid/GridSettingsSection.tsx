"use client";

import { useEffect, useState } from "react";
import { useVerticals } from "@/hooks/useReferenceData";
import type { BundleOption, GridFields, SiteOption } from "@/types/grid";
import { GridSettingsForm } from "./GridSettingsForm";

interface GridSettingsSectionProps {
  value: GridFields;
  onChange: (next: GridFields) => void;
}

/** GridSettingsForm wired up with its reference data (source sites, verticals, aggregator bundles and sources). */
export function GridSettingsSection({ value, onChange }: GridSettingsSectionProps): React.ReactElement {
  const { verticals } = useVerticals();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [bundles, setBundles] = useState<BundleOption[]>([]);
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sites/list")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ domain: string; status: string; vertical: string | null }>) => {
        if (!cancelled) setSites(rows.map((r) => ({ domain: r.domain, status: r.status, vertical: r.vertical ?? "" })));
      })
      .catch((err: unknown) => console.error("[grid] failed to load sites", err));
    // Aggregator data is optional — the form still works (without bundle/source options) if it fails.
    fetch("/api/bundles")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Array<{ id: string; name: string; content_count?: number }> }) => {
        if (!cancelled) setBundles((data.items ?? []).map((b) => ({ id: b.id, name: b.name, count: b.content_count ?? 0 })));
      })
      .catch((err: unknown) => console.error("[grid] failed to load bundles", err));
    fetch("/api/aggregator/sources")
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((data: { sources?: string[] }) => {
        if (!cancelled) setSources(data.sources ?? []);
      })
      .catch((err: unknown) => console.error("[grid] failed to load aggregator sources", err));
    return (): void => {
      cancelled = true;
    };
  }, []);

  return (
    <GridSettingsForm
      value={value}
      onChange={onChange}
      sites={sites}
      verticals={verticals.map((v) => v.name)}
      bundles={bundles}
      sources={sources}
    />
  );
}
