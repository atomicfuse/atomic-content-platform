import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingSite } from "@/lib/pending-changes";

afterEach(cleanup);

// The real server action is never loaded: nothing in this file can publish.
const publishMock = vi.fn<(domain: string) => Promise<void>>();
vi.mock("@/actions/wizard", () => ({
  publishStagingToProduction: (domain: string) => publishMock(domain),
}));

import { BulkPublishModal } from "../BulkPublishModal";

function site(domain: string, overrides: Partial<PendingSite> = {}): PendingSite {
  return {
    domain,
    status: "Live",
    files: [{ filename: `sites/${domain}/site.yaml`, status: "modified" }],
    added: 0,
    modified: 1,
    removed: 0,
    deletedArticles: [],
    truncated: false,
    ...overrides,
  };
}

const ALPHA = site("alpha.com", {
  files: [
    { filename: "sites/alpha.com/site.yaml", status: "modified" },
    { filename: "sites/alpha.com/articles/old-one.md", status: "removed" },
    { filename: "sites/alpha.com/articles/old-two.md", status: "removed" },
  ],
  modified: 1,
  removed: 2,
  deletedArticles: ["old-one", "old-two"],
});
// Fix round 1: truncated sites are no longer selectable, so the flow fixture
// is a normal Ready site; truncation has its own tests below.
const BETA = site("beta.com", { status: "Ready", added: 3, modified: 0 });
const GAMMA = site("gamma.com");

interface FetchPlan {
  scan: { sites: PendingSite[]; errors?: Array<{ domain: string; message: string }> };
  scheduler?: () => { status: number; body: unknown };
  /** Fresh single-domain re-check result; defaults to the scan entry. */
  recheck?: (domain: string) => PendingSite | null;
}

let fetchCalls: string[] = [];

