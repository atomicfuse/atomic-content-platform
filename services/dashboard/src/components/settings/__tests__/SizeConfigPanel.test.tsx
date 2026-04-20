import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SizeConfigPanel } from "../SizeConfigPanel";
import type { AdSizeConfig } from "../ad-size-config";
import { createDefaultSizeConfig, sizeTuplesToConfig } from "../ad-size-config";

afterEach(cleanup);

function renderPanel(
  overrides: Partial<{
    label: string;
    config: AdSizeConfig;
    disabled: boolean;
  }> = {},
): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  render(
    <SizeConfigPanel
      label={overrides.label ?? "Desktop Sizes"}
      config={overrides.config ?? sizeTuplesToConfig([[728, 90]])}
      onChange={onChange}
      disabled={overrides.disabled ?? false}
    />,
  );
  return { onChange };
}

/** Stateful wrapper that re-renders on change — for typing tests. */
function StatefulPanel(props: {
  initial: AdSizeConfig;
  onChangeSpy: (config: AdSizeConfig) => void;
  label?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [config, setConfig] = useState(props.initial);
  return (
    <SizeConfigPanel
      label={props.label ?? "Desktop Sizes"}
      config={config}
      onChange={(c): void => {
        setConfig(c);
        props.onChangeSpy(c);
      }}
      disabled={props.disabled ?? false}
    />
  );
}

function renderStatefulPanel(
  initial: AdSizeConfig,
  label?: string,
): { onChangeSpy: ReturnType<typeof vi.fn> } {
  const onChangeSpy = vi.fn();
  render(
    <StatefulPanel initial={initial} onChangeSpy={onChangeSpy} label={label} />,
  );
  return { onChangeSpy };
}

// ---------------------------------------------------------------------------
// T02 — Panel labels
// ---------------------------------------------------------------------------
describe("T02 — Panel labels are correct", () => {
  it("renders the given label", () => {
    renderPanel({ label: "Desktop Sizes" });
    expect(screen.getByText("Desktop Sizes")).toBeInTheDocument();
  });

  it("renders a different label", () => {
    renderPanel({ label: "Mobile Sizes" });
    expect(screen.getByText("Mobile Sizes")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T03 — All sub-fields render in each panel
// ---------------------------------------------------------------------------
describe("T03 — All sub-fields render", () => {
  it("renders Aspect Ratio section", () => {
    renderPanel();
    expect(screen.getByText("Aspect Ratio")).toBeInTheDocument();
  });

  it("renders Size Range section with all 4 labels", () => {
    renderPanel();
    expect(screen.getByText("Size Range")).toBeInTheDocument();
    expect(screen.getByText("Min Width")).toBeInTheDocument();
    expect(screen.getByText("Max Width")).toBeInTheDocument();
    expect(screen.getByText("Min Height")).toBeInTheDocument();
    expect(screen.getByText("Max Height")).toBeInTheDocument();
  });

  it("renders Custom Sizes section with add button", () => {
    renderPanel();
    expect(screen.getByText("Custom Sizes")).toBeInTheDocument();
    expect(screen.getByText("+ Add Custom Size")).toBeInTheDocument();
  });

  it("renders Rendered Sizes preview for non-empty sizes", () => {
    renderPanel({ config: sizeTuplesToConfig([[728, 90]]) });
    expect(screen.getByText("Rendered Sizes")).toBeInTheDocument();
    expect(screen.getByText("728x90")).toBeInTheDocument();
  });

  it("does not render preview when no valid sizes", () => {
    renderPanel({ config: createDefaultSizeConfig() });
    expect(screen.queryByText("Rendered Sizes")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T05 — New placement default ratio
// ---------------------------------------------------------------------------
describe("T05 — Default ratio values", () => {
  it("shows 16:9 as default ratio", () => {
    renderPanel({ config: createDefaultSizeConfig() });
    const inputs = screen.getAllByRole("spinbutton");
    // Ratio X and Y are the first two number inputs
    expect(inputs[0]).toHaveValue(16);
    expect(inputs[1]).toHaveValue(9);
  });
});

// ---------------------------------------------------------------------------
// T06 — New placement has empty range
// ---------------------------------------------------------------------------
describe("T06 — Default range and custom sizes", () => {
  it("all range fields are empty for default config", () => {
    renderPanel({ config: createDefaultSizeConfig() });
    const inputs = screen.getAllByRole("spinbutton");
    // After ratio X and Y (indices 0,1), range fields are 2,3,4,5
    expect(inputs[2]).toHaveValue(null); // minWidth
    expect(inputs[3]).toHaveValue(null); // maxWidth
    expect(inputs[4]).toHaveValue(null); // minHeight
    expect(inputs[5]).toHaveValue(null); // maxHeight
  });
});

// ---------------------------------------------------------------------------
// T07 — Ratio X is editable
// ---------------------------------------------------------------------------
describe("T07 — Ratio X editing", () => {
  it("calls onChange with updated ratio x", async () => {
    const user = userEvent.setup();
    const { onChangeSpy } = renderStatefulPanel(sizeTuplesToConfig([[728, 90]]));
    const inputs = screen.getAllByRole("spinbutton");
    const ratioX = inputs[0];
    // Select all text then type replacement (clear doesn't work because handler clamps to 1)
    await user.tripleClick(ratioX);
    await user.keyboard("4");
    const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0] as AdSizeConfig;
    expect(lastCall.ratio.x).toBe(4);
    expect(lastCall.ratio.y).toBe(9); // unchanged
  });
});

// ---------------------------------------------------------------------------
// T08 — Ratio Y is editable
// ---------------------------------------------------------------------------
describe("T08 — Ratio Y editing", () => {
  it("calls onChange with updated ratio y", async () => {
    const user = userEvent.setup();
    const { onChangeSpy } = renderStatefulPanel(sizeTuplesToConfig([[728, 90]]));
    const inputs = screen.getAllByRole("spinbutton");
    const ratioY = inputs[1];
    await user.tripleClick(ratioY);
    await user.keyboard("3");
    const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0] as AdSizeConfig;
    expect(lastCall.ratio.y).toBe(3);
    expect(lastCall.ratio.x).toBe(16); // unchanged
  });
});

// ---------------------------------------------------------------------------
// T09 — Ratio rejects non-positive values
// ---------------------------------------------------------------------------
describe("T09 — Ratio validation", () => {
  it("shows error when ratio x < 1", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.ratio.x = 0;
    renderPanel({ config });
    expect(
      screen.getByText(/Ratio values must be positive/),
    ).toBeInTheDocument();
  });

  it("shows error when ratio y < 1", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.ratio.y = 0;
    renderPanel({ config });
    expect(
      screen.getByText(/Ratio values must be positive/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T10 — Range fields accept valid values
// ---------------------------------------------------------------------------
describe("T10 — Min Width accepts valid positive integer", () => {
  it("calls onChange with updated range minWidth", async () => {
    const user = userEvent.setup();
    const { onChangeSpy } = renderStatefulPanel(sizeTuplesToConfig([[728, 90]]));
    const inputs = screen.getAllByRole("spinbutton");
    await user.type(inputs[2], "300"); // minWidth
    const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0] as AdSizeConfig;
    expect(lastCall.range.minWidth).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// T11 — Max Width < Min Width shows error
// ---------------------------------------------------------------------------
describe("T11 — Max Width enforces >= Min Width", () => {
  it("shows error when maxWidth < minWidth", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.range.minWidth = 500;
    config.range.maxWidth = 200;
    renderPanel({ config });
    expect(screen.getByText("Max Width must be ≥ Min Width")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T12 — Max Width constraint updates dynamically
// ---------------------------------------------------------------------------
describe("T12 — Range constraint is dynamic", () => {
  it("error appears when minWidth exceeds existing maxWidth", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.range.minWidth = 600;
    config.range.maxWidth = 500;
    renderPanel({ config });
    expect(screen.getByText("Max Width must be ≥ Min Width")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T13 — Max Height enforces >= Min Height
// ---------------------------------------------------------------------------
describe("T13 — Max Height enforces >= Min Height", () => {
  it("shows error when maxHeight < minHeight", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.range.minHeight = 200;
    config.range.maxHeight = 50;
    renderPanel({ config });
    expect(screen.getByText("Max Height must be ≥ Min Height")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T14 — Range fields accept empty (optional)
// ---------------------------------------------------------------------------
describe("T14 — Range fields are optional", () => {
  it("no errors when all range fields are empty", () => {
    renderPanel({ config: sizeTuplesToConfig([[728, 90]]) });
    expect(screen.queryByText(/must be ≥/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T15 — Add a custom size
// ---------------------------------------------------------------------------
describe("T15 — Add custom size row", () => {
  it("clicking + Add Custom Size fires onChange with new empty row", async () => {
    const user = userEvent.setup();
    const config = sizeTuplesToConfig([[728, 90]]);
    const { onChange } = renderPanel({ config });
    await user.click(screen.getByText("+ Add Custom Size"));
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as AdSizeConfig;
    expect(lastCall.customSizes).toHaveLength(2);
    expect(lastCall.customSizes[1]).toEqual({ width: 0, height: 0 });
  });
});

// ---------------------------------------------------------------------------
// T16 — Enter valid custom size (rendered preview)
// ---------------------------------------------------------------------------
describe("T16 — Valid custom size preview", () => {
  it("shows size in rendered preview", () => {
    renderPanel({ config: sizeTuplesToConfig([[728, 90]]) });
    expect(screen.getByText("728x90")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T17 — Multiple custom sizes in preview
// ---------------------------------------------------------------------------
describe("T17 — Multiple custom sizes preview", () => {
  it("shows all sizes comma-separated", () => {
    const config = sizeTuplesToConfig([
      [728, 90],
      [970, 90],
      [300, 250],
    ]);
    renderPanel({ config });
    expect(screen.getByText("728x90, 970x90, 300x250")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T18 — Remove a custom size
// ---------------------------------------------------------------------------
describe("T18 — Remove custom size", () => {
  it("fires onChange with filtered customSizes when × clicked", async () => {
    const user = userEvent.setup();
    const config = sizeTuplesToConfig([
      [728, 90],
      [970, 90],
      [300, 250],
    ]);
    const { onChange } = renderPanel({ config });
    const removeButtons = screen.getAllByLabelText("Remove size");
    await user.click(removeButtons[1]); // remove second
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as AdSizeConfig;
    expect(lastCall.customSizes).toHaveLength(2);
    expect(lastCall.customSizes).toEqual([
      { width: 728, height: 90 },
      { width: 300, height: 250 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// T19 — Cannot save with zero custom sizes
// ---------------------------------------------------------------------------
describe("T19 — Error when no custom sizes", () => {
  it("shows validation error when customSizes is empty", () => {
    renderPanel({ config: createDefaultSizeConfig() });
    expect(
      screen.getByText(/At least one custom size is required/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T24 — Width field can be left empty (fluid width)
// ---------------------------------------------------------------------------
describe("T24 — Fluid width: no validation error", () => {
  it("width=0 with height>0 is valid", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 0, height: 250 }];
    renderPanel({ config });
    expect(screen.queryByText(/At least one custom size/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T25 — Fluid width renders as fluidxH in preview
// ---------------------------------------------------------------------------
describe("T25 — Fluid width preview format", () => {
  it("shows fluidx250 for fluid-width entry", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 0, height: 250 }];
    renderPanel({ config });
    expect(screen.getByText("fluidx250")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T26 — Mixed fixed + fluid sizes render correctly
// ---------------------------------------------------------------------------
describe("T26 — Mixed sizes preview", () => {
  it("shows both fixed and fluid entries", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 728, height: 90 },
      { width: 0, height: 250 },
    ];
    renderPanel({ config });
    expect(screen.getByText("728x90, fluidx250")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T27 — Both empty = invalid
// ---------------------------------------------------------------------------
describe("T27 — Both dimensions empty is invalid", () => {
  it("shows error when only 0x0 entries exist", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 0, height: 0 }];
    renderPanel({ config });
    expect(
      screen.getByText(/At least one custom size is required/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Disabled panel behavior (T21-T23 partial — panel-level)
// ---------------------------------------------------------------------------
describe("disabled panel", () => {
  it("does not show validation errors when disabled", () => {
    renderPanel({ config: createDefaultSizeConfig(), disabled: true });
    expect(screen.queryByText(/At least one custom size/)).not.toBeInTheDocument();
  });

  it("inputs are disabled when panel is disabled", () => {
    renderPanel({
      config: sizeTuplesToConfig([[728, 90]]),
      disabled: true,
    });
    const inputs = screen.getAllByRole("spinbutton");
    for (const input of inputs) {
      expect(input).toBeDisabled();
    }
  });
});

// ---------------------------------------------------------------------------
// Fluid height (Wxfluid) variant
// ---------------------------------------------------------------------------
describe("fluid height", () => {
  it("width>0 height=0 shows Wxfluid preview", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 300, height: 0 }];
    renderPanel({ config });
    expect(screen.getByText("300xfluid")).toBeInTheDocument();
  });

  it("height=0 is valid as long as width>0", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 300, height: 0 }];
    renderPanel({ config });
    expect(screen.queryByText(/At least one custom size/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// E06 — All custom sizes are fluid
// ---------------------------------------------------------------------------
describe("E06 — All fluid sizes are valid", () => {
  it("all fluid-width entries are valid", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 0, height: 90 },
      { width: 0, height: 250 },
    ];
    renderPanel({ config });
    expect(screen.queryByText(/At least one custom size/)).not.toBeInTheDocument();
    expect(screen.getByText("fluidx90, fluidx250")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// E07 — Mixed fluid + fixed + fluid order preserved
// ---------------------------------------------------------------------------
describe("E07 — Order preserved in mixed sizes", () => {
  it("renders in exact order", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 0, height: 90 },
      { width: 728, height: 90 },
      { width: 0, height: 250 },
    ];
    renderPanel({ config });
    expect(screen.getByText("fluidx90, 728x90, fluidx250")).toBeInTheDocument();
  });
});
