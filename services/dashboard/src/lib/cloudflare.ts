import { WORKER_NAME_PROD, isDev1Domain, DEV1_ACCOUNT_ID } from "@/lib/constants";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// --- Types ---

interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  created_on: string;
  modified_on: string;
}

interface CloudflarePagesProject {
  id: string;
  name: string;
  subdomain: string;
  created_on: string;
  domains: string[];
  production_branch: string;
  latest_deployment?: {
    id: string;
    url: string;
    environment: string;
    created_on: string;
    modified_on: string;
  } | null;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
}

/** Enriched domain info combining Zones + Pages data. */
export interface CloudflareDomainInfo {
  /** The domain name (e.g. coolnews.dev). */
  domain: string;
  /** Cloudflare zone ID for this domain. */
  zoneId: string;
  /** Zone status (active, pending, etc.). */
  zoneStatus: string;
  /** The Pages project this domain is deployed on, if any. */
  pagesProject: string | null;
  /** The *.pages.dev subdomain, if deployed. */
  pagesSubdomain: string | null;
  /** URL of the latest production deployment. */
  latestDeploymentUrl: string | null;
  /** Whether there is an active production deployment. */
  hasDeployment: boolean;
}

/** A Workers Custom Domain registered on the Cloudflare account. */
export interface WorkerCustomDomain {
  id: string;
  hostname: string;
  zone_id: string;
  service: string;
  environment: string;
}

// --- Credential resolver ---

export interface CfCredentials {
  accountId: string;
  token: string;
}

/** Resolve CF credentials for a domain. Dev1 domains use DEV1_CLOUDFLARE_API_TOKEN;
 *  everything else uses the primary CLOUDFLARE_API_TOKEN.
 *  Accepts both siteIds ("financenewsbase") and custom domains ("financenewsbase.com"). */
export function getCredentials(domain?: string): CfCredentials {
  if (domain && isDev1Domain(domain)) {
    const token = process.env.DEV1_CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error("DEV1_CLOUDFLARE_API_TOKEN is not set");
    return { accountId: DEV1_ACCOUNT_ID, token };
  }
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  return { accountId, token };
}

export function headersFromCreds(creds: CfCredentials): HeadersInit {
  return {
    Authorization: `Bearer ${creds.token}`,
    "Content-Type": "application/json",
  };
}

// Backward-compat wrapper for callers that don't have domain context.
export function getAccountId(): string {
  return getCredentials().accountId;
}

// --- Zones API ---

/** Fetch all domains (zones) from the Cloudflare account. */
export async function listZones(domain?: string): Promise<CloudflareZone[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const zones: CloudflareZone[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${CF_API_BASE}/zones?account.id=${creds.accountId}&per_page=50&page=${page}`,
      { headers }
    );
    const data = (await response.json()) as CloudflareResponse<CloudflareZone[]>;
    if (!data.success) {
      throw new Error(
        `Cloudflare API error: ${data.errors.map((e) => e.message).join(", ")}`
      );
    }
    zones.push(...data.result);
    hasMore = data.result.length === 50;
    page++;
  }

  return zones;
}

// --- Pages API ---

/** Fetch all Cloudflare Pages projects. */
export async function listPagesProjects(domain?: string): Promise<CloudflarePagesProject[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/pages/projects`,
    { headers }
  );
  const data = (await response.json()) as CloudflareResponse<CloudflarePagesProject[]>;
  if (!data.success) {
    throw new Error(
      `Cloudflare Pages API error: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
  return data.result;
}

/** Get custom domains for a specific Pages project. */
export async function getPagesProjectDomains(
  projectName: string,
  domain?: string,
): Promise<string[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  try {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${creds.accountId}/pages/projects/${projectName}/domains`,
      { headers }
    );
    const data = (await response.json()) as CloudflareResponse<
      Array<{ id: string; name: string; status: string }>
    >;
    if (!data.success) return [];
    return data.result.map((d) => d.name);
  } catch {
    return [];
  }
}

// --- Combined: Zones + Pages ---

