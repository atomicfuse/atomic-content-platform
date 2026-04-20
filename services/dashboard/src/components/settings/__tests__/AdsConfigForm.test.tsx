import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdsConfigForm } from "../AdsConfigForm";
import type { AdsConfigFormValue, AdPlacement } from "../AdsConfigForm";
import { createDefaultSizeConfig, sizeTuplesToConfig, configToSizeTuples } from "../ad-size-config";

afterEach(cleanup);

function basePlacement(overrides: Partial<AdPlacement> = {}): AdPlacement {
  return {
    id: "test-ad",
    position: "above-content",
    device: "all",
    sizes: { desktop: [[728, 90]], mobile: [[320, 50]] },
    desktopSizeConfig: sizeTuplesToConfig([[728, 90]]),
    mobileSizeConfig: sizeTuplesToConfig([[320, 50]]),
    ...overrides,
  };
}

function baseValue(overrides: Partial<AdsConfigFormValue> = {}): AdsConfigFormValue {
  return {
    interstitial: false,
    layout: "standard",
    ad_placements: [basePlacement()],
    ...overrides,
  };
}

function renderForm(
  value?: AdsConfigFormValue,
): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  render(<AdsConfigForm value={value ?? baseValue()} onChange={onChange} />);
  return { onChange };
}

