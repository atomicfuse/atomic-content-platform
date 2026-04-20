/** Per-device size configuration for the structured ad placement editor. */
export interface AdSizeConfig {
  ratio: { x: number; y: number };
  range: {
    minWidth: number | null;
    maxWidth: number | null;
    minHeight: number | null;
    maxHeight: number | null;
  };
  customSizes: Array<{ width: number; height: number }>;
}

/** Validation errors for a single size config panel. */
export interface SizeConfigErrors {
  ratio?: string;
  rangeWidth?: string;
  rangeHeight?: string;
  customSizes?: string;
}

/** Create a default empty AdSizeConfig (16:9 ratio, no range, no custom sizes). */
export function createDefaultSizeConfig(): AdSizeConfig {
  return {
    ratio: { x: 16, y: 9 },
    range: {
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    },
    customSizes: [],
  };
}

/** Migrate old number[][] size tuples to AdSizeConfig. Defaults: 16:9 ratio, empty range. */
export function sizeTuplesToConfig(
  sizes: number[][] | undefined,
): AdSizeConfig {
  const config = createDefaultSizeConfig();
  if (!sizes || sizes.length === 0) return config;
  config.customSizes = sizes.map(([w, h]) => ({ width: w, height: h }));
  return config;
}

/** Compute number[][] from AdSizeConfig's customSizes (filters out incomplete entries). */
export function configToSizeTuples(config: AdSizeConfig): number[][] {
  return config.customSizes
    .filter((s) => s.width > 0 && s.height > 0)
    .map((s) => [s.width, s.height]);
}

/** Format customSizes as display string "WxH, WxH". */
export function formatConfigSizes(config: AdSizeConfig): string {
  return config.customSizes
    .filter((s) => s.width > 0 && s.height > 0)
    .map((s) => `${s.width}x${s.height}`)
    .join(", ");
}

/** Validate a size config. Returns object with error messages for invalid fields. Empty = valid. */
export function validateSizeConfig(config: AdSizeConfig): SizeConfigErrors {
  const errors: SizeConfigErrors = {};

  if (config.ratio.x < 1 || config.ratio.y < 1) {
    errors.ratio = "Ratio values must be positive integers (≥ 1)";
  }

  const { minWidth, maxWidth, minHeight, maxHeight } = config.range;

  if (
    minWidth !== null &&
    maxWidth !== null &&
    maxWidth < minWidth
  ) {
    errors.rangeWidth = "Max Width must be ≥ Min Width";
  }
  if (
    minHeight !== null &&
    maxHeight !== null &&
    maxHeight < minHeight
  ) {
    errors.rangeHeight = "Max Height must be ≥ Min Height";
  }

  const validSizes = config.customSizes.filter(
    (s) => s.width > 0 && s.height > 0,
  );
  if (validSizes.length === 0) {
    errors.customSizes = "At least one custom size is required";
  }

  return errors;
}

/** Check whether a SizeConfigErrors object contains any errors. */
export function hasErrors(errors: SizeConfigErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Validate all placement configs. Returns true if ALL active panels are valid. */
export function validatePlacementConfigs(
  placements: Array<{
    device: "all" | "desktop" | "mobile";
    desktopSizeConfig?: AdSizeConfig;
    mobileSizeConfig?: AdSizeConfig;
  }>,
): boolean {
  for (const p of placements) {
    if (p.device !== "mobile" && p.desktopSizeConfig) {
      if (hasErrors(validateSizeConfig(p.desktopSizeConfig))) return false;
    }
    if (p.device !== "desktop" && p.mobileSizeConfig) {
      if (hasErrors(validateSizeConfig(p.mobileSizeConfig))) return false;
    }
  }
  return true;
}
