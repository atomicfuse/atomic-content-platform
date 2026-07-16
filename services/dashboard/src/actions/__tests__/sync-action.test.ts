import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cloudflare", () => ({ listDomainsWithPagesInfo: vi.fn() }));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(),
  updateDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
  deleteDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/site-configs", () => ({ getSiteConfig: vi.fn() }));
vi.mock("@/lib/github", () => ({ writeDashboardIndex: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { syncDomainsFromCloudflare } from "../sync";
import { listDomainsWithPagesInfo } from "@/lib/cloudflare";
import {
  getDashboardIndex,
  updateDashboardIndexEntry,
  deleteDashboardIndexEntry,
} from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";
import { writeDashboardIndex } from "@/lib/github";

describe("syncDomainsFromCloudflare — MongoDB dual-write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDomainsWithPagesInfo).mockResolvedValue([]);
    vi.mocked(getSiteConfig).mockResolvedValue(null);
  });

  it("mirrors a status change to MongoDB (stuck-Ready site heals in the UI, not just git)", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({
      sites: [
        {
          domain: "dogslabs",
          staging_branch: "staging/dogslabs",
          status: "Ready",
          custom_domain: "dogslabs.com",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);

    await syncDomainsFromCloudflare();

    expect(writeDashboardIndex).toHaveBeenCalled();
    expect(updateDashboardIndexEntry).toHaveBeenCalledWith(
      "dogslabs",
      expect.objectContaining({ status: "Live" }),
    );
  });

  it("mirrors orphan removal to MongoDB", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({
      sites: [
        {
          domain: "ghost-site",
          staging_branch: null,
          status: "Staging",
          custom_domain: null,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);

    await syncDomainsFromCloudflare();

    expect(deleteDashboardIndexEntry).toHaveBeenCalledWith("ghost-site");
  });

  it("does not touch MongoDB when nothing changed", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({
      sites: [
        {
          domain: "dogslabs",
          staging_branch: "staging/dogslabs",
          status: "Live",
          custom_domain: "dogslabs.com",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);

    await syncDomainsFromCloudflare();

    expect(writeDashboardIndex).not.toHaveBeenCalled();
    expect(updateDashboardIndexEntry).not.toHaveBeenCalled();
    expect(deleteDashboardIndexEntry).not.toHaveBeenCalled();
  });
});
