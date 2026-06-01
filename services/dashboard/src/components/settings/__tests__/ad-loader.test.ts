/**
 * T29, T30, T42 — ad-loader.js makeSlot behavior.
 *
 * These tests validate the runtime ad container sizing logic in isolation
 * without a full browser environment. They simulate what makeSlot() does.
 *
 * The applySlotSizing function mirrors the FIXED ad-loader.js logic:
 *   - Viewport-aware size selection (desktop vs mobile)
 *   - maxHeight / maxWidth hard constraints (not just min)
 *   - overflow: hidden on every slot
 */
import { describe, it, expect } from "vitest";

/**
 * Port of ad-loader.js makeSlot() sizing logic for unit testing.
 * This mirrors the FIXED logic in packages/site-builder/public/ad-loader.js
 * so we can verify behavior without an E2E browser test.
 *
 * @param sizesDesktop  Desktop size tuples from config
 * @param sizesMobile   Mobile size tuples from config
 * @param isMobile      Whether the viewport is mobile (< 768px)
 */
function applySlotSizing(
  sizesDesktop: number[][] | undefined,
  sizesMobile: number[][] | undefined,
  isMobile = false,
): {
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  width?: string;
  overflow: string;
} {
  // Pick sizes for current viewport
  const activeSizes = isMobile
    ? (sizesMobile && sizesMobile.length ? sizesMobile : sizesDesktop)
    : (sizesDesktop && sizesDesktop.length ? sizesDesktop : sizesMobile);
  const first =
    (activeSizes && activeSizes[0]) || [300, 250];

  const styles: {
    minWidth?: string;
    minHeight?: string;
    maxWidth?: string;
    maxHeight?: string;
    width?: string;
    overflow: string;
  } = { overflow: "hidden" };

  if (first[0] > 0) {
    styles.minWidth = first[0] + "px";
    styles.maxWidth = first[0] + "px";
  } else {
    styles.width = "100%";
  }
  if (first[1] > 0) {
    styles.minHeight = first[1] + "px";
    styles.maxHeight = first[1] + "px";
  }

  return styles;
}

// ---------------------------------------------------------------------------
// T29 — ad-loader handles fluid width (0xH)
// ---------------------------------------------------------------------------
describe("T29 — ad-loader fluid width container", () => {
  it("sets width:100% and minHeight+maxHeight when width=0", () => {
    const styles = applySlotSizing([[0, 250]], undefined);
    expect(styles.width).toBe("100%");
    expect(styles.minHeight).toBe("250px");
    expect(styles.maxHeight).toBe("250px");
    expect(styles.minWidth).toBeUndefined();
    expect(styles.maxWidth).toBeUndefined();
  });

  it("sets width:100% for fluid-width mobile sizes", () => {
    const styles = applySlotSizing(undefined, [[0, 90]], true);
    expect(styles.width).toBe("100%");
    expect(styles.minHeight).toBe("90px");
    expect(styles.maxHeight).toBe("90px");
  });
});

// ---------------------------------------------------------------------------
// T30 — Fixed sizes still work normally
// ---------------------------------------------------------------------------
describe("T30 — ad-loader fixed size containers", () => {
  it("sets min+max width and min+max height for standard sizes", () => {
    const styles = applySlotSizing([[728, 90]], undefined);
    expect(styles.minWidth).toBe("728px");
    expect(styles.maxWidth).toBe("728px");
    expect(styles.minHeight).toBe("90px");
    expect(styles.maxHeight).toBe("90px");
    expect(styles.width).toBeUndefined();
  });

  it("uses default 300x250 when no sizes provided", () => {
    const styles = applySlotSizing(undefined, undefined);
    expect(styles.minWidth).toBe("300px");
    expect(styles.maxWidth).toBe("300px");
    expect(styles.minHeight).toBe("250px");
    expect(styles.maxHeight).toBe("250px");
  });

  it("prefers desktop sizes on desktop viewport", () => {
    const styles = applySlotSizing([[728, 90]], [[320, 50]], false);
    expect(styles.minWidth).toBe("728px");
    expect(styles.maxWidth).toBe("728px");
    expect(styles.minHeight).toBe("90px");
    expect(styles.maxHeight).toBe("90px");
  });

  it("falls back to mobile when desktop is empty", () => {
    const styles = applySlotSizing([], [[320, 50]], false);
    expect(styles.minWidth).toBe("320px");
    expect(styles.maxWidth).toBe("320px");
    expect(styles.minHeight).toBe("50px");
    expect(styles.maxHeight).toBe("50px");
  });
});

