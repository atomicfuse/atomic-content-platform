"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { generateLogoPreview } from "@/actions/wizard";

interface StagingEditPanelProps {
  domain: string;
  previewUrl: string | null;
  currentLogoPath: string | null;
}

export function StagingEditPanel({
  domain,
  previewUrl,
  currentLogoPath,
}: StagingEditPanelProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingLogo, startGenLogo] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingLogo, setPendingLogo] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  function handleGenerateLogo(): void {
    startGenLogo(async () => {
      try {
        const base64 = await generateLogoPreview(domain);
        if (base64) {
          setPendingLogo(base64);
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
        setShowSuccess(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleSave(): Promise<void> {
    if (!pendingLogo) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          configUpdates: null,
          logoBase64: pendingLogo,
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Save failed");
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

  if (!isOpen) {
    return (
      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Logo &amp; Assets
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Upload or generate a site logo for the staging branch
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={(): void => setIsOpen(true)}>
            Edit Logo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          Logo &amp; Assets
        </h3>
        <Button variant="ghost" size="sm" onClick={(): void => setIsOpen(false)}>
          Close
        </Button>
      </div>

      {showSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-2">
          <p className="text-sm font-medium text-green-400">
            Logo saved! A staging rebuild has been triggered.
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

      {/* Logo section */}
      <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            Site Logo
          </h4>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Upload your own or generate with AI. Preview below before saving.
          </p>
        </div>

        {/* Current logo from staging */}
        {!pendingLogo && currentLogoPath && previewUrl && (
          <div className="flex items-start gap-4 p-3 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
            <img
              src={`${previewUrl}${currentLogoPath}`}
              alt="Current logo"
              className="w-16 h-16 rounded-lg object-contain bg-white border border-[var(--border-secondary)]"
              onError={(e): void => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">Current logo</p>
              <p className="text-xs text-[var(--text-muted)]">Upload or generate a new one to replace it.</p>
            </div>
          </div>
        )}

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
                Click &quot;Save Logo&quot; to apply, or generate/upload again to replace.
              </p>
            </div>
            <button
              type="button"
              onClick={(): void => setPendingLogo(null)}
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
          PNG, JPG or SVG, max 2MB. Logo is only committed when you click Save Logo.
        </p>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-muted)]">
          {pendingLogo
            ? "New logo ready. Saving commits to staging and triggers a rebuild."
            : "No changes to save. Site config is edited from the Site Identity tab."}
        </p>
        <div className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={(): void => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isSaving}
            disabled={!pendingLogo || isSaving}
            onClick={handleSave}
          >
            Save Logo
          </Button>
        </div>
      </div>
    </div>
  );
}
