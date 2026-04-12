const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const DEFAULT_DESTINATION = "sites.newsletter@ngcdigital.io";
const DEFAULT_LOCAL_PART = "contact";
const FALLBACK_EMAIL = "hello@atomiclabs.io";

interface EmailRoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  matchers: Array<{ type: string; field: string; value: string }>;
  actions: Array<{ type: string; value: string[] }>;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
}

export interface SiteEmailConfig {
  address: string;
  destination: string;
  active: boolean;
  ruleId?: string;
}

function getHeaders(): HeadersInit {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Build the contact email address for a site domain. */
export function buildContactEmail(domain: string): string {
  return `${DEFAULT_LOCAL_PART}@${domain}`;
}

/** Get the fallback email for sites without a custom domain. */
export function getFallbackEmail(): string {
  return FALLBACK_EMAIL;
}

/** Get the destination email all site emails forward to. */
export function getDestinationEmail(): string {
  return DEFAULT_DESTINATION;
}

/** Check if email routing is enabled for a zone. */
export async function getEmailRoutingStatus(zoneId: string): Promise<boolean> {
  try {
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/email/routing`, {
      headers: getHeaders(),
    });
    const data = (await res.json()) as CloudflareResponse<{ enabled: boolean }>;
    return data.success && data.result.enabled;
  } catch {
    return false;
  }
}

/** List email routing rules for a zone. */
export async function listEmailRoutingRules(
  zoneId: string,
): Promise<EmailRoutingRule[]> {
  try {
    const res = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/email/routing/rules`,
      { headers: getHeaders() },
    );
    const data = (await res.json()) as CloudflareResponse<EmailRoutingRule[]>;
    if (!data.success) return [];
    return data.result;
  } catch {
    return [];
  }
}

/** Find an existing email routing rule for a specific address. */
export async function findEmailRule(
  zoneId: string,
  email: string,
): Promise<EmailRoutingRule | null> {
  const rules = await listEmailRoutingRules(zoneId);
  return (
    rules.find((r) =>
      r.matchers.some((m) => m.field === "to" && m.value === email),
    ) ?? null
  );
}

/** Create an email routing rule to forward contact@domain to the destination. */
export async function createEmailRoutingRule(
  zoneId: string,
  domain: string,
): Promise<EmailRoutingRule> {
  const email = buildContactEmail(domain);

  // Check if rule already exists
  const existing = await findEmailRule(zoneId, email);
  if (existing) return existing;

  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/rules`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: `Forward ${email} to ${DEFAULT_DESTINATION}`,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: email }],
        actions: [{ type: "forward", value: [DEFAULT_DESTINATION] }],
      }),
    },
  );

  const data = (await res.json()) as CloudflareResponse<EmailRoutingRule>;
  if (!data.success) {
    throw new Error(
      `Failed to create email routing rule: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return data.result;
}

/** Delete an email routing rule. */
export async function deleteEmailRoutingRule(
  zoneId: string,
  ruleId: string,
): Promise<void> {
  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/rules/${ruleId}`,
    { method: "DELETE", headers: getHeaders() },
  );
  const data = (await res.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to delete email routing rule: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** Get the email config for a site. Returns the config with active status based on zone. */
export async function getSiteEmailConfig(
  domain: string,
  zoneId: string | null,
  customDomain: string | null,
): Promise<SiteEmailConfig> {
  const address = buildContactEmail(domain);
  const destination = DEFAULT_DESTINATION;

  // No zone ID or no custom domain = not active
  if (!zoneId || !customDomain) {
    return { address, destination, active: false };
  }

  // Check if the rule exists
  const rule = await findEmailRule(zoneId, address);
  return {
    address,
    destination,
    active: rule !== null,
    ruleId: rule?.id,
  };
}