// ---------------------------------------------------------------------------
// T42 — Mixed fixed + fluid on same page
// ---------------------------------------------------------------------------
describe("T42 — Mixed fixed + fluid placements", () => {
  it("fixed placement has min+max width/height", () => {
    const fixed = applySlotSizing([[728, 90]], undefined);
    expect(fixed.minWidth).toBe("728px");
    expect(fixed.maxWidth).toBe("728px");
    expect(fixed.minHeight).toBe("90px");
    expect(fixed.maxHeight).toBe("90px");
    expect(fixed.width).toBeUndefined();
  });

  it("fluid placement has width:100% and min+max height", () => {
    const fluid = applySlotSizing([[0, 250]], undefined);
    expect(fluid.width).toBe("100%");
    expect(fluid.minHeight).toBe("250px");
    expect(fluid.maxHeight).toBe("250px");
    expect(fluid.minWidth).toBeUndefined();
    expect(fluid.maxWidth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fluid height variant (Wx0)
// ---------------------------------------------------------------------------
describe("fluid height (Wx0)", () => {
  it("sets min+max width but no height constraints when height=0", () => {
    const styles = applySlotSizing([[300, 0]], undefined);
    expect(styles.minWidth).toBe("300px");
    expect(styles.maxWidth).toBe("300px");
    expect(styles.minHeight).toBeUndefined();
    expect(styles.maxHeight).toBeUndefined();
    expect(styles.width).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edge: both-zero fallback
// ---------------------------------------------------------------------------
describe("edge: [0,0] entry", () => {
  it("uses width:100% and no height constraints for [0,0]", () => {
    const styles = applySlotSizing([[0, 0]], undefined);
    expect(styles.width).toBe("100%");
    expect(styles.minHeight).toBeUndefined();
    expect(styles.maxHeight).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E09 — Fluid size on sidebar
// ---------------------------------------------------------------------------
describe("E09 — Fluid on sidebar", () => {
  it("fluid width fills container (width:100%) with height constraint", () => {
    const styles = applySlotSizing([[0, 600]], undefined);
    expect(styles.width).toBe("100%");
    expect(styles.minHeight).toBe("600px");
    expect(styles.maxHeight).toBe("600px");
  });
});

// ---------------------------------------------------------------------------
// Overflow: hidden on all slots
// ---------------------------------------------------------------------------
describe("overflow constraint", () => {
  it("always sets overflow:hidden on fixed slots", () => {
    const styles = applySlotSizing([[728, 90]], undefined);
    expect(styles.overflow).toBe("hidden");
  });

  it("always sets overflow:hidden on fluid slots", () => {
    const styles = applySlotSizing([[0, 120]], undefined);
    expect(styles.overflow).toBe("hidden");
  });

  it("always sets overflow:hidden with default sizes", () => {
    const styles = applySlotSizing(undefined, undefined);
    expect(styles.overflow).toBe("hidden");
  });
});

// ---------------------------------------------------------------------------
// Device targeting — viewport skip logic
// ---------------------------------------------------------------------------
describe("device targeting — viewport skip", () => {
  /**
   * Mirrors ad-loader.js device-skip logic:
   *   if (p.device === 'desktop' && isMobile) return; // skip
   *   if (p.device === 'mobile' && !isMobile) return; // skip
   */
  function shouldRender(device: string, isMobile: boolean): boolean {
    if (device === "desktop" && isMobile) return false;
    if (device === "mobile" && !isMobile) return false;
    return true;
  }

  it("skips desktop-only placement on mobile viewport", () => {
    expect(shouldRender("desktop", true)).toBe(false);
  });

  it("renders desktop-only placement on desktop viewport", () => {
    expect(shouldRender("desktop", false)).toBe(true);
  });

  it("skips mobile-only placement on desktop viewport", () => {
    expect(shouldRender("mobile", false)).toBe(false);
  });

  it("renders mobile-only placement on mobile viewport", () => {
    expect(shouldRender("mobile", true)).toBe(true);
  });

  it("renders 'all' device placement on desktop viewport", () => {
    expect(shouldRender("all", false)).toBe(true);
  });

  it("renders 'all' device placement on mobile viewport", () => {
    expect(shouldRender("all", true)).toBe(true);
  });

  it("sticky-bottom mobile-anchor: skipped on desktop", () => {
    // The taboola group config: device: "mobile"
    // On desktop viewport: should be skipped entirely
    expect(shouldRender("mobile", false)).toBe(false);
  });

  it("sidebar-sticky: skipped on mobile", () => {
    // The taboola group config: device: "desktop"
    // On mobile viewport: should be skipped entirely
    expect(shouldRender("desktop", true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Viewport-aware size selection
// ---------------------------------------------------------------------------
describe("viewport-aware size selection", () => {
  it("uses mobile sizes on mobile viewport", () => {
    const styles = applySlotSizing([[728, 90]], [[320, 50]], true);
    expect(styles.minWidth).toBe("320px");
    expect(styles.maxWidth).toBe("320px");
    expect(styles.minHeight).toBe("50px");
    expect(styles.maxHeight).toBe("50px");
  });

  it("uses desktop sizes on desktop viewport", () => {
    const styles = applySlotSizing([[728, 90]], [[320, 50]], false);
    expect(styles.minWidth).toBe("728px");
    expect(styles.maxWidth).toBe("728px");
    expect(styles.minHeight).toBe("90px");
    expect(styles.maxHeight).toBe("90px");
  });

  it("falls back to desktop on mobile when no mobile sizes", () => {
    const styles = applySlotSizing([[728, 90]], undefined, true);
    expect(styles.minWidth).toBe("728px");
    expect(styles.maxWidth).toBe("728px");
  });

  it("falls back to mobile on desktop when no desktop sizes", () => {
    const styles = applySlotSizing(undefined, [[320, 50]], false);
    expect(styles.minWidth).toBe("320px");
    expect(styles.maxWidth).toBe("320px");
  });

  it("falls back to desktop on mobile when mobile is empty array", () => {
    const styles = applySlotSizing([[728, 90]], [], true);
    expect(styles.minWidth).toBe("728px");
    expect(styles.maxWidth).toBe("728px");
  });

  describe("sticky-bottom bug scenario", () => {
    it("desktop viewport: fluid×120 with maxHeight constraint", () => {
      // Desktop: [[0, 120]] (fluid width, 120px height)
      // Mobile: [[300, 250]]
      // On desktop: should use desktop sizes, NOT mobile
      const styles = applySlotSizing([[0, 120]], [[300, 250]], false);
      expect(styles.width).toBe("100%");
      expect(styles.maxHeight).toBe("120px");
      expect(styles.minHeight).toBe("120px");
      // Should NOT be 250px from mobile sizes
      expect(styles.maxWidth).toBeUndefined();
      expect(styles.minWidth).toBeUndefined();
    });

    it("mobile viewport: 300×250 with size constraints", () => {
      // Same config, but on mobile viewport
      const styles = applySlotSizing([[0, 120]], [[300, 250]], true);
      expect(styles.minWidth).toBe("300px");
      expect(styles.maxWidth).toBe("300px");
      expect(styles.minHeight).toBe("250px");
      expect(styles.maxHeight).toBe("250px");
      expect(styles.width).toBeUndefined();
    });
  });
});