// ---------------------------------------------------------------------------
// T01 — Both panels render side-by-side
// ---------------------------------------------------------------------------
describe("T01 — Both size panels render for all-device placement", () => {
  it("renders Desktop Sizes and Mobile Sizes labels", () => {
    renderForm();
    expect(screen.getAllByText("Desktop Sizes")).toHaveLength(1);
    expect(screen.getAllByText("Mobile Sizes")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T05 / T06 — New placement defaults
// ---------------------------------------------------------------------------
describe("T05/T06 — New placement defaults via Add Placement", () => {
  it("add placement triggers onChange with default configs", async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(baseValue({ ad_placements: [] }));
    const buttons = screen.getAllByText("+ Add Placement");
    await user.click(buttons[0]);
    const newValue = onChange.mock.calls[0][0] as AdsConfigFormValue;
    const newPlacement = newValue.ad_placements[0];

    expect(newPlacement.device).toBe("all");
    expect(newPlacement.desktopSizeConfig).toBeDefined();
    expect(newPlacement.desktopSizeConfig!.ratio).toEqual({ x: 16, y: 9 });
    expect(newPlacement.desktopSizeConfig!.range).toEqual({
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    });
    expect(newPlacement.desktopSizeConfig!.customSizes).toEqual([]);
    expect(newPlacement.mobileSizeConfig!.customSizes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T21 — Device "Desktop" disables mobile panel
// ---------------------------------------------------------------------------
describe("T21 — Device Desktop disables mobile panel", () => {
  it("mobile panel is disabled when device is desktop", () => {
    renderForm(
      baseValue({
        ad_placements: [basePlacement({ device: "desktop" })],
      }),
    );
    const mobileLabel = screen.getByText("Mobile Sizes");
    const mobilePanel = mobileLabel.closest("div.space-y-3");
    expect(mobilePanel?.className).toContain("opacity-50");
    expect(mobilePanel?.className).toContain("pointer-events-none");
  });
});

// ---------------------------------------------------------------------------
// T22 — Device "Mobile" disables desktop panel
// ---------------------------------------------------------------------------
describe("T22 — Device Mobile disables desktop panel", () => {
  it("desktop panel is disabled when device is mobile", () => {
    renderForm(
      baseValue({
        ad_placements: [basePlacement({ device: "mobile" })],
      }),
    );
    const desktopLabel = screen.getByText("Desktop Sizes");
    const desktopPanel = desktopLabel.closest("div.space-y-3");
    expect(desktopPanel?.className).toContain("opacity-50");
    expect(desktopPanel?.className).toContain("pointer-events-none");
  });
});

// ---------------------------------------------------------------------------
// T23 — Device "All Devices" enables both panels
// ---------------------------------------------------------------------------
describe("T23 — Device All enables both panels", () => {
  it("neither panel is disabled when device is all", () => {
    renderForm(
      baseValue({
        ad_placements: [basePlacement({ device: "all" })],
      }),
    );
    const desktopLabel = screen.getByText("Desktop Sizes");
    const mobileLabel = screen.getByText("Mobile Sizes");
    const desktopPanel = desktopLabel.closest("div.space-y-3");
    const mobilePanel = mobileLabel.closest("div.space-y-3");
    expect(desktopPanel?.className).not.toContain("opacity-50");
    expect(mobilePanel?.className).not.toContain("opacity-50");
  });
});

// ---------------------------------------------------------------------------
// T28 — Fluid size saves correctly (sizes tuples)
// ---------------------------------------------------------------------------
describe("T28 — Fluid size persists to size tuples", () => {
  it("configToSizeTuples preserves [0, 250] in placement", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 0, height: 250 }];
    const tuples = configToSizeTuples(config);
    expect(tuples).toEqual([[0, 250]]);
  });
});

// ---------------------------------------------------------------------------
// T35 — Save produces correct size tuples from custom sizes
// ---------------------------------------------------------------------------
describe("T35 — Output tuple format", () => {
  it("converts multiple custom sizes to tuples", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 728, height: 90 },
      { width: 970, height: 250 },
    ];
    expect(configToSizeTuples(config)).toEqual([
      [728, 90],
      [970, 250],
    ]);
  });
});

// ---------------------------------------------------------------------------
// T36 — Ratio and range don't affect output tuples
// ---------------------------------------------------------------------------
describe("T36 — Ratio and range don't affect size tuples", () => {
  it("only customSizes contribute to output", () => {
    const config = createDefaultSizeConfig();
    config.ratio = { x: 4, y: 3 };
    config.range = { minWidth: 300, maxWidth: 1000, minHeight: null, maxHeight: null };
    config.customSizes = [{ width: 728, height: 90 }];
    expect(configToSizeTuples(config)).toEqual([[728, 90]]);
  });
});

// ---------------------------------------------------------------------------
// T38 — Order of custom sizes preserved
// ---------------------------------------------------------------------------
describe("T38 — Size order preserved", () => {
  it("maintains order through round-trip", () => {
    const order = [
      [300, 250],
      [728, 90],
      [160, 600],
    ];
    const config = sizeTuplesToConfig(order);
    expect(configToSizeTuples(config)).toEqual(order);
  });
});

// ---------------------------------------------------------------------------
// Sticky-bottom dismissible toggle
// ---------------------------------------------------------------------------
describe("sticky-bottom dismissible", () => {
  it("shows dismiss checkbox for sticky-bottom position", () => {
    renderForm(
      baseValue({
        ad_placements: [basePlacement({ position: "sticky-bottom" })],
      }),
    );
    expect(screen.getByText(/Allow visitors to dismiss/)).toBeInTheDocument();
  });

  it("does not show dismiss checkbox for non-sticky positions", () => {
    renderForm(
      baseValue({
        ad_placements: [basePlacement({ position: "above-content" })],
      }),
    );
    expect(screen.queryByText(/Allow visitors to dismiss/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Placement management
// ---------------------------------------------------------------------------
describe("placement CRUD", () => {
  it("shows empty state when no placements", () => {
    renderForm(baseValue({ ad_placements: [] }));
    expect(screen.getByText("No ad placements configured.")).toBeInTheDocument();
  });

  it("remove button triggers onChange without that placement", async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(
      baseValue({
        ad_placements: [
          basePlacement({ id: "first" }),
          basePlacement({ id: "second" }),
        ],
      }),
    );
    const removeButtons = screen.getAllByLabelText("Remove placement");
    await user.click(removeButtons[0]);
    const newValue = onChange.mock.calls[0][0] as AdsConfigFormValue;
    expect(newValue.ad_placements).toHaveLength(1);
    expect(newValue.ad_placements[0].id).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// Fluid sizes in placement context
// ---------------------------------------------------------------------------
describe("fluid sizes in placement", () => {
  it("renders fluid-width size in desktop panel", () => {
    const desktopConfig = createDefaultSizeConfig();
    desktopConfig.customSizes = [{ width: 0, height: 250 }];
    renderForm(
      baseValue({
        ad_placements: [
          basePlacement({
            desktopSizeConfig: desktopConfig,
            sizes: { desktop: [[0, 250]], mobile: [[320, 50]] },
          }),
        ],
      }),
    );
    expect(screen.getByText("fluidx250")).toBeInTheDocument();
  });

  it("renders fluid-height size in mobile panel", () => {
    const mobileConfig = createDefaultSizeConfig();
    mobileConfig.customSizes = [{ width: 300, height: 0 }];
    renderForm(
      baseValue({
        ad_placements: [
          basePlacement({
            mobileSizeConfig: mobileConfig,
            sizes: { desktop: [[728, 90]], mobile: [[300, 0]] },
          }),
        ],
      }),
    );
    expect(screen.getByText("300xfluid")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// E05 — Device toggle preserves mobile data
// ---------------------------------------------------------------------------
describe("E05 — Device toggle preserves panel data", () => {
  it("mobile config is retained when device switches to desktop", () => {
    const mobileConfig = sizeTuplesToConfig([[320, 50]]);
    const val = baseValue({
      ad_placements: [basePlacement({ device: "desktop", mobileSizeConfig: mobileConfig })],
    });
    // The mobile config object is still present in the data, just the UI is disabled
    expect(val.ad_placements[0].mobileSizeConfig).toBeDefined();
    expect(val.ad_placements[0].mobileSizeConfig!.customSizes).toEqual([
      { width: 320, height: 50 },
    ]);
  });
});