/**
 * Build enriched domain info by cross-referencing Zones with Pages projects.
 *
 * For each zone (domain), checks if any Pages project has that domain
 * as a custom domain. This tells us if the domain is deployed.
 */
export async function listDomainsWithPagesInfo(domain?: string): Promise<CloudflareDomainInfo[]> {
  const [zones, projects] = await Promise.all([
    listZones(domain),
    listPagesProjects(domain),
  ]);

  // Build a map: custom domain → Pages project
  // Pages projects list their custom domains in the `domains` array
  // and also in the project-level domains endpoint
  const domainToProject = new Map<string, CloudflarePagesProject>();

  // First pass: use the `domains` field from project list
  for (const project of projects) {
    if (project.domains) {
      for (const d of project.domains) {
        // Skip *.pages.dev subdomains — we want custom domains only
        if (!d.endsWith(".pages.dev")) {
          domainToProject.set(d, project);
        }
      }
    }
  }

  // Second pass: for projects that didn't have domains in the list response,
  // fetch their custom domains explicitly
  for (const project of projects) {
    const hasCustomDomain = project.domains?.some(
      (d) => !d.endsWith(".pages.dev")
    );
    if (!hasCustomDomain) {
      const customDomains = await getPagesProjectDomains(project.name, domain);
      for (const d of customDomains) {
        domainToProject.set(d, project);
      }
    }
  }

  // Map each zone to enriched info
  return zones.map((zone) => {
    const project = domainToProject.get(zone.name);
    return {
      domain: zone.name,
      zoneId: zone.id,
      zoneStatus: zone.status,
      pagesProject: project?.name ?? null,
      pagesSubdomain: project?.subdomain ?? null,
      latestDeploymentUrl: project?.latest_deployment?.url ?? null,
      hasDeployment: project?.latest_deployment != null,
    };
  });
}

// --- Deployments ---

/** Trigger a Cloudflare Pages deployment. */
export async function triggerPagesBuild(
  projectName: string,
  domain?: string,
): Promise<{ id: string; url: string }> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/pages/projects/${projectName}/deployments`,
    {
      method: "POST",
      headers,
    }
  );
  const data = (await response.json()) as CloudflareResponse<{
    id: string;
    url: string;
  }>;
  if (!data.success) {
    throw new Error(
      `Failed to trigger build: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
  return data.result;
}

/** Get the latest deployment for a Pages project. */
export async function getLatestDeployment(
  projectName: string,
  domain?: string,
): Promise<{
  id: string;
  url: string;
  environment: string;
  created_on: string;
  latest_stage?: { name: string; status: string };
} | null> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  try {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${creds.accountId}/pages/projects/${projectName}/deployments?per_page=1`,
      { headers }
    );
    const data = (await response.json()) as CloudflareResponse<
      Array<{
        id: string;
        url: string;
        environment: string;
        created_on: string;
        latest_stage?: { name: string; status: string };
      }>
    >;
    if (data.success && data.result.length > 0) {
      return data.result[0]!;
    }
    return null;
  } catch {
    return null;
  }
}

/** Check if Cloudflare APO is enabled for a zone. */
export async function getAPOStatus(zoneId: string, domain?: string): Promise<boolean> {
  const headers = headersFromCreds(getCredentials(domain));
  try {
    const response = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/settings/automatic_platform_optimization`,
      { headers }
    );
    const data = (await response.json()) as CloudflareResponse<{
      value: { enabled: boolean };
    }>;
    return data.success && data.result.value.enabled;
  } catch {
    return false;
  }
}

// --- Pages Project Management ---

