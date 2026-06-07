import { getKVEntry, credentialsFor } from "../lib/kv.js";
import { getKvNamespaces } from "../lib/cloudflare-accounts.js";

export interface SyncCheck {
  state: "ok" | "unknown";
  ok: boolean | null;
  syncedAt: string | null;
  gitSha: string | null;
  error: string | null;
}

export async function readSyncStatus(domain: string): Promise<SyncCheck> {
  try {
    const creds = credentialsFor(domain);
    const namespaceId = getKvNamespaces(domain).prod;
    const raw = await getKVEntry(namespaceId, `sync-status:${domain}`, creds);

    if (raw === null) {
      return { state: "unknown", ok: null, syncedAt: null, gitSha: null, error: null };
    }

    const entry = raw as Record<string, unknown>;
    return {
      state: "ok",
      ok: Boolean(entry["ok"]),
      syncedAt: typeof entry["syncedAt"] === "string" ? entry["syncedAt"] : null,
      gitSha: typeof entry["gitSha"] === "string" ? entry["gitSha"] : null,
      error: typeof entry["error"] === "string" ? entry["error"] : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "unknown", ok: null, syncedAt: null, gitSha: null, error: message };
  }
}
