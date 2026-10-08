import { describe, expect, it, vi } from "vitest";
import { runLogoGeneration, type LogoGenerationSteps } from "../logo-generation-flow";

function steps(overrides: Partial<LogoGenerationSteps> = {}): LogoGenerationSteps {
  return {
    preview: vi.fn(async () => ({ logo: "L1", model: "m", contrast: 9, lowContrast: false, footerNeeded: true })),
    extras: vi.fn(async () => ({ favicon: "F", footerLogo: null })),
    ...overrides,
  };
}

describe("runLogoGeneration", () => {
  it("logo, then favicon/footer in a separate call", async () => {
    const s = steps();
    const onLogo = vi.fn();
    const out = await runLogoGeneration(s, { onLogo });
    expect(out).toEqual({ logo: "L1", model: "m", favicon: "F", footerLogo: null });
    expect(onLogo).toHaveBeenCalledWith("L1", "m", true);
    expect(s.extras).toHaveBeenCalledWith("L1");
  });

  it("a faint logo is retried once and the clearer one kept", async () => {
    const preview = vi.fn()
      .mockResolvedValueOnce({ logo: "FAINT", model: "m", contrast: 1.4, lowContrast: true, footerNeeded: false })
      .mockResolvedValueOnce({ logo: "CLEAR", model: "m", contrast: 8, lowContrast: false, footerNeeded: false });
    const s = steps({ preview });
    const out = await runLogoGeneration(s, {});
    expect(preview).toHaveBeenNthCalledWith(2, { retryForContrast: true });
    expect(out?.logo).toBe("CLEAR");
    expect(s.extras).toHaveBeenCalledWith("CLEAR");
  });

  it("keeps the first logo when the retry fails or is fainter", async () => {
    const preview = vi.fn()
      .mockResolvedValueOnce({ logo: "FAINT", model: "m", contrast: 2, lowContrast: true, footerNeeded: false })
      .mockRejectedValueOnce(new Error("504"));
    const out = await runLogoGeneration(steps({ preview }), {});
    expect(out?.logo).toBe("FAINT");
  });

  it("returns null when no logo could be made, without asking for extras", async () => {
    const s = steps({ preview: vi.fn(async () => ({ logo: null, model: null, contrast: null, lowContrast: false, footerNeeded: false })) });
    expect(await runLogoGeneration(s, {})).toBeNull();
    expect(s.extras).not.toHaveBeenCalled();
  });

  it("a failed favicon/footer step still returns the logo", async () => {
    const out = await runLogoGeneration(steps({ extras: vi.fn(async () => { throw new Error("504"); }) }), {});
    expect(out).toEqual({ logo: "L1", model: "m", favicon: null, footerLogo: null });
  });

  it("reports each step in order: logo → retry → extras → done", async () => {
    const preview = vi.fn()
      .mockResolvedValueOnce({ logo: "FAINT", model: "m", contrast: 1.4, lowContrast: true, footerNeeded: false })
      .mockResolvedValueOnce({ logo: "CLEAR", model: "m", contrast: 8, lowContrast: false, footerNeeded: false });
    const onStep = vi.fn();
    await runLogoGeneration(steps({ preview }), { onStep });
    expect(onStep.mock.calls.map(([s]) => s)).toEqual(["logo", "retry", "extras", "done"]);
  });
});
