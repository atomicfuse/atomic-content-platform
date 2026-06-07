import { describe, expect, it } from "vitest";

import { mapSnapshotToChecks } from "@/lib/domains-dashboard";

const healthySnapshot = {
  checkedAt: "2026-06-03T06:00:00.000Z",
  overallStatus: "healthy",
  health: {
    statusCode: 200,
    responseTimeMs: 142,
    checkedAt: "2026-06-03T08:00:00.000Z",
  },
  ssl: {
    status: "active",
    expiresAt: "2026-09-01T00:00:00.000Z",
    daysLeft: 90,
  },
  renewal: {
    expiresAt: "2027-03-15T00:00:00.000Z",
    autoRenew: true,
    daysLeft: 285,
  },
};

const notLiveSnapshot = {
  checkedAt: "2026-06-03T06:00:00.000Z",
  overallStatus: "not_live",
  health: {
    statusCode: 429,
    responseTimeMs: 88,
    checkedAt: "2026-06-03T08:00:00.000Z",
  },
  ssl: {
    status: "active",
    expiresAt: "2026-09-01T00:00:00.000Z",
    daysLeft: 90,
  },
  renewal: {
    expiresAt: "2027-03-15T00:00:00.000Z",
    autoRenew: true,
    daysLeft: 285,
  },
};

describe("mapSnapshotToChecks", () => {
  describe("healthy snapshot", () => {
    it("uptime: ok=true, overallStatus='healthy', state='ok'", () => {
      const result = mapSnapshotToChecks(healthySnapshot);
      expect(result.uptime.state).toBe("ok");
      expect(result.uptime.ok).toBe(true);
      expect(result.uptime.overallStatus).toBe("healthy");
      expect(result.uptime.statusCode).toBe(200);
      expect(result.uptime.responseTimeMs).toBe(142);
      expect(result.uptime.checkedAt).toBe("2026-06-03T08:00:00.000Z");
    });

    it("ssl: status='active', daysLeft=90, state='ok'", () => {
      const result = mapSnapshotToChecks(healthySnapshot);
      expect(result.ssl.state).toBe("ok");
      expect(result.ssl.status).toBe("active");
      expect(result.ssl.daysLeft).toBe(90);
      expect(result.ssl.expiresAt).toBe("2026-09-01T00:00:00.000Z");
    });

    it("domain: daysLeft=285, autoRenew=true, state='ok'", () => {
      const result = mapSnapshotToChecks(healthySnapshot);
      expect(result.domain.state).toBe("ok");
      expect(result.domain.daysLeft).toBe(285);
      expect(result.domain.expiresAt).toBe("2027-03-15T00:00:00.000Z");
      expect(result.domain.autoRenew).toBe(true);
    });
  });

  describe("not_live snapshot (statusCode 429)", () => {
    it("uptime: ok=false (429 not in 200-399), overallStatus='not_live', state='ok'", () => {
      const result = mapSnapshotToChecks(notLiveSnapshot);
      expect(result.uptime.state).toBe("ok");
      expect(result.uptime.ok).toBe(false);
      expect(result.uptime.overallStatus).toBe("not_live");
      expect(result.uptime.statusCode).toBe(429);
    });
  });

  describe("null snapshot", () => {
    it("all three blocks have state='unknown'", () => {
      const result = mapSnapshotToChecks(null);
      expect(result.uptime.state).toBe("unknown");
      expect(result.ssl.state).toBe("unknown");
      expect(result.domain.state).toBe("unknown");
    });

    it("uptime block has ok=false and null fields", () => {
      const result = mapSnapshotToChecks(null);
      expect(result.uptime.ok).toBe(false);
      expect(result.uptime.statusCode).toBeNull();
      expect(result.uptime.responseTimeMs).toBeNull();
      expect(result.uptime.overallStatus).toBeNull();
      expect(result.uptime.checkedAt).toBeNull();
    });

    it("ssl block has null fields", () => {
      const result = mapSnapshotToChecks(null);
      expect(result.ssl.status).toBeNull();
      expect(result.ssl.daysLeft).toBeNull();
      expect(result.ssl.expiresAt).toBeNull();
    });

    it("domain block has null fields", () => {
      const result = mapSnapshotToChecks(null);
      expect(result.domain.daysLeft).toBeNull();
      expect(result.domain.expiresAt).toBeNull();
      expect(result.domain.autoRenew).toBeNull();
    });
  });

  describe("undefined / non-object snapshot", () => {
    it("treats undefined as unknown", () => {
      const result = mapSnapshotToChecks(undefined);
      expect(result.uptime.state).toBe("unknown");
      expect(result.ssl.state).toBe("unknown");
      expect(result.domain.state).toBe("unknown");
    });

    it("treats a string as unknown", () => {
      const result = mapSnapshotToChecks("bad-value");
      expect(result.uptime.state).toBe("unknown");
    });
  });
});
