"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { LogoThumb } from "@/components/ui/LogoThumb";
import { useToast } from "@/components/ui/Toast";
import { generateLogoExtras, generateLogoPreview } from "@/actions/wizard";
import { runLogoGeneration, type LogoStep } from "@/lib/logo-generation-flow";
import { GeneratedLogoSet } from "@/components/site-detail/GeneratedLogoSet";

interface GenSetState {
  step: LogoStep;
  model: string | null;
  footerNeeded: boolean;
  logo: string | null;
  footerLogo: string | null;
  favicon: string | null;
}

interface StagingEditPanelProps {
  domain: string;
  previewUrl: string | null;
  currentLogoPath: string | null;
  currentFaviconPath: string | null;
}

function BrowserTabMockup({
  faviconSrc,
  domain,
}: {
  faviconSrc: string | null;
  domain: string;
}): React.ReactElement {
  const label = domain.replace(/\.pages\.dev$/, "").split(".")[0] ?? domain;
  return (
    <div className="mt-2">
      <p className="text-xs text-[var(--text-muted)] mb-1">Browser tab preview</p>
      <div className="inline-block">
        {/* Tab */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg bg-[var(--bg-elevated)] border border-b-0 border-[var(--border-secondary)] max-w-[180px]">
          {faviconSrc ? (
            <img src={faviconSrc} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-sm bg-[var(--border-secondary)] flex-shrink-0" />
          )}
          <span className="text-xs text-[var(--text-primary)] truncate">{label}</span>
        </div>
        {/* Address bar */}
        <div className="border border-[var(--border-secondary)] rounded-tr-lg rounded-b-lg bg-[var(--bg-primary)] px-3 py-2 w-56">
          <div className="h-2 w-3/4 rounded bg-[var(--border-secondary)]" />
        </div>
      </div>
    </div>
  );
}

export function StagingEditPanel({
  domain,
  previewUrl,
  currentLogoPath,
  currentFaviconPath,
}: StagingEditPanelProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingLogo, startGenLogo] = useTransition();
  // The AI logo set (step + header/footer logo + favicon) while it's made and until saved or discarded.
  const [genSet, setGenSet] = useState<GenSetState | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faviconFileInputRef = useRef<HTMLInputElement>(null);

  const [pendingLogo, setPendingLogo] = useState<string | null>(null);
  const [pendingFooterLogo, setPendingFooterLogo] = useState<string | null>(null);
  const [pendingFavicon, setPendingFavicon] = useState<string | null>(null);
  const [autoFooterVariant, setAutoFooterVariant] = useState(true);
  const [clearLogo, setClearLogo] = useState(false);
  const [clearFooterLogo, setClearFooterLogo] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  function handleGenerateLogo(): void {
    const footerSwitchedOn = autoFooterVariant;
    setGenSet({ step: "logo", model: null, footerNeeded: false, logo: null, footerLogo: null, favicon: null });
    startGenLogo(async () => {
      try {
        const result = await runLogoGeneration(
          {
            preview: (opts) => generateLogoPreview(domain, opts),
            extras: (logo) => generateLogoExtras(domain, logo, { generateFooterVariant: footerSwitchedOn }),
          },
          {
            onStep: (step) => setGenSet((g) => (g ? { ...g, step } : g)),
            onLogo: (logo, model, footerNeeded) => {
              setPendingLogo(logo);
              setClearLogo(false);
              setClearFooterLogo(false);
              setShowSuccess(false);
              setGenSet((g) => (g ? { ...g, logo, model, footerNeeded: footerNeeded && footerSwitchedOn } : g));
            },
          },
        );
        if (!result) {
          setGenSet(null);
          toast("AI could not generate an image — try again", "error");
          return;
        }
        setPendingFooterLogo(result.footerLogo);
        if (result.favicon) setPendingFavicon(result.favicon);
        setGenSet((g) => (g ? { ...g, step: "done", footerLogo: result.footerLogo, favicon: result.favicon } : g));
      } catch (err) {
        setGenSet(null);
        toast(
          `Generation failed: ${err instanceof Error ? err.message : "Unknown"}`,
          "error"
        );
      }
    });
  }

  function handleDiscardGenerated(): void {
    setPendingLogo(null);
    setPendingFooterLogo(null);
    if (genSet?.favicon) setPendingFavicon(null);
    setGenSet(null);
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

    setGenSet(null);
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

  function handleFaviconUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") && file.type !== "image/x-icon") {
      toast("Please select an image file (PNG, ICO, SVG)", "error");
      return;
    }
    if (file.size > 500 * 1024) {
      toast("Favicon must be under 500KB", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) {
        setPendingFavicon(base64Data);
        setShowSuccess(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleUseLogo(): void {
    if (pendingLogo) {
      setPendingFavicon(pendingLogo);
      setShowSuccess(false);
    } else {
      toast("Upload or generate a logo first", "info");
    }
  }

  function handleRemoveLogo(): void {
    setGenSet(null);
    setPendingLogo(null);
    setPendingFavicon(null);
    setClearLogo(true);
  }

  function handleRemoveFooterLogo(): void {
    setPendingFooterLogo(null);
    setClearFooterLogo(true);
  }

  async function handleSave(): Promise<void> {
    if (!pendingLogo && !pendingFavicon && !pendingFooterLogo && !clearLogo && !clearFooterLogo) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          configUpdates: null,
          logoBase64: pendingLogo,
          footerLogoBase64: pendingFooterLogo ?? undefined,
          faviconBase64: pendingFavicon,
          clearLogo: clearLogo || undefined,
          clearFooterLogo: clearFooterLogo || undefined,
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Save failed");
      setGenSet(null);
      setPendingLogo(null);
      setPendingFooterLogo(null);
      setPendingFavicon(null);
      setClearLogo(false);
      setClearFooterLogo(false);
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

  const hasPendingChanges = !!pendingLogo || !!pendingFooterLogo || !!pendingFavicon || clearLogo || clearFooterLogo;

  // Resolve favicon preview source
  const faviconPreviewSrc = pendingFavicon
    ? `data:image/png;base64,${pendingFavicon}`
    : currentFaviconPath && previewUrl
      ? `${previewUrl}${currentFaviconPath}`
      : null;

  if (!isOpen) {
    return (
      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Logo &amp; Favicon
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Upload or generate a site logo and favicon for the staging branch
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={(): void => setIsOpen(true)}>
            Edit Assets
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          Logo &amp; Favicon
        </h3>
        <Button variant="ghost" size="sm" onClick={(): void => setIsOpen(false)}>
          Close
        </Button>
      </div>

      {showSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-2">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Assets saved! A staging rebuild has been triggered.
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

      {/* Side-by-side grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Logo section */}
        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">
              Site Logo
            </h4>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Upload your own or generate with AI.
            </p>
          </div>

          {/* Current logo from staging */}
          {!pendingLogo && currentLogoPath && previewUrl && (
            <div className="flex items-start gap-4 p-3 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
              <LogoThumb
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

          {genSet && (
            <div className="space-y-2">
              <GeneratedLogoSet
                step={genSet.step}
                model={genSet.model}
                logo={genSet.logo}
                footerLogo={genSet.footerLogo}
                favicon={genSet.favicon}
                footerExpected={genSet.footerNeeded}
              />
              {genSet.step === "done" && (
                <button type="button" onClick={handleDiscardGenerated} className="text-xs text-[var(--text-muted)] underline hover:text-red-400">
                  Discard generated logos
                </button>
              )}
            </div>
          )}

          {pendingLogo && !genSet && (
            <div className="flex items-start gap-4 p-3 rounded-lg border border-cyan/20 bg-cyan/5">
              <LogoThumb
                src={`data:image/png;base64,${pendingLogo}`}
                alt="Logo preview"
                className="w-16 h-16 rounded-lg object-contain bg-white border border-[var(--border-secondary)]"
              />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  New logo ready
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Click &quot;Save&quot; to apply.
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

          <div className="flex items-center gap-3 flex-wrap">
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
            {(currentLogoPath || pendingLogo) && !clearLogo && (
              <Button variant="ghost" size="sm" onClick={handleRemoveLogo}>
                Remove Logo
              </Button>
            )}
            {clearLogo && (
              <span className="text-xs text-red-400">
                Logo will be removed on save.{" "}
                <button type="button" onClick={(): void => setClearLogo(false)} className="underline hover:text-red-300">
                  Undo
                </button>
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoFooterVariant}
              onChange={(e): void => setAutoFooterVariant(e.target.checked)}
              className="accent-cyan"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              Auto-generate footer variant when header/footer contrast inverts
            </span>
          </label>
          {pendingFooterLogo && !clearFooterLogo && !genSet && (
            <div className="flex items-center gap-2">
              <LogoThumb
                src={`data:image/png;base64,${pendingFooterLogo}`}
                alt="Footer logo preview"
                className="w-10 h-10 rounded object-contain bg-[var(--bg-elevated)] border border-[var(--border-secondary)]"
              />
              <span className="text-xs text-[var(--text-muted)]">Footer variant ready</span>
              <Button variant="ghost" size="sm" onClick={handleRemoveFooterLogo}>
                Remove Footer Logo
              </Button>
            </div>
          )}
          {clearFooterLogo && (
            <span className="text-xs text-red-400">
              Footer logo will be removed on save.{" "}
              <button type="button" onClick={(): void => setClearFooterLogo(false)} className="underline hover:text-red-300">
                Undo
              </button>
            </span>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            PNG, JPG or SVG, max 2MB.
          </p>
        </div>

        {/* Favicon section */}
        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">
              Favicon
            </h4>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Shown in browser tabs. Upload separately or use the logo.
            </p>
          </div>

          {/* Current favicon from staging */}
          {!pendingFavicon && currentFaviconPath && previewUrl && (
            <div className="flex items-start gap-4 p-3 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
              <img
                src={`${previewUrl}${currentFaviconPath}`}
                alt="Current favicon"
                className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
                onError={(e): void => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">Current favicon</p>
                <p className="text-xs text-[var(--text-muted)]">Upload a new one or use the logo.</p>
              </div>
            </div>
          )}

          {pendingFavicon && (
            <div className="flex items-start gap-4 p-3 rounded-lg border border-cyan/20 bg-cyan/5">
              <img
                src={`data:image/png;base64,${pendingFavicon}`}
                alt="Favicon preview"
                className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
              />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  New favicon ready
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Click &quot;Save&quot; to apply.
                </p>
              </div>
              <button
                type="button"
                onClick={(): void => setPendingFavicon(null)}
                className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1"
                title="Discard favicon"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <BrowserTabMockup faviconSrc={faviconPreviewSrc} domain={domain} />

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => faviconFileInputRef.current?.click()}
            >
              Upload Favicon
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleUseLogo}
            >
              Use Logo as Favicon
            </Button>
            <input
              ref={faviconFileInputRef}
              type="file"
              accept=".png,.ico,.svg,image/png,image/x-icon,image/svg+xml"
              className="hidden"
              onChange={handleFaviconUpload}
            />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            PNG, ICO or SVG, max 500KB.
          </p>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-muted)]">
          {hasPendingChanges
            ? "Changes ready. Saving commits to staging and triggers a rebuild."
            : "No changes to save. Site config is edited from the Site Identity tab."}
        </p>
        <div className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={(): void => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isSaving}
            disabled={!hasPendingChanges || isSaving}
            onClick={handleSave}
          >
            Save Assets
          </Button>
        </div>
      </div>
    </div>
  );
}
