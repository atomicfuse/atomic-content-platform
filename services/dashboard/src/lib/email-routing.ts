import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileContent, commitNetworkFiles } from "@/lib/github";
import { getAccountId } from "@/lib/cloudflare";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const DEFAULT_DESTINATION = "michal@atomiclabs.io";
const DEFAULT_LOCAL_PART = "contact";
const FALLBACK_EMAIL = "hello@atomiclabs.io";
const EMAIL_CONFIG_PATH = "email-config.yaml";

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

export interface EmailConfig {
  default_destination: string;
  overrides: Record<string, string>;
}

export interface DestinationAddress {
  id: string;
  email: string;
  verified?: string | null;
  created?: string;
  modified?: string;
}

function getHeaders(): HeadersInit {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Email config (stored in network repo)
// ---------------------------------------------------------------------------

/** Read the email forwarding config from the network repo. */
export async function readEmailConfig(): Promise<EmailConfig> {
  try {
    const content = await readFileContent(EMAIL_CONFIG_PATH);
    if (!content) {
      return { default_destination: DEFAULT_DESTINATION, overrides: {} };
    }
    const parsed = parseYaml(content) as Partial<EmailConfig>;
    return {
      default_destination: parsed.default_destination ?? DEFAULT_DESTINATION,
      overrides: parsed.overrides ?? {},
    };
  } catch {
    return { default_destination: DEFAULT_DESTINATION, overrides: {} };
  }
}

/** Write the email forwarding config to the network repo. */
export async function writeEmailConfig(config: EmailConfig): Promise<void> {
  const content = stringifyYaml(config, { lineWidth: 0 });
  await commitNetworkFiles(
    [{ path: EMAIL_CONFIG_PATH, content }],
    "email: update forwarding config",
  );
}

/** Get the destination email for a specific domain, checking overrides first. */
export async function getDestinationForDomain(domain: string): Promise<string> {
  const config = await readEmailConfig();
  return config.overrides[domain] ?? config.default_destination;
}

// ---------------------------------------------------------------------------
// Cloudflare destination addresses
// ---------------------------------------------------------------------------

/** Add a destination address to the Cloudflare account (triggers verification email). */
export async function addDestinationAddress(email: string): Promise<DestinationAddress> {
  const accountId = getAccountId();
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/email/routing/addresses`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ email }),
    },
  );
  const data = (await res.json()) as CloudflareResponse<DestinationAddress>;
  if (!data.success) {
    throw new Error(
      `Failed to add destination address: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return data.result;
}

/** List all destination addresses on the Cloudflare account. */
export async function listDestinationAddresses(): Promise<DestinationAddress[]> {
  const accountId = getAccountId();
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/email/routing/addresses`,
    { headers: getHeaders() },
  );
  const data = (await res.json()) as CloudflareResponse<DestinationAddress[]>;
  if (!data.success) return [];
  return data.result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the contact email address for a site domain. */
export function buildContactEmail(domain: string): string {
  return `${DEFAULT_LOCAL_PART}@${domain}`;
}

/** Get the fallback email for sites without a custom domain. */
export function getFallbackEmail(): string {
  return FALLBACK_EMAIL;
}

/** Get the default destination email (sync, returns hardcoded fallback). */
export function getDestinationEmail(): string {
  return DEFAULT_DESTINATION;
}

// ---------------------------------------------------------------------------
// Cloudflare Email Routing zone APIs
// ---------------------------------------------------------------------------

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

/** Enable email routing on a zone. No-op if already enabled. */
export async function enableEmailRouting(zoneId: string): Promise<void> {
  const alreadyEnabled = await getEmailRoutingStatus(zoneId);
  if (alreadyEnabled) return;

  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/enable`,
    { method: "POST", headers: getHeaders() },
  );
  const data = (await res.json()) as CloudflareResponse<unknown>;
  if (!data.success) {
    // CF returns a distinct code when routing is already active — treat as success.
    // Known codes: 1004 "already enabled" (varies by zone state).
    const isAlreadyEnabled = data.errors.some(
      (e) =>
        e.code === 1004 ||
        /already\s+enabled/i.test(e.message),
    );
    if (isAlreadyEnabled) return;

    // Auth error — routing may already be enabled but token lacks the enable permission.
    // Log warning and allow rule creation to proceed.
    const isAuthError = data.errors.some((e) => e.code === 10000);
    if (isAuthError) {
      console.warn(
        `[enableEmailRouting] Auth error for zone ${zoneId} — email routing may already be enabled. Continuing.`,
      );
      return;
    }

    const detail = data.errors
      .map((e) => `[${e.code}] ${e.message}`)
      .join(", ");
    throw new Error(`Failed to enable email routing: ${detail}`);
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
  destination?: string,
): Promise<EmailRoutingRule> {
  const email = buildContactEmail(domain);
  const dest = destination ?? (await getDestinationForDomain(domain));

  // Check if rule already exists
  const existing = await findEmailRule(zoneId, email);
  if (existing) return existing;

  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/rules`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: `Forward ${email} to ${dest}`,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: email }],
        actions: [{ type: "forward", value: [dest] }],
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
  const destination = await getDestinationForDomain(domain);

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
