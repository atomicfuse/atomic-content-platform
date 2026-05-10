import { WORKER_NAME_PROD } from "@/lib/constants";

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

// --- Helpers ---

function getHeaders(): HeadersInit {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function getAccountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  return id;
}

// --- Zones API ---

/** Fetch all domains (zones) from the Cloudflare account. */
export async function listZones(): Promise<CloudflareZone[]> {
  const accountId = getAccountId();
  const zones: CloudflareZone[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${CF_API_BASE}/zones?account.id=${accountId}&per_page=50&page=${page}`,
      { headers: getHeaders() }
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
export async function listPagesProjects(): Promise<CloudflarePagesProject[]> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects`,
    { headers: getHeaders() }
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
  projectName: string
): Promise<string[]> {
  const accountId = getAccountId();
  try {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains`,
      { headers: getHeaders() }
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
export async function listDomainsWithPagesInfo(): Promise<CloudflareDomainInfo[]> {
  const [zones, projects] = await Promise.all([
    listZones(),
    listPagesProjects(),
  ]);

  // Build a map: custom domain → Pages project
  // Pages projects list their custom domains in the `domains` array
  // and also in the project-level domains endpoint
  const domainToProject = new Map<string, CloudflarePagesProject>();

  // First pass: use the `domains` field from project list
  for (const project of projects) {
    if (project.domains) {
      for (const domain of project.domains) {
        // Skip *.pages.dev subdomains — we want custom domains only
        if (!domain.endsWith(".pages.dev")) {
          domainToProject.set(domain, project);
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
      const customDomains = await getPagesProjectDomains(project.name);
      for (const domain of customDomains) {
        domainToProject.set(domain, project);
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
  projectName: string
): Promise<{ id: string; url: string }> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: "POST",
      headers: getHeaders(),
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
  projectName: string
): Promise<{
  id: string;
  url: string;
  environment: string;
  created_on: string;
  latest_stage?: { name: string; status: string };
} | null> {
  const accountId = getAccountId();
  try {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=1`,
      { headers: getHeaders() }
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
export async function getAPOStatus(zoneId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/settings/automatic_platform_optimization`,
      { headers: getHeaders() }
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
export async function deletePagesProject(name: string): Promise<void> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${name}`,
    {
      method: "DELETE",
      headers: getHeaders(),
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
): Promise<{ id: string }> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/domains`,
    {
      method: "PUT",
      headers: getHeaders(),
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
): Promise<void> {
  const accountId = getAccountId();
  // Find the domain ID by hostname (server-side filter avoids pagination)
  const listResp = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}&service=${WORKER_NAME_PROD}`,
    { headers: getHeaders() },
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
    `${CF_API_BASE}/accounts/${accountId}/workers/domains/${match.id}`,
    { method: "DELETE", headers: getHeaders() },
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
export async function listWorkerCustomDomains(): Promise<WorkerCustomDomain[]> {
  const accountId = getAccountId();
  const domains: WorkerCustomDomain[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/domains?service=${WORKER_NAME_PROD}&per_page=50&page=${page}`,
      { headers: getHeaders() },
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

// --- KV Direct Write API ---

/** Write a single KV entry by key. Value is a raw string (caller must JSON.stringify).
 *  Content-Type is overridden to text/plain because the KV values API expects a raw
 *  body — the default application/json from getHeaders() would be semantically incorrect. */
export async function putKVEntry(
  namespaceId: string,
  key: string,
  value: string,
): Promise<void> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        ...getHeaders(),
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
): Promise<void> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
      headers: getHeaders(),
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
): Promise<string | null> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers: getHeaders() },
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
): Promise<string[]> {
  const accountId = getAccountId();
  const keys: string[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) params.set('cursor', cursor);

    const response = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${params}`,
      { headers: getHeaders() },
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
): Promise<void> {
  if (entries.length === 0) return;
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "PUT",
      headers: getHeaders(),
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
): Promise<void> {
  if (keys.length === 0) return;
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "DELETE",
      headers: getHeaders(),
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
): Promise<number> {
  const keys = await listKVKeys(namespaceId, prefix);
  if (keys.length === 0) return 0;
  // CF bulk delete supports up to 10,000 keys per call
  for (let i = 0; i < keys.length; i += 10_000) {
    await bulkDeleteKV(namespaceId, keys.slice(i, i + 10_000));
  }
  return keys.length;
}
