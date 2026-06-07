/**
 * Dual-account Cloudflare constants for content-pipeline.
 *
 * Mirrors the values in services/dashboard/src/lib/constants.ts (Assets @ AtomicLabs
 * and Dev1 @ AtomicLabs accounts). Kept local so content-pipeline remains a
 * standalone CloudGrid build with no @atomic-platform/shared-types dependency.
 *
 * Dev1 sites are temporary — remove after zone transfer to Assets.
 */

const DEV1_SITE_IDS = new Set<string>(["financenewsbase", "muvizzcom"]);

export function isDev1Domain(domain: string): boolean {
  return DEV1_SITE_IDS.has(domain);
}

export function getAccountId(domain: string): string {
  return isDev1Domain(domain)
    ? "953511f6356ff606d84ac89bba3eff50"
    : "4a8cfd85d617b38ce1813a552132bc86";
}

export function getKvNamespaces(domain: string): { staging: string; prod: string } {
  return isDev1Domain(domain)
    ? { staging: "4673c82cdd7f41d49e93d938fb1c6848", prod: "a69cb2c59507482ca5e6d114babdd098" }
    : { staging: "f6c35e1fa8c841b8b193509a3a237f7f", prod: "b258e47065274b8b8af1a0b6d6529c1d" };
}
