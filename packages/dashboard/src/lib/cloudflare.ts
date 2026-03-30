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

// --- Helpers ---

function getHeaders(): HeadersInit {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getAccountId(): string {
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

/** Create a new Cloudflare Pages project. */
export async function createPagesProject(
  name: string
): Promise<CloudflarePagesProject> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name, production_branch: "main" }),
    }
  );
  const data = (await response.json()) as CloudflareResponse<CloudflarePagesProject>;
  if (!data.success) {
    throw new Error(
      `Failed to create Pages project: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
  return data.result;
}

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

/** Add a custom domain to a Pages project. */
export async function addCustomDomainToProject(
  projectName: string,
  domain: string
): Promise<{ id: string; name: string; status: string }> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name: domain }),
    }
  );
  const data = (await response.json()) as CloudflareResponse<{
    id: string;
    name: string;
    status: string;
  }>;
  if (!data.success) {
    throw new Error(
      `Failed to add custom domain: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
  return data.result;
}

/** Remove a custom domain from a Pages project. */
export async function removeCustomDomainFromProject(
  projectName: string,
  domainId: string
): Promise<void> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains/${domainId}`,
    {
      method: "DELETE",
      headers: getHeaders(),
    }
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to remove custom domain: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
}

/** List deployments for a Pages project. */
export async function listDeployments(
  projectName: string,
  env?: "preview" | "production"
): Promise<
  Array<{
    id: string;
    url: string;
    environment: string;
    created_on: string;
    deployment_trigger?: { metadata?: { branch?: string } };
  }>
> {
  const accountId = getAccountId();
  const url = env
    ? `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments?env=${env}`
    : `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`;
  const response = await fetch(url, { headers: getHeaders() });
  const data = (await response.json()) as CloudflareResponse<
    Array<{
      id: string;
      url: string;
      environment: string;
      created_on: string;
      deployment_trigger?: { metadata?: { branch?: string } };
    }>
  >;
  if (!data.success) {
    throw new Error(
      `Failed to list deployments: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }
  return data.result;
}
