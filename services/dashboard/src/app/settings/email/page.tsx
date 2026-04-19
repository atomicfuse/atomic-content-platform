"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

interface EmailConfig {
  default_destination: string;
  overrides: Record<string, string>;
}

interface SiteInfo {
  domain: string;
  status: string;
  vertical: string;
  company: string;
}

export default function SettingsEmailPage(): React.ReactElement {
  const { toast } = useToast();

  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [defaultEmail, setDefaultEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Override modal state
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [allSites, setAllSites] = useState<SiteInfo[]>([]);
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [overrideEmail, setOverrideEmail] = useState("");
  const [siteFilter, setSiteFilter] = useState("");

  // Verification state
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifying, setVerifying] = useState(false);

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/email/config");
      const data = (await res.json()) as EmailConfig;
      setConfig(data);
      setDefaultEmail(data.default_destination);
    } catch {
      toast("Failed to load email config", "error");
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    loadConfig();
    fetch("/api/sites/list")
      .then((r) => r.json())
      .then((data: SiteInfo[]) => setAllSites(data))
      .catch(() => {});
  }, [loadConfig]);

  const saveDefault = async (): Promise<void> => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/email/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_destination: defaultEmail,
          overrides: config.overrides,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const updated = (await res.json()) as EmailConfig;
      setConfig(updated);
      toast("Default email saved", "success");
    } catch {
      toast("Failed to save", "error");
    }
    setSaving(false);
  };

  const removeOverride = async (domain: string): Promise<void> => {
    if (!config) return;
    const overrides = { ...config.overrides };
    delete overrides[domain];
    try {
      const res = await fetch("/api/email/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_destination: config.default_destination,
          overrides,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const updated = (await res.json()) as EmailConfig;
      setConfig(updated);
      toast("Override removed", "success");
    } catch {
      toast("Failed to remove override", "error");
    }
  };

  const createOverride = async (): Promise<void> => {
    if (!config) return;
    const sites = Array.from(selectedSites);
    if (!sites.length) {
      toast("Select at least one site", "error");
      return;
    }
    if (!overrideEmail || !overrideEmail.includes("@")) {
      toast("Enter a valid email address", "error");
      return;
    }

    const overrides = { ...config.overrides };
    for (const domain of sites) {
      overrides[domain] = overrideEmail;
    }

    try {
      const res = await fetch("/api/email/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_destination: config.default_destination,
          overrides,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const updated = (await res.json()) as EmailConfig;
      setConfig(updated);
      setOverrideModalOpen(false);
      setSelectedSites(new Set());
      setOverrideEmail("");
      toast(`Override created for ${sites.length} site(s)`, "success");
    } catch {
      toast("Failed to create override", "error");
    }
  };

  const sendVerification = async (): Promise<void> => {
    if (!verifyEmail || !verifyEmail.includes("@")) {
      toast("Enter a valid email address", "error");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        toast(err.error, "error");
      } else {
        toast(`Verification email sent to ${verifyEmail}`, "success");
        setVerifyEmail("");
      }
    } catch {
      toast("Failed to send verification", "error");
    }
    setVerifying(false);
  };

  const toggleSite = (domain: string): void => {
    setSelectedSites((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const overrideEntries = config ? Object.entries(config.overrides) : [];
  const overrideDomains = new Set(overrideEntries.map(([d]) => d));
  const filteredSites = allSites.filter(
    (s) =>
      !overrideDomains.has(s.domain) &&
      (siteFilter === "" ||
        s.domain.toLowerCase().includes(siteFilter.toLowerCase()) ||
        s.vertical.toLowerCase().includes(siteFilter.toLowerCase()) ||
        s.company.toLowerCase().includes(siteFilter.toLowerCase())),
  );

  if (loading) {
    return <div className="text-[var(--text-secondary)] text-sm">Loading...</div>;
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Email Forwarding</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Configure where contact@domain emails are forwarded. Set a default for all sites, or override per-site.
        </p>
      </div>

      {/* Verification info */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-500">Destination addresses must be verified</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Before using a new email as a forwarding destination, it must be verified as a Cloudflare destination address.
              Enter the email below and click &quot;Send Verification&quot; — Cloudflare will send a confirmation link.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="new-destination@example.com"
            value={verifyEmail}
            onChange={(e): void => setVerifyEmail(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            loading={verifying}
            onClick={sendVerification}
          >
            Send Verification
          </Button>
        </div>
      </div>

      {/* Default destination */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Default Destination</h2>
        <p className="text-xs text-[var(--text-secondary)]">
          All site contact emails forward to this address unless overridden below.
        </p>
        <div className="flex gap-2">
          <Input
            value={defaultEmail}
            onChange={(e): void => setDefaultEmail(e.target.value)}
            className="flex-1"
          />
          <Button
            onClick={saveDefault}
            loading={saving}
            disabled={defaultEmail === config?.default_destination}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Overrides */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Site Overrides</h2>
            {overrideEntries.length > 0 && (
              <Badge
                label={`${overrideEntries.length} override${overrideEntries.length !== 1 ? "s" : ""}`}
                variant="warning"
              />
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={(): void => {
              setSelectedSites(new Set());
              setOverrideEmail("");
              setSiteFilter("");
              setOverrideModalOpen(true);
            }}
          >
            + Add Override
          </Button>
        </div>

        {overrideEntries.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No site-specific overrides. All sites forward to the default destination.
          </p>
        ) : (
          <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-secondary)]">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Site
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Forwards To
                  </th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {overrideEntries.map(([domain, email]) => (
                  <tr
                    key={domain}
                    className="border-b border-[var(--border-secondary)] last:border-0"
                  >
                    <td className="px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">
                      {domain}
                    </td>
                    <td className="px-4 py-2.5 text-sm font-mono text-[var(--text-secondary)]">
                      {email}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(): void => { removeOverride(domain); }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Override creation modal */}
      <Modal
        open={overrideModalOpen}
        onClose={(): void => setOverrideModalOpen(false)}
        title="Add Email Override"
        size="xl"
      >
        <div className="space-y-4">
          {/* Site selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Select Sites ({selectedSites.size} selected)
            </label>
            <input
              value={siteFilter}
              onChange={(e): void => setSiteFilter(e.target.value)}
              placeholder="Filter by domain, vertical, or company..."
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
            />
            <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)]">
              {filteredSites.length === 0 ? (
                <p className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
                  {allSites.length === 0 ? "Loading sites..." : "No matching sites"}
                </p>
              ) : (
                filteredSites.map((site) => (
                  <label
                    key={site.domain}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-surface)] cursor-pointer transition-colors border-b border-[var(--border-secondary)] last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSites.has(site.domain)}
                      onChange={(): void => toggleSite(site.domain)}
                      className="rounded border-[var(--border-primary)] text-cyan focus:ring-cyan/50 bg-[var(--bg-elevated)]"
                    />
                    <span className="text-sm text-[var(--text-primary)] flex-1">{site.domain}</span>
                    <span className="text-xs text-[var(--text-muted)]">{site.vertical}</span>
                    <span className="text-xs text-[var(--text-muted)]">{site.status}</span>
                  </label>
                ))
              )}
            </div>
            {selectedSites.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {Array.from(selectedSites).map((domain) => (
                  <span
                    key={domain}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan/10 text-cyan"
                  >
                    {domain}
                    <button
                      onClick={(): void => toggleSite(domain)}
                      className="hover:text-cyan-light"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Override email */}
          <div className="space-y-1.5">
            <Input
              label="Forward To"
              placeholder="another@example.com"
              value={overrideEmail}
              onChange={(e): void => setOverrideEmail(e.target.value)}
            />
            <p className="text-xs text-[var(--text-muted)]">
              This address must be verified as a Cloudflare destination address.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={(): void => setOverrideModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={createOverride}
              disabled={selectedSites.size === 0 || !overrideEmail}
            >
              Create Override
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
