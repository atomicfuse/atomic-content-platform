"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  readStagingConfig,
  generateLogoPreview,
  type StagingSiteConfig,
} from "@/actions/wizard";

const THEME_OPTIONS = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
  { value: "minimal", label: "Minimal" },
  { value: "bold", label: "Bold" },
];

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface StagingEditPanelProps {
  domain: string;
  previewUrl: string | null;
}

export function StagingEditPanel({
  domain,
  previewUrl,
}: StagingEditPanelProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<StagingSiteConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingLogo, startGenLogo] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending logo (base64) — previewed but not yet committed
  const [pendingLogo, setPendingLogo] = useState<string | null>(null);

  // Success banner after save
  const [showSuccess, setShowSuccess] = useState(false);

  // Topic input state
  const [topicInput, setTopicInput] = useState("");

  // Track if anything has been changed
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (isOpen && !config) {
      setIsLoading(true);
      readStagingConfig(domain)
        .then((c) => {
          setConfig(c);
          setIsLoading(false);
        })
        .catch(() => {
          toast("Failed to load site config", "error");
          setIsLoading(false);
        });
    }
  }, [isOpen, config, domain, toast]);

  function updateConfig(updates: Partial<StagingSiteConfig>): void {
    setConfig((prev) => (prev ? { ...prev, ...updates } : prev));
    setIsDirty(true);
    setShowSuccess(false);
  }

  function handleAddTopic(): void {
    if (!topicInput.trim() || !config) return;
    updateConfig({ topics: [...config.topics, topicInput.trim()] });
    setTopicInput("");
  }

  function handleRemoveTopic(index: number): void {
    if (!config) return;
    updateConfig({ topics: config.topics.filter((_, i) => i !== index) });
  }

  function handleToggleDay(day: string): void {
    if (!config) return;
    const days = config.preferredDays.includes(day)
      ? config.preferredDays.filter((d) => d !== day)
      : [...config.preferredDays, day];
    updateConfig({ preferredDays: days });
  }

  // --- Logo: Generate with AI (preview only, no commit) ---
  function handleGenerateLogo(): void {
    startGenLogo(async () => {
      try {
        const base64 = await generateLogoPreview(domain);
        if (base64) {
          setPendingLogo(base64);
          setIsDirty(true);
          setShowSuccess(false);
        } else {
          toast("AI could not generate an image — try again", "error");
        }
      } catch (err) {
        toast(
          `Generation failed: ${err instanceof Error ? err.message : "Unknown"}`,
          "error"
        );
      }
    });
  }

  // --- Logo: Upload file (preview only, no commit) ---
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast("Please select an image file (PNG, JPG, SVG)", "error");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("Image must be under 2MB", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) {
        setPendingLogo(base64Data);
        setIsDirty(true);
        setShowSuccess(false);
      }
    };
    reader.readAsDataURL(file);

    // Reset so the same file can be re-selected
    e.target.value = "";
  }

  // --- Save everything in a single commit + single build ---
  // Uses a Route Handler instead of a server action to avoid
  // "Maximum array nesting exceeded" from RSC serialization.
  async function handleSave(): Promise<void> {
    if (!isDirty && !pendingLogo) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          configUpdates: isDirty && config ? config : null,
          logoBase64: pendingLogo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Save failed");
      setIsDirty(false);
      setPendingLogo(null);
      setShowSuccess(true);
      router.refresh();
    } catch (err) {
      toast(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown"}`,
        "error"
      );
    } finally {
      setIsSaving(false);
    }
  }

  // --- Collapsed state ---
  if (!isOpen) {
    return (
      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Edit Site
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Modify config, topics, logo, and theme on the staging branch
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={(): void => setIsOpen(true)}>
            Edit Settings
          </Button>
        </div>
      </div>
    );
  }

  // --- Loading state ---
  if (isLoading || !config) {
    return (
      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--text-muted)]">
            Loading site config from staging branch...
          </span>
        </div>
      </div>
    );
  }

  const hasChanges = isDirty || pendingLogo !== null;

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          Edit Site Settings
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={(): void => setIsOpen(false)}
        >
          Close
        </Button>
      </div>

      {/* Success banner */}
      {showSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-2">
          <p className="text-sm font-medium text-green-400">
            Changes saved! A staging rebuild has been triggered.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            The build takes 1-2 minutes.{" "}
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan underline underline-offset-2"
              >
                Open staging preview
              </a>
            )}{" "}
            to check once it&apos;s done.
          </p>
        </div>
      )}

      {/* Identity */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Site Name"
          value={config.siteName}
          onChange={(e): void => updateConfig({ siteName: e.target.value })}
        />
        <Input
          label="Tagline"
          value={config.siteTagline}
          onChange={(e): void => updateConfig({ siteTagline: e.target.value })}
        />
      </div>

      {/* Audience & Tone */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Audience"
          value={config.audience}
          onChange={(e): void => updateConfig({ audience: e.target.value })}
        />
        <Input
          label="Tone"
          value={config.tone}
          onChange={(e): void => updateConfig({ tone: e.target.value })}
        />
      </div>

      {/* Topics */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Topics
        </label>
        <div className="flex flex-wrap gap-2">
          {config.topics.map((topic, i) => (
            <span
              key={`${topic}-${i}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan/10 text-cyan text-xs font-medium"
            >
              {topic}
              <button
                onClick={(): void => handleRemoveTopic(i)}
                className="hover:text-red-400 transition-colors"
                type="button"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add a topic..."
            value={topicInput}
            onChange={(e): void => setTopicInput(e.target.value)}
            onKeyDown={(e): void => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTopic();
              }
            }}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddTopic}
            disabled={!topicInput.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Content Guidelines */}
      <Textarea
        label="Content Guidelines"
        rows={3}
        value={config.contentGuidelines}
        onChange={(e): void =>
          updateConfig({ contentGuidelines: e.target.value })
        }
        placeholder="One guideline per line..."
      />

      {/* Schedule */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Articles per Week
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={config.articlesPerWeek}
            onChange={(e): void =>
              updateConfig({ articlesPerWeek: parseInt(e.target.value) || 5 })
            }
            className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-cyan"
          />
        </div>
        <Select
          label="Theme"
          options={THEME_OPTIONS}
          value={config.themeBase}
          onChange={(e): void => updateConfig({ themeBase: e.target.value })}
        />
      </div>

      {/* Preferred Days */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Preferred Publishing Days
        </label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={(): void => handleToggleDay(day)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                config.preferredDays.includes(day)
                  ? "bg-cyan/15 border-cyan/40 text-cyan"
                  : "bg-[var(--bg-surface)] border-[var(--border-secondary)] text-[var(--text-muted)] hover:border-[var(--border-primary)]"
              }`}
            >
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Logo */}
      <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            Site Logo
          </h4>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Upload your own or generate with AI. Preview below before saving.
          </p>
        </div>

        {/* Logo preview */}
        {pendingLogo && (
          <div className="flex items-start gap-4 p-3 rounded-lg border border-cyan/20 bg-cyan/5">
            <img
              src={`data:image/png;base64,${pendingLogo}`}
              alt="Logo preview"
              className="w-16 h-16 rounded-lg object-contain bg-white border border-[var(--border-secondary)]"
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                New logo ready
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Click &quot;Save &amp; Rebuild&quot; to apply, or generate/upload again to replace.
              </p>
            </div>
            <button
              type="button"
              onClick={(): void => {
                setPendingLogo(null);
                if (!isDirty) setIsDirty(false);
              }}
              className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1"
              title="Discard logo"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={(): void => fileInputRef.current?.click()}
          >
            Upload Logo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={isGeneratingLogo}
            onClick={handleGenerateLogo}
          >
            {isGeneratingLogo ? "Generating..." : "Generate with AI"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          PNG, JPG or SVG, max 2MB. Logo is only committed when you click Save &amp; Rebuild.
        </p>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-muted)]">
          {hasChanges
            ? "You have unsaved changes. Saving commits to staging and triggers one rebuild."
            : "No changes to save."}
        </p>
        <div className="flex gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={(): void => setIsOpen(false)}
          >
            Cancel
          </Button>
          <Button
            loading={isSaving}
            disabled={!hasChanges || isSaving}
            onClick={handleSave}
          >
            Save &amp; Rebuild
          </Button>
        </div>
      </div>
    </div>
  );
}