/** Delete a Cloudflare Pages project. */
export async function deletePagesProject(name: string, domain?: string): Promise<void> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/pages/projects/${name}`,
    {
      method: "DELETE",
      headers,
    }
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to delete Pages project: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
}


// --- Workers Custom Domains API ---

/** Register a custom domain on the production worker.
 *  Cloudflare auto-manages the DNS A/AAAA record for the hostname. */
export async function registerWorkerCustomDomain(
  hostname: string,
  zoneId: string,
  domain?: string,
): Promise<{ id: string }> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/workers/domains`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        zone_id: zoneId,
        hostname,
        service: WORKER_NAME_PROD,
        environment: "production",
      }),
    },
  );
  const data = (await response.json()) as CloudflareResponse<{ id: string }>;
  if (!data.success) {
    throw new Error(
      `Failed to register custom domain ${hostname}: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return data.result;
}

/** Deregister a custom domain from the production worker.
 *  No-op if the domain is not currently registered. */
export async function deregisterWorkerCustomDomain(
  hostname: string,
  domain?: string,
): Promise<void> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  // Find the domain ID by hostname (server-side filter avoids pagination)
  const listResp = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}&service=${WORKER_NAME_PROD}`,
    { headers },
  );
  const listData = (await listResp.json()) as CloudflareResponse<WorkerCustomDomain[]>;
  if (!listData.success) {
    throw new Error(
      `Failed to list custom domains: ${listData.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const match = listData.result.find((d) => d.hostname === hostname);
  if (!match) return; // Already removed — no-op

  const delResp = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/workers/domains/${match.id}`,
    { method: "DELETE", headers },
  );
  const delData = (await delResp.json()) as CloudflareResponse<null>;
  if (!delData.success) {
    throw new Error(
      `Failed to deregister custom domain ${hostname}: ${delData.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** List all Workers Custom Domains registered for the production worker.
 *  Handles pagination (same pattern as listZones). */
export async function listWorkerCustomDomains(domain?: string): Promise<WorkerCustomDomain[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const domains: WorkerCustomDomain[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${creds.accountId}/workers/domains?service=${WORKER_NAME_PROD}&per_page=50&page=${page}`,
      { headers },
    );
    const data = (await response.json()) as CloudflareResponse<WorkerCustomDomain[]>;
    if (!data.success) {
      throw new Error(
        `Failed to list worker custom domains: ${data.errors.map((e) => e.message).join(", ")}`,
      );
    }
    domains.push(...data.result);
    hasMore = data.result.length === 50;
    page++;
  }

  return domains;
}

// --- DNS Records API ---

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

/** Upsert a DNS TXT record on a zone. If a TXT record with the same name
 *  and content prefix exists, update it; otherwise create a new one.
 *  Used for facebook-domain-verification and similar verification records. */
export async function upsertDnsTxtRecord(
  zoneId: string,
  name: string,
  content: string,
  domain?: string,
): Promise<void> {
  const headers = headersFromCreds(getCredentials(domain));

  // List existing TXT records matching this name
  const listResp = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
    { headers },
  );
  const listData = (await listResp.json()) as CloudflareResponse<CloudflareDnsRecord[]>;
  if (!listData.success) {
    throw new Error(
      `Failed to list DNS records: ${listData.errors.map((e) => e.message).join(", ")}`,
    );
  }

  // Find an existing record with the same content prefix (e.g. "facebook-domain-verification=")
  const prefix = content.split("=")[0] + "=";
  const existing = listData.result.find((r) => r.content.startsWith(prefix));

  if (existing) {
    if (existing.content === content) return; // Already correct
    // Update
    const updateResp = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ content }),
      },
    );
    const updateData = (await updateResp.json()) as CloudflareResponse<CloudflareDnsRecord>;
    if (!updateData.success) {
      throw new Error(
        `Failed to update DNS TXT record: ${updateData.errors.map((e) => e.message).join(", ")}`,
      );
    }
  } else {
    // Create
    const createResp = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "TXT", name: "@", content }),
      },
    );
    const createData = (await createResp.json()) as CloudflareResponse<CloudflareDnsRecord>;
    if (!createData.success) {
      throw new Error(
        `Failed to create DNS TXT record: ${createData.errors.map((e) => e.message).join(", ")}`,
      );
    }
  }
}

/** Delete a DNS TXT record from a zone by content prefix match.
 *  No-op if no matching record exists. */
