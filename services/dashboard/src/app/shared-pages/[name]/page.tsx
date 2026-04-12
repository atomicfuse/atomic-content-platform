"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface PageData {
  name: string;
  content: string;
  overrides: string[];
}

interface SiteInfo {
  domain: string;
  status: string;
  vertical: string;
  company: string;
}

const AVAILABLE_VARIABLES: Array<{ key: string; description: string }> = [
  { key: "site_name", description: "Site display name" },
  { key: "domain", description: "Site domain (e.g. coolnews.dev)" },
  { key: "support_email", description: "Contact email (or contact@domain)" },
  { key: "site_email", description: "Site contact email (same as support_email if not set)" },
  { key: "company_name", description: "Legal entity / company name" },
  { key: "company_country", description: "Company country" },
  { key: "effective_date", description: "Legal document effective date" },
  { key: "site_description", description: "Short site description" },
];

export default function SharedPageEditorPage(): React.ReactElement {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [pageData, setPageData] = useState<PageData | null>(null);
  const [globalContent, setGlobalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [overrideContent, setOverrideContent] = useState("");
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const [overrideViewContent, setOverrideViewContent] = useState("");
  const [allSites, setAllSites] = useState<SiteInfo[]>([]);
  const [siteFilter, setSiteFilter] = useState("");
  const [variablesOpen, setVariablesOpen] = useState(false);

  const loadPage = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/shared-pages/${name}`);
      if (!res.ok) {
        toast("Failed to load page", "error");
        return;
      }
      const data = (await res.json()) as PageData;
      setPageData(data);
      setGlobalContent(data.content);
    } catch {
      toast("Failed to load page", "error");
    }
  }, [name, toast]);

  useEffect(() => {
    loadPage();
    fetch("/api/sites/list")
      .then((r) => r.json())
      .then((data: SiteInfo[]) => setAllSites(data))
      .catch(() => {});
  }, [loadPage]);

  const saveGlobal = async (): Promise<void> => {
    setSaving(true);
    try {
      await fetch(`/api/shared-pages/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: globalContent }),
      });
      toast("Page saved", "success");
    } catch {
      toast("Failed to save", "error");
    }
    setSaving(false);
  };

  const createOverride = async (): Promise<void> => {
    const sites = Array.from(selectedSites);
    if (!sites.length) {
      toast("Select at least one site", "error");
      return;
    }
    try {
      await fetch(`/api/shared-pages/${name}/override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sites, content: overrideContent }),
      });
      toast(`Override created for ${sites.length} site(s)`, "success");
      setOverrideModalOpen(false);
      setSelectedSites(new Set());
      setOverrideContent("");
      loadPage();
    } catch {
      toast("Failed to create override", "error");
    }
  };

  const loadOverride = async (siteId: string): Promise<void> => {
    try {
      const res = await fetch(`/api/shared-pages/${name}/override/${siteId}`);
      const data = (await res.json()) as { content: string };
      setSelectedOverride(siteId);
      setOverrideViewContent(data.content);
    } catch {
      toast("Failed to load override", "error");
    }
  };

  const deleteOverride = async (siteId: string): Promise<void> => {
    try {
      await fetch(`/api/shared-pages/${name}/override/${siteId}`, { method: "DELETE" });
      toast("Override deleted", "success");
      setSelectedOverride(null);
      loadPage();
    } catch {
      toast("Failed to delete override", "error");
    }
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

  const insertVariable = (key: string, target: "global" | "override"): void => {
    const value = `{{${key}}}`;
    if (target === "global") {
      setGlobalContent((prev) => prev + value);
    } else {
      setOverrideContent((prev) => prev + value);
    }
    setVariablesOpen(false);
  };

  // Filter sites for the override modal — exclude sites that already have an override
  const existingOverrides = new Set(pageData?.overrides ?? []);
  const filteredSites = allSites.filter(
    (s) =>
      !existingOverrides.has(s.domain) &&
      (siteFilter === "" ||
        s.domain.toLowerCase().includes(siteFilter.toLowerCase()) ||
        s.vertical.toLowerCase().includes(siteFilter.toLowerCase()) ||
        s.company.toLowerCase().includes(siteFilter.toLowerCase())),
  );

  if (!pageData) {
    return <div className="text-[var(--text-secondary)] text-sm">Loading...</div>;
  }

  const variablesPanel = (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl p-3 space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Available Variables
        </span>
        <button
          onClick={(): void => setVariablesOpen(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {AVAILABLE_VARIABLES.map((v) => (
        <button
          key={v.key}
          onClick={(): void => insertVariable(v.key, overrideModalOpen ? "override" : "global")}
          className="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-left hover:bg-[var(--bg-elevated)] transition-colors group"
        >
          <div>
            <code className="text-xs text-cyan font-mono">{`{{${v.key}}}`}</code>
            <span className="text-xs text-[var(--text-muted)] ml-2">{v.description}</span>
          </div>
          <span className="text-xs text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
            Insert
          </span>
        </button>
      ))}
    </div>
  );

  const globalTab = (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={(): void => setVariablesOpen(!variablesOpen)}
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
          </svg>
          Variables
        </Button>
      </div>
      {variablesOpen && !overrideModalOpen && variablesPanel}
      <textarea
        value={globalContent}
        onChange={(e): void => setGlobalContent(e.target.value)}
        className="w-full h-[500px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan resize-y"
      />
      <div className="flex justify-end">
        <Button onClick={saveGlobal} loading={saving}>
          Save Global Page
        </Button>
      </div>
    </div>
  );

  const overridesTab = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          {pageData.overrides.length} site-specific override{pageData.overrides.length !== 1 ? "s" : ""}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={(): void => {
            setOverrideContent(globalContent);
            setSelectedSites(new Set());
            setSiteFilter("");
            setOverrideModalOpen(true);
          }}
        >
          + Create Override
        </Button>
      </div>

      {pageData.overrides.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
          {pageData.overrides.map((siteId) => (
            <div
              key={siteId}
              className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)] last:border-0"
            >
              <button
                onClick={(): void => { loadOverride(siteId); }}
                className="text-sm font-medium text-cyan hover:underline"
              >
                {siteId}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(): void => { deleteOverride(siteId); }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {selectedOverride && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Override: {selectedOverride}
          </h3>
          <textarea
            value={overrideViewContent}
            readOnly
            className="w-full h-[300px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)] font-mono resize-y"
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={(): void => router.push("/shared-pages")}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold">{name}</h1>
      </div>

      <Tabs
        tabs={[
          { id: "global", label: "Global", content: globalTab },
          { id: "overrides", label: `Overrides (${pageData.overrides.length})`, content: overridesTab },
        ]}
      />

      <Modal
        open={overrideModalOpen}
        onClose={(): void => setOverrideModalOpen(false)}
        title="Create Override"
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

          {/* Override content */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Override Content
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={(): void => setVariablesOpen(!variablesOpen)}
              >
                <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                </svg>
                Variables
              </Button>
            </div>
            {variablesOpen && overrideModalOpen && variablesPanel}
            <textarea
              value={overrideContent}
              onChange={(e): void => setOverrideContent(e.target.value)}
              className="w-full h-[300px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-cyan/50 resize-y"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={(): void => setOverrideModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createOverride} disabled={selectedSites.size === 0}>
              Create Override
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
