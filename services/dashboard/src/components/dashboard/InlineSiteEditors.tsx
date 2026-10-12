"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TRACKING_FIELDS, inheritedTracking, normalizeTrackingId, type TrackingKey } from "@/lib/tracking-ids";

/** Saves one site's config change through the regular site save (staging branch, then Mongo). */
async function saveSite(domain: string, configUpdates: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/sites/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, logoBase64: null, faviconBase64: null, configUpdates }),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!res.ok || data.status !== "ok") throw new Error(data.message ?? "Couldn't save");
}

/* ------------------------------------------------------------------ */
/* Category                                                            */
/* ------------------------------------------------------------------ */

export function InlineCategorySelect({ domain, value, verticals, onSaved, onError }: {
  domain: string;
  value: string;
  verticals: Array<{ id: string; name: string }>;
  onSaved: (name: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimistic, setOptimistic] = useState<string | undefined>(undefined);
  const display = optimistic ?? value;
  const currentId = verticals.find((v) => v.name.toLowerCase() === (display ?? "").toLowerCase())?.id ?? "";

  async function choose(id: string): Promise<void> {
    setEditing(false);
    const picked = verticals.find((v) => v.id === id);
    if (!picked || picked.name === display) return;
    setOptimistic(picked.name);
    setSaving(true);
    try {
      await saveSite(domain, { verticalId: picked.id, vertical: picked.name });
      onSaved(picked.name);
    } catch (err) {
      setOptimistic(undefined);
      onError(err instanceof Error ? err.message : "Couldn't update the category");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <select
        autoFocus
        aria-label={`Category for ${domain}`}
        value={currentId}
        onChange={(e): void => { e.stopPropagation(); void choose(e.target.value); }}
        onBlur={(): void => setEditing(false)}
        onClick={(e): void => e.stopPropagation()}
        className="max-w-[12rem] rounded border border-cyan/50 bg-[var(--bg-elevated)] px-1.5 py-0.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
      >
        {!currentId && <option value="">Choose a category</option>}
        {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Change category for ${domain}`}
      title="Click to change the category"
      disabled={saving || verticals.length === 0}
      onClick={(e): void => { e.stopPropagation(); setEditing(true); }}
      className={`cursor-pointer text-left transition-colors hover:text-cyan disabled:cursor-default ${saving ? "opacity-50" : ""}`}
    >
      {display || <span className="text-[var(--text-muted)]">—</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Tracking IDs (GA4, GTM, Facebook Pixel)                             */
/* ------------------------------------------------------------------ */

interface SiteConfigResponse {
  config?: { tracking?: Record<string, unknown> } | null;
  inheritance?: { org: Record<string, unknown> | null; groups: Array<{ id: string; config: Record<string, unknown> | null }> } | null;
}

/**
 * A tracking cell: shows the ID in effect (from the live config, so inherited values included); clicking opens a
 * small dialog to set this site's own ID or go back to the inherited one.
 */
export function TrackingCell({ domain, field, liveValue, loaded, isLive, onSaved, onError }: {
  domain: string;
  field: TrackingKey;
  liveValue: string | null;
  loaded: boolean;
  /** Live sites read production config: a staging save shows there only after publishing. */
  isLive: boolean;
  onSaved: (message: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const f = TRACKING_FIELDS[field];
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ display: string | null } | null>(null);
  const shown = pending ? pending.display : liveValue;

  return (
    <>
      <button
        type="button"
        aria-label={`Edit ${f.label} for ${domain}`}
        title={`Click to change ${f.label}`}
        disabled={!loaded}
        onClick={(e): void => { e.stopPropagation(); setOpen(true); }}
        className="cursor-pointer text-left transition-colors hover:text-cyan disabled:cursor-default"
      >
        {!loaded ? "…" : shown ?? <span className="text-[var(--text-muted)]">—</span>}
        {pending && isLive && <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">(not published)</span>}
      </button>
      {open && (
        <TrackingDialog
          domain={domain}
          field={field}
          liveValue={liveValue}
          isLive={isLive}
          onClose={(): void => setOpen(false)}
          onSaved={(display, message): void => { setPending({ display }); setOpen(false); onSaved(message); }}
          onError={onError}
        />
      )}
    </>
  );
}

function TrackingDialog({ domain, field, liveValue, isLive, onClose, onSaved, onError }: {
  domain: string;
  field: TrackingKey;
  liveValue: string | null;
  isLive: boolean;
  onClose: () => void;
  onSaved: (display: string | null, message: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const f = TRACKING_FIELDS[field];
  const [loading, setLoading] = useState(true);
  const [own, setOwn] = useState<string | null>(null);
  const [inherited, setInherited] = useState<{ value: string; from: string } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const title = `${f.label} for ${domain}`;
  const appliesWhen = isLive ? "Saved to staging. Publish the site to apply it in production." : "Applies to the staging site after its next sync (about a minute).";

  useEffect(() => {
    fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json() as Promise<SiteConfigResponse>)
      .then((d) => {
        const v = d.config?.tracking?.[field];
        const mine = typeof v === "string" && v.trim() ? v.trim() : null;
        setOwn(mine);
        setText(mine ?? "");
        setInherited(inheritedTracking(d.inheritance ?? null, field));
      })
      .catch(() => setError("Couldn't read the site's current settings. You can still set an ID."))
      .finally(() => setLoading(false));
  }, [domain, field]);

  async function save(value: string | null): Promise<void> {
    setSaving(true);
    try {
      await saveSite(domain, { tracking: { [field]: value } });
      const display = value ?? inherited?.value ?? null;
      onSaved(display, value ? `${f.label} set for ${domain}. ${appliesWhen}` : `${domain} now uses the inherited ${f.label}. ${appliesWhen}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save";
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  function submit(): void {
    const checked = normalizeTrackingId(field, text);
    if (!checked.ok) { setError(checked.error); return; }
    setError(null);
    void save(checked.value);
  }

  return (
    <Modal open onClose={(): void => { if (!saving) onClose(); }} title={title} size="sm">
      <div role="dialog" aria-label={title} className="space-y-4" onClick={(e): void => e.stopPropagation()}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-[var(--text-muted)]">In effect now</dt>
          <dd className="font-mono text-[var(--text-primary)]">{liveValue ?? "Not set"}</dd>
          <dt className="text-[var(--text-muted)]">Inherited</dt>
          <dd className="text-[var(--text-primary)]">
            {loading ? "…" : inherited ? <><span className="font-mono">{inherited.value}</span> <span className="text-[var(--text-muted)]">from {inherited.from}</span></> : <span className="text-[var(--text-muted)]">Nothing inherited</span>}
          </dd>
        </dl>
        <form onSubmit={(e): void => { e.preventDefault(); submit(); }} className="space-y-1.5">
          <label htmlFor={`tracking-${field}-${domain}`} className="block text-xs font-semibold text-[var(--text-secondary)]">{f.label} ID</label>
          <input
            id={`tracking-${field}-${domain}`}
            aria-label={`${f.label} ID`}
            autoFocus
            value={text}
            placeholder={f.placeholder}
            onChange={(e): void => { setText(e.target.value); setError(null); }}
            className="w-full min-h-11 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          />
          {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : <p className="text-xs text-[var(--text-muted)]">{f.hint}. {own ? "This site has its own ID." : "This site uses the inherited ID."}</p>}
        </form>
        <p className="text-xs text-[var(--text-muted)]">{appliesWhen}</p>
        <div className="flex flex-wrap justify-end gap-2">
          {own && (
            <Button variant="ghost" disabled={saving} onClick={(): void => { void save(null); }}>
              {inherited ? `Use inherited (${inherited.value})` : "Remove"}
            </Button>
          )}
          <Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="min-h-11" loading={saving} disabled={loading} onClick={submit}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
