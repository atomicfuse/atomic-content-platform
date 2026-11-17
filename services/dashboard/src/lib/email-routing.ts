import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileContent, commitNetworkFiles } from "@/lib/github";
import { getCredentials, headersFromCreds } from "@/lib/cloudflare";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const DEFAULT_DESTINATION = "accounts+travelgeek@ngcdigital.io";
const DEFAULT_LOCAL_PART = "info";
const FALLBACK_EMAIL = "accounts+travelgeek@ngcdigital.io";
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
export async function addDestinationAddress(email: string, domain?: string): Promise<DestinationAddress> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const res = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/email/routing/addresses`,
    {
      method: "POST",
      headers,
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
export async function listDestinationAddresses(domain?: string): Promise<DestinationAddress[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const res = await fetch(
    `${CF_API_BASE}/accounts/${creds.accountId}/email/routing/addresses`,
    { headers },
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
export async function getEmailRoutingStatus(zoneId: string, domain?: string): Promise<boolean> {
  try {
    const headers = headersFromCreds(getCredentials(domain));
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/email/routing`, {
      headers,
    });
    const data = (await res.json()) as CloudflareResponse<{ enabled: boolean }>;
    return data.success && data.result.enabled;
  } catch {
    return false;
  }
}

function isCfAuthError(errors: CloudflareResponse<unknown>["errors"]): boolean {
  return errors.some((e) => e.code === 10000 || /authentication/i.test(e.message));
}

function formatCfErrors(errors: CloudflareResponse<unknown>["errors"]): string {
  return errors.map((e) => `[${e.code}] ${e.message}`).join(", ");
}

/**
 * Enable email routing on a zone: Cloudflare adds the MX + SPF + DKIM records,
 * without which mail to info@<domain> is never delivered. No-op if already enabled.
 * Uses POST /email/routing/dns (POST /email/routing/enable is deprecated).
 * Needs the token permission "Zone → Zone Settings → Edit"; throws without it,
 * because a forwarding rule on a zone with routing off silently drops all mail.
 */
export async function enableEmailRouting(zoneId: string, domain?: string): Promise<void> {
  const alreadyEnabled = await getEmailRoutingStatus(zoneId, domain);
  if (alreadyEnabled) return;

  const headers = headersFromCreds(getCredentials(domain));
  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/dns`,
    { method: "POST", headers, body: "{}" },
  );
  const data = (await res.json()) as CloudflareResponse<unknown>;
  if (data.success) return;

  // CF returns a distinct code when routing is already active — treat as success.
  const isAlreadyEnabled = data.errors.some(
    (e) => e.code === 1004 || /already\s+enabled/i.test(e.message),
  );
  if (isAlreadyEnabled) return;

  if (isCfAuthError(data.errors)) {
    throw new Error(
      `Failed to enable email routing for zone ${zoneId}: the Cloudflare API token needs "Zone → Zone Settings → Edit" (${formatCfErrors(data.errors)})`,
    );
  }
  throw new Error(`Failed to enable email routing for zone ${zoneId}: ${formatCfErrors(data.errors)}`);
}

/** List email routing rules for a zone. */
export async function listEmailRoutingRules(
  zoneId: string,
  domain?: string,
): Promise<EmailRoutingRule[]> {
  try {
    const headers = headersFromCreds(getCredentials(domain));
    const res = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/email/routing/rules`,
      { headers },
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
  domain?: string,
): Promise<EmailRoutingRule | null> {
  const rules = await listEmailRoutingRules(zoneId, domain);
  return (
    rules.find((r) =>
      r.matchers.some((m) => m.field === "to" && m.value === email),
    ) ?? null
  );
}

/** Create an email routing rule to forward info@<domain> to the destination.
 *  `domain` must be the real hostname (e.g. "zestguide.com"), not the site id. */
export async function createEmailRoutingRule(
  zoneId: string,
  domain: string,
  destination?: string,
): Promise<EmailRoutingRule> {
  const email = buildContactEmail(domain);
  const dest = destination ?? (await getDestinationForDomain(domain));

  // Check if rule already exists
  const existing = await findEmailRule(zoneId, email, domain);
  if (existing) return existing;

  const headers = headersFromCreds(getCredentials(domain));
  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/rules`,
    {
      method: "POST",
      headers,
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
    if (isCfAuthError(data.errors)) {
      throw new Error(
        `Failed to create email routing rule for ${email}: the Cloudflare API token needs "Zone → Email Routing Rules → Edit" (${formatCfErrors(data.errors)})`,
      );
    }
    throw new Error(`Failed to create email routing rule for ${email}: ${formatCfErrors(data.errors)}`);
  }
  return data.result;
}

/** Delete an email routing rule. No-op when token lacks Email Routing permissions. */
export async function deleteEmailRoutingRule(
  zoneId: string,
  ruleId: string,
  domain?: string,
): Promise<void> {
  const headers = headersFromCreds(getCredentials(domain));
  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/email/routing/rules/${ruleId}`,
    { method: "DELETE", headers },
  );
  const data = (await res.json()) as CloudflareResponse<null>;
  if (!data.success) {
    const isAuthError = data.errors.some(
      (e) => e.code === 10000 || /authentication/i.test(e.message),
    );
    if (isAuthError) {
      console.warn(
        `[deleteEmailRoutingRule] Auth error for zone ${zoneId} — token may lack Email Routing permissions. Skipping.`,
      );
      return;
    }
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
  // The address lives on the real hostname (info@zestguide.com), not the site id.
  const address = buildContactEmail(customDomain ?? domain);
  const destination = await getDestinationForDomain(domain);

  // No zone ID or no custom domain = not active
  if (!zoneId || !customDomain) {
    return { address, destination, active: false };
  }

  // Check if the rule exists
  const rule = await findEmailRule(zoneId, address, domain);
  return {
    address,
    destination,
    active: rule !== null,
    ruleId: rule?.id,
  };
}