function mockFetch(plan: FetchPlan): void {
  fetchCalls = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);
    if (url === "/api/sites/pending-changes") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ scannedAt: "2026-09-30T00:00:00Z", scanned: 5, errors: [], ...plan.scan }),
      } as Response;
    }
    if (url.startsWith("/api/sites/pending-changes?domain=")) {
      const domain = decodeURIComponent(url.split("=")[1] ?? "");
      const fresh = plan.recheck
        ? plan.recheck(domain)
        : plan.scan.sites.find((s) => s.domain === domain) ?? null;
      return {
        ok: true,
        status: 200,
        json: async () => ({ scannedAt: "x", scanned: 1, sites: fresh ? [fresh] : [], errors: [] }),
      } as Response;
    }
    if (url === "/api/scheduler/active-run") {
      const r = plan.scheduler ? plan.scheduler() : { status: 200, body: { status: "none" } };
      return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function renderModal(onPublished = vi.fn(), onClose = vi.fn()): {
  onPublished: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  render(<BulkPublishModal open onClose={onClose} eligibleCount={5} onPublished={onPublished} />);
  return { onPublished, onClose };
}

beforeEach(() => {
  publishMock.mockReset();
  publishMock.mockResolvedValue(undefined);
});

// bulkPublishSite logs failures server-side; keep test output clean.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("BulkPublishModal", () => {
  it("runs the whole flow: scan, review, confirm with deletion confirmation, run, retry failed", async () => {
    const user = userEvent.setup();
    mockFetch({
      scan: { sites: [ALPHA, BETA, GAMMA], errors: [{ domain: "broken.com", message: "Not Found" }] },
    });
    let betaAttempts = 0;
    publishMock.mockImplementation(async (d: string) => {
      if (d === "beta.com" && betaAttempts++ === 0) throw new Error("merge conflict on main");
    });
    const { onPublished } = renderModal();

    // Scan
    expect(screen.getByRole("status")).toHaveTextContent("Checking 5 sites for unpublished changes");

    // Review
    await screen.findByText("alpha.com");
    expect(screen.getByText("2 articles deleted")).toBeInTheDocument();
    expect(screen.getByText(/including other people's unpublished edits/)).toBeInTheDocument();
    expect(screen.getByText("0 added · 1 changed · 2 deleted")).toBeInTheDocument();
    expect(screen.getByText("1 site couldn't be checked")).toBeInTheDocument();
    expect(screen.getByText(/Not Found/)).toBeInTheDocument();

    // Expand a row's file list
    await user.click(screen.getByRole("button", { name: "Show files for alpha.com" }));
    expect(screen.getByText("articles/old-one.md")).toBeInTheDocument();

    // All checked by default; deselect gamma
    const gammaBox = screen.getByRole("checkbox", { name: "Publish gamma.com" });
    expect(gammaBox).toBeChecked();
    await user.click(gammaBox);
    expect(screen.getByText("2 of 3 sites selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue with 2 sites" }));

    // Confirm
    await user.click(screen.getByRole("button", { name: "Publish 2 sites" }));

    // Second, explicit deletion confirmation
    expect(screen.getByText("2 live articles will be permanently deleted")).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete articles and publish" }));

    // Run results
    await screen.findByText(/Done: 1 published, 1 failed/);
    expect(within(screen.getByTestId("run-row-alpha.com")).getByText("Published")).toBeInTheDocument();
    expect(within(screen.getByTestId("run-row-beta.com")).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("merge conflict on main")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-progress")).toHaveTextContent("2 / 2");
    expect(publishMock.mock.calls.map((c) => c[0])).toEqual(["alpha.com", "beta.com"]);
    expect(screen.queryByTestId("run-row-gamma.com")).not.toBeInTheDocument();
    expect(onPublished).toHaveBeenCalledTimes(1);

    // Each site was preceded by a scheduler check and a fresh re-check.
    expect(fetchCalls.filter((u) => u === "/api/scheduler/active-run")).toHaveLength(2);
    expect(fetchCalls).toContain("/api/sites/pending-changes?domain=beta.com");

    // Retry failed: only beta goes again.
    await user.click(screen.getByRole("button", { name: "Retry failed (1)" }));
    await screen.findByText("Done: 2 published");
    expect(publishMock.mock.calls.map((c) => c[0])).toEqual(["alpha.com", "beta.com", "beta.com"]);
    expect(onPublished).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state when no site has unpublished changes", async () => {
    mockFetch({ scan: { sites: [] } });
    renderModal();
    expect(await screen.findByText("No sites have unpublished changes")).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("skips the deletion confirmation when nothing is deleted, and skips a site that no longer has changes", async () => {
    const user = userEvent.setup();
    mockFetch({
      scan: { sites: [BETA, GAMMA] },
      recheck: (d) => (d === "gamma.com" ? null : BETA),
    });
    renderModal();
    await screen.findByText("beta.com");
    await user.click(screen.getByRole("button", { name: "Continue with 2 sites" }));
    await user.click(screen.getByRole("button", { name: "Publish 2 sites" }));
    await screen.findByText(/Done: 1 published/);
    expect(within(screen.getByTestId("run-row-gamma.com")).getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("No longer has changes")).toBeInTheDocument();
    expect(publishMock.mock.calls.map((c) => c[0])).toEqual(["beta.com"]);
  });

  it("fails a site whose re-check reveals article deletions that were not confirmed", async () => {
    const user = userEvent.setup();
    mockFetch({
      scan: { sites: [GAMMA] },
      recheck: () => ({ ...GAMMA, removed: 1, deletedArticles: ["surprise"] }),
    });
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));
    await screen.findByText(/Done: 0 published, 1 failed/);
    expect(screen.getByText(/1 new article deletion appeared since review \(surprise\)/)).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("pauses while the scheduler is running and resumes on request", async () => {
    const user = userEvent.setup();
    let schedulerActive = true;
    mockFetch({
      scan: { sites: [GAMMA] },
      scheduler: () => ({ status: 200, body: schedulerActive ? { status: "active", runId: "r1" } : { status: "none" } }),
    });
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));

    expect(await screen.findByText(/Paused: the scheduler is running/)).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();

    schedulerActive = false;
    await user.click(screen.getByRole("button", { name: "Resume" }));
    await screen.findByText("Done: 1 published");
    expect(publishMock).toHaveBeenCalledWith("gamma.com");
  });

  it("warns when the scheduler state is unknown and continues only when the user chooses to", async () => {
    const user = userEvent.setup();
    mockFetch({
      scan: { sites: [GAMMA] },
      scheduler: () => ({ status: 502, body: { status: "error", message: "fetch failed" } }),
    });
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));

    expect(await screen.findByText(/Couldn't check whether the scheduler is running/)).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue anyway" }));
    await screen.findByText("Done: 1 published");
  });

  it("closing during a run asks first, then cancels after the current site", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    publishMock.mockImplementation(
      (d: string) =>
        new Promise<void>((resolve) => {
          if (d === "beta.com") release = resolve;
          else resolve();
        }),
    );
    mockFetch({ scan: { sites: [BETA, GAMMA] } });
    const { onClose, onPublished } = renderModal();
    await screen.findByText("beta.com");
    await user.click(screen.getByRole("button", { name: "Continue with 2 sites" }));
    await user.click(screen.getByRole("button", { name: "Publish 2 sites" }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith("beta.com"));

    // Escape is the modal's close path (same handler as the header X and overlay).
    await user.keyboard("{Escape}");
    expect(screen.getByText(/Stop publishing\?/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Stop and close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    expect(publishMock.mock.calls.map((c) => c[0])).toEqual(["beta.com"]);
  });
});

describe("BulkPublishModal: fix round 1", () => {
  beforeEach(async () => {
    const { setBulkPublishBusy } = await import("@/lib/bulk-publish-activity");
    setBulkPublishBusy(false);
  });

  const HUGE = site("huge.com", { truncated: true, removed: 4, deletedArticles: ["a", "b", "c", "d"] });

  it("shows a truncated site disabled and never selects it, even with Select all", async () => {
    const user = userEvent.setup();
    mockFetch({ scan: { sites: [HUGE, GAMMA] } });
    renderModal();
    await screen.findByText("huge.com");
    const hugeBox = screen.getByRole("checkbox", { name: "Publish huge.com" });
    expect(hugeBox).toBeDisabled();
    expect(hugeBox).not.toBeChecked();
    expect(screen.getByText("Too many changes to review here — publish from the site page")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 site selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select none" }));
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(hugeBox).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));
    await screen.findByText("Done: 1 published");
    expect(publishMock.mock.calls.map((c) => c[0])).toEqual(["gamma.com"]);
  });

  it("fails (without publishing) a site whose fresh re-check comes back truncated", async () => {
    const user = userEvent.setup();
    mockFetch({ scan: { sites: [GAMMA] }, recheck: () => ({ ...GAMMA, truncated: true }) });
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));
    await screen.findByText(/Done: 0 published, 1 failed/);
    expect(screen.getByText("Too many changes to verify — publish from the site page")).toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("skips a site that is no longer eligible with its own message", async () => {
    const user = userEvent.setup();
    mockFetch({ scan: { sites: [GAMMA] } });
    // Re-check answers "not eligible" (e.g. the site was moved back to Staging).
    const baseFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/sites/pending-changes?domain=")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ scannedAt: "x", scanned: 0, sites: [], errors: [], eligible: false }),
        } as Response;
      }
      return baseFetch(input, init);
    }) as unknown as typeof fetch;
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));
    await screen.findByText(/Done: 0 published/);
    expect(within(screen.getByTestId("run-row-gamma.com")).getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("No longer eligible (not Ready/Live, or no staging branch)")).toBeInTheDocument();
    expect(screen.queryByText("No longer has changes")).not.toBeInTheDocument();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("reopening while a closed run is still finishing shows the busy state and starts nothing", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    publishMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mockFetch({ scan: { sites: [GAMMA, BETA] } });
    const { isBulkPublishBusy } = await import("@/lib/bulk-publish-activity");
    const first = render(
      <BulkPublishModal open onClose={vi.fn()} eligibleCount={2} onPublished={vi.fn()} />,
    );
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 2 sites" }));
    await user.click(screen.getByRole("button", { name: "Publish 2 sites" }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith("gamma.com"));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Stop and close" }));
    first.unmount();
    expect(isBulkPublishBusy()).toBe(true);

    const scansBefore = fetchCalls.filter((u) => u === "/api/sites/pending-changes").length;
    render(<BulkPublishModal open onClose={vi.fn()} eligibleCount={2} onPublished={vi.fn()} />);
    expect(screen.getByText(/A bulk publish is still finishing…/)).toBeInTheDocument();
    expect(fetchCalls.filter((u) => u === "/api/sites/pending-changes").length).toBe(scansBefore);

    release();
    await waitFor(() => expect(isBulkPublishBusy()).toBe(false));
    expect(publishMock.mock.calls.map((c) => c[0])).toEqual(["gamma.com"]);
  });

  it("unmounting mid-run (e.g. navigating away) cancels after the current site", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    publishMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mockFetch({ scan: { sites: [GAMMA, BETA] } });
    const { isBulkPublishBusy } = await import("@/lib/bulk-publish-activity");
    const view = render(<BulkPublishModal open onClose={vi.fn()} eligibleCount={2} onPublished={vi.fn()} />);
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 2 sites" }));
    await user.click(screen.getByRole("button", { name: "Publish 2 sites" }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith("gamma.com"));
    view.unmount();
    release();
    await waitFor(() => expect(isBulkPublishBusy()).toBe(false));
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("a double click on the publish button starts only one run", async () => {
    const user = userEvent.setup();
    mockFetch({ scan: { sites: [GAMMA] } });
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.dblClick(screen.getByRole("button", { name: "Publish 1 site" }));
    await screen.findByText("Done: 1 published");
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(fetchCalls.filter((u) => u === "/api/scheduler/active-run")).toHaveLength(1);
  });

  it("shows the real failure reason returned by the bulkPublishSite action", async () => {
    const user = userEvent.setup();
    publishMock.mockRejectedValue(new Error("Reference update failed: main moved"));
    mockFetch({ scan: { sites: [GAMMA] } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderModal();
    await screen.findByText("gamma.com");
    await user.click(screen.getByRole("button", { name: "Continue with 1 site" }));
    await user.click(screen.getByRole("button", { name: "Publish 1 site" }));
    expect(await screen.findByText("Reference update failed: main moved")).toBeInTheDocument();
  });
});
