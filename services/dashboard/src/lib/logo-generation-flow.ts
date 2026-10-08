/**
 * Browser-side order of the logo steps. Each step is its own server action so no request comes near
 * CloudGrid's ~60 s gateway limit: logo → (one contrast retry if faint, keep the clearer) → favicon + footer.
 */
export interface LogoPreviewResult {
  logo: string | null;
  model: string | null;
  contrast: number | null;
  lowContrast: boolean;
  /** Header and footer backgrounds invert (one dark, one light) → a footer variant is worth making. */
  footerNeeded: boolean;
}

/** Where the generation is: shown to the user next to the button. */
export type LogoStep = "logo" | "retry" | "extras" | "done";

export interface LogoGenerationSteps {
  preview(options?: { retryForContrast?: boolean }): Promise<LogoPreviewResult>;
  extras(logoBase64: string): Promise<{ favicon: string | null; footerLogo: string | null }>;
}

export interface LogoGenerationResult {
  logo: string;
  model: string | null;
  favicon: string | null;
  footerLogo: string | null;
}

export async function runLogoGeneration(
  steps: LogoGenerationSteps,
  hooks: { onLogo?(logo: string, model: string | null, footerNeeded: boolean): void; onStep?(step: LogoStep): void },
): Promise<LogoGenerationResult | null> {
  hooks.onStep?.("logo");
  let best = await steps.preview();
  if (!best.logo) return null;
  if (best.lowContrast) {
    hooks.onStep?.("retry");
    try {
      const retry = await steps.preview({ retryForContrast: true });
      if (retry.logo && (retry.contrast ?? 0) > (best.contrast ?? 0)) best = retry;
    } catch {
      // Keep the first logo — a failed retry never loses what we already have.
    }
  }
  const logo = best.logo as string;
  hooks.onLogo?.(logo, best.model, best.footerNeeded);
  hooks.onStep?.("extras");
  let extras: { favicon: string | null; footerLogo: string | null } = { favicon: null, footerLogo: null };
  try {
    extras = await steps.extras(logo);
  } catch {
    // Favicon falls back to a crop of the logo on save; the footer keeps using the main logo.
  }
  hooks.onStep?.("done");
  return { logo, model: best.model, ...extras };
}
