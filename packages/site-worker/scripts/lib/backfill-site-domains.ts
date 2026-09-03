/**
 * Planning logic for the one-off `domain:` backfill.
 *
 * Sites scaffolded from CSV import stored the TLD-stripped siteId in
 * `sites/<siteId>/site.yaml`'s `domain:` field. The authoritative hostname
 * lives in `dashboard-index.yaml` as `custom_domain`. This module decides
 * which files need rewriting and to what; the executable wrapper
 * (`scripts/backfill-site-domains.ts`) does the I/O.
 *
 * Kept separate from the script so the decision rules are unit-testable
 * without touching a git checkout.
 */

import { isRealDomain } from './resolve';

export interface BackfillSite {
  /** Site folder name under `sites/`. */
  siteId: string;
  /** Current `domain:` in that site's site.yaml, if any. */
  siteDomain?: string;
  /** `custom_domain` for the site from dashboard-index.yaml, if any. */
  indexDomain?: string;
}

export interface BackfillEdit {
  siteId: string;
  /** The value currently in site.yaml — empty string when the field is absent. */
  from: string;
  /** The hostname to write. */
  to: string;
}

function normalise(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Returns the edits needed to give every site a real hostname in site.yaml.
 *
 * A site is skipped when its site.yaml already holds a real domain, or when
 * dashboard-index.yaml offers nothing better — this never guesses a TLD, since
 * a siteId does not reliably imply its hostname (`muvizzcom` → `muvizz.com`).
 */
export function planDomainBackfill(sites: BackfillSite[]): BackfillEdit[] {
  const edits: BackfillEdit[] = [];
  for (const site of sites) {
    const current = normalise(site.siteDomain);
    if (isRealDomain(current)) continue;

    const target = normalise(site.indexDomain);
    if (!isRealDomain(target) || target === current) continue;

    edits.push({ siteId: site.siteId, from: current, to: target });
  }
  return edits;
}
