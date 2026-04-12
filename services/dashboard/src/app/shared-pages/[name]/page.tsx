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

export default function SharedPageEditorPage(): React.ReactElement {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [pageData, setPageData] = useState<PageData | null>(null);
  const [globalContent, setGlobalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideSites, setOverrideSites] = useState("");
  const [overrideContent, setOverrideContent] = useState("");
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const [overrideViewContent, setOverrideViewContent] = useState("");

  const loadPage = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/shared-pages/${name}`);
      const data = (await res.json()) as PageData;
      setPageData(data);
      setGlobalContent(data.content);
    } catch {
      toast("Failed to load page", "error");
    }
  }, [name, toast]);

  useEffect(() => {
    loadPage();
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
    const sites = overrideSites
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!sites.length) {
      toast("Enter at least one site domain", "error");
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
      setOverrideSites("");
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

  if (!pageData) {
    return <div className="text-[var(--text-secondary)] text-sm">Loading...</div>;
  }

  const globalTab = (
    <div className="space-y-4">
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
        size="lg"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Site Domains (comma or newline separated)
            </label>
            <textarea
              value={overrideSites}
              onChange={(e): void => setOverrideSites(e.target.value)}
              placeholder="coolnews.dev, atomicfood.dev"
              className="w-full h-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Override Content
            </label>
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
            <Button onClick={createOverride}>Create Override</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