export async function deleteDnsTxtRecord(
  zoneId: string,
  name: string,
  contentPrefix: string,
  domain?: string,
): Promise<void> {
  const headers = headersFromCreds(getCredentials(domain));

  const listResp = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
    { headers },
  );
  const listData = (await listResp.json()) as CloudflareResponse<CloudflareDnsRecord[]>;
  if (!listData.success) return; // Best-effort

  const existing = listData.result.find((r) => r.content.startsWith(contentPrefix));
  if (!existing) return;

  await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`,
    { method: "DELETE", headers },
  );
}

/** Delete A, AAAA and CNAME records for a hostname so the Workers Custom
 *  Domains API can create its own managed records. Returns the number of
 *  records deleted. Throws on list failure; individual deletes are
 *  best-effort. */
export async function deleteConflictingDnsRecords(
  zoneId: string,
  hostname: string,
  domain?: string,
): Promise<number> {
  const headers = headersFromCreds(getCredentials(domain));

  const listResp = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`,
    { headers },
  );
  const listData = (await listResp.json()) as CloudflareResponse<CloudflareDnsRecord[]>;
  if (!listData.success) {
    throw new Error(
      `Failed to list DNS records for ${hostname}: ${listData.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const conflicting = listData.result.filter((r) =>
    r.type === "A" || r.type === "AAAA" || r.type === "CNAME",
  );
  if (conflicting.length === 0) return 0;

  let deleted = 0;
  for (const record of conflicting) {
    const delResp = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records/${record.id}`,
      { method: "DELETE", headers },
    );
    const delData = (await delResp.json()) as CloudflareResponse<null>;
    if (delData.success) deleted++;
    else {
      console.warn(
        `[deleteConflictingDnsRecords] Failed to delete ${record.type} record ${record.id} for ${hostname}`,
      );
    }
  }
  return deleted;
}

// --- KV Direct Write API ---

/** Write a single KV entry by key. Value is a raw string (caller must JSON.stringify).
 *  Content-Type is overridden to text/plain because the KV values API expects a raw
 *  body — the default application/json from headersFromCreds() would be semantically incorrect. */
