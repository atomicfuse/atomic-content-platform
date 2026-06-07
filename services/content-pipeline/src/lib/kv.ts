/**
 * Cloudflare KV REST API reader for content-pipeline.
 *
 * Mirrors the getKVEntry pattern from services/dashboard/src/lib/cloudflare.ts,
 * adapted for content-pipeline's dual-account credential resolution.
 * Uses the same REST endpoint but returns unknown (JSON-parsed when possible)
 * rather than a raw string, since pipeline consumers expect structured data.
 */

import { getAccountId, isDev1Domain } from "./cloudflare-accounts.js";

export interface KvCreds {
  accountId: string;
  token: string;
}

export function credentialsFor(domain: string): KvCreds {
  const token = isDev1Domain(domain)
    ? (process.env["DEV1_CLOUDFLARE_API_TOKEN"] ?? process.env["CLOUDFLARE_API_TOKEN"] ?? "")
    : (process.env["CLOUDFLARE_API_TOKEN"] ?? "");
  return { accountId: getAccountId(domain), token };
}

export async function getKVEntry(
  namespaceId: string,
  key: string,
  creds: KvCreds,
): Promise<unknown | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${creds.token}` }, signal: AbortSignal.timeout(5_000) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV read ${key}: ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
