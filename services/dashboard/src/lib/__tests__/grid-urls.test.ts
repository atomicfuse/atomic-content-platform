import { describe, expect, it } from "vitest";
import { gridPoolUrl } from "../grid-urls";

describe("gridPoolUrl", () => {
  it("Live with custom domain → production host", () => {
    expect(gridPoolUrl({ domain: "g", status: "Live", custom_domain: "grid.com" })).toBe("https://grid.com/api/pool?summaries=1");
  });
  it("otherwise → preview_url host keeping _atl_site", () => {
    expect(gridPoolUrl({ domain: "g", status: "Staging", preview_url: "https://w.workers.dev/?_atl_site=g" })).toBe("https://w.workers.dev/api/pool?_atl_site=g&summaries=1");
  });
  it("override (local dev) wins", () => {
    expect(gridPoolUrl({ domain: "g", status: "Live", custom_domain: "grid.com" }, "http://localhost:8788")).toBe("http://localhost:8788/api/pool?_atl_site=g&summaries=1");
  });
  it("no preview_url → default staging worker", () => {
    expect(gridPoolUrl({ domain: "g", status: "Staging" })).toBe("https://atomic-site-worker-staging.accounts-4a8.workers.dev/api/pool?_atl_site=g&summaries=1");
  });
});