export async function putKVEntry(
  namespaceId: string,
  key: string,
  value: string,
  domain?: string,
): Promise<void> {
  const creds = getCredentials(domain);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        ...headersFromCreds(creds),
        "Content-Type": "text/plain",
      },
      body: value,
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to write KV key "${key}": ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** Delete a single KV entry by key. No-op if key does not exist. */
export async function deleteKVEntry(
  namespaceId: string,
  key: string,
  domain?: string,
): Promise<void> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
      headers,
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    // KV delete on a missing key returns success=true, so a failure here is a real error
    throw new Error(
      `Failed to delete KV key "${key}": ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** Read a single KV entry by key. Returns the raw string value, or null if the key
 *  doesn't exist. The KV values API returns the raw body (not JSON-wrapped). */
export async function getKVEntry(
  namespaceId: string,
  key: string,
  domain?: string,
): Promise<string | null> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to read KV key "${key}": ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/** List KV keys matching a prefix. Handles pagination automatically.
 *  Returns just the key names (not values). */
export async function listKVKeys(
  namespaceId: string,
  prefix: string,
  domain?: string,
): Promise<string[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const keys: string[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) params.set('cursor', cursor);

    const response = await fetch(
      `${CF_API_BASE}/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/keys?${params}`,
      { headers },
    );
    const data = (await response.json()) as CloudflareResponse<Array<{ name: string }>> & {
      result_info?: { cursor?: string };
    };
    if (!data.success) {
      throw new Error(`Failed to list KV keys with prefix "${prefix}": ${data.errors.map((e) => e.message).join(", ")}`);
    }
    keys.push(...data.result.map((k) => k.name));

    cursor = data.result_info?.cursor;
    if (!cursor || data.result.length === 0) break;
  }

  return keys;
}

/** Bulk write KV entries. Accepts up to 10,000 key-value pairs per call.
 *  Each entry is { key, value } where value is a raw string. */
export async function bulkPutKV(
  namespaceId: string,
  entries: Array<{ key: string; value: string }>,
  domain?: string,
): Promise<void> {
  if (entries.length === 0) return;
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify(entries),
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to bulk write ${entries.length} KV entries: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** Bulk delete KV entries by key. Accepts up to 10,000 keys per call.
 *  No-op if keys array is empty. Missing keys are silently ignored. */
export async function bulkDeleteKV(
  namespaceId: string,
  keys: string[],
  domain?: string,
): Promise<void> {
  if (keys.length === 0) return;
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const response = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "DELETE",
      headers,
      body: JSON.stringify(keys),
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to bulk delete ${keys.length} KV keys: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** List all KV keys matching a prefix, then bulk-delete them.
 *  Returns the number of keys deleted. Handles pagination internally. */
export async function deleteKVByPrefix(
  namespaceId: string,
  prefix: string,
  domain?: string,
): Promise<number> {
  const keys = await listKVKeys(namespaceId, prefix, domain);
  if (keys.length === 0) return 0;
  // CF bulk delete supports up to 10,000 keys per call
  for (let i = 0; i < keys.length; i += 10_000) {
    await bulkDeleteKV(namespaceId, keys.slice(i, i + 10_000), domain);
  }
  return keys.length;
}

// --- R2 Cleanup (S3-compatible API) ---

/** Account-keyed S3 client cache for R2 operations.
 *  Requires R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY env vars (or DEV1_ variants). */
const _s3Clients = new Map<string, S3Client>();

export function getR2Client(domain?: string): S3Client | null {
  const creds = getCredentials(domain);
  const existing = _s3Clients.get(creds.accountId);
  if (existing) return existing;

  const accessKeyId = domain && isDev1Domain(domain)
    ? process.env.DEV1_R2_ACCESS_KEY_ID
    : process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = domain && isDev1Domain(domain)
    ? process.env.DEV1_R2_SECRET_ACCESS_KEY
    : process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.warn("R2 cleanup skipped: R2 credentials not configured");
    return null;
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  _s3Clients.set(creds.accountId, client);
  return client;
}

/** Delete all R2 objects matching a prefix from a bucket.
 *  Handles pagination (ListObjectsV2) and batch deletion (DeleteObjects, 1000 per batch).
 *  Returns the number of objects deleted. Returns 0 if R2 credentials are not configured. */
export async function deleteR2ObjectsByPrefix(
  bucket: string,
  prefix: string,
  domain?: string,
): Promise<number> {
  const client = getR2Client(domain);
  if (!client) return 0;

  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = list.Contents;
    if (!objects || objects.length === 0) break;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key })),
          Quiet: true,
        },
      }),
    );

    deleted += objects.length;
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}

/** Move (rename) all R2 objects from one prefix to another within the same bucket.
 *  Copies each object to the new prefix then deletes the originals.
 *  Server-side copy — no data transfer, fast even for hundreds of objects.
 *  Returns the number of objects moved. Returns 0 if R2 credentials are not configured. */
export async function moveR2ObjectsByPrefix(
  bucket: string,
  oldPrefix: string,
  newPrefix: string,
  domain?: string,
): Promise<number> {
  const client = getR2Client(domain);
  if (!client) return 0;

  let moved = 0;
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: oldPrefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = list.Contents;
    if (!objects || objects.length === 0) break;

    // Copy each object to the new prefix (server-side, no data download)
    await Promise.all(
      objects.map(async (obj) => {
        if (!obj.Key) return;
        const newKey = newPrefix + obj.Key.slice(oldPrefix.length);
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${obj.Key}`,
            Key: newKey,
          }),
        );
      }),
    );

    // Delete the originals in one batch
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.filter((o) => o.Key).map((o) => ({ Key: o.Key })),
          Quiet: true,
        },
      }),
    );

    moved += objects.length;
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return moved;
}

/** Delete specific R2 objects by exact keys.
 *  Best-effort: returns the number of keys sent for deletion.
 *  Returns 0 if R2 credentials are not configured. */
export async function deleteR2Objects(
  bucket: string,
  keys: string[],
  domain?: string,
): Promise<number> {
  if (keys.length === 0) return 0;
  const client = getR2Client(domain);
  if (!client) return 0;

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys.map((k) => ({ Key: k })),
        Quiet: true,
      },
    }),
  );

  return keys.length;
}
