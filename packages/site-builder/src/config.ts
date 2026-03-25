/**
 * Build-time config loader.
 *
 * Reads the resolved site configuration once and caches it for the
 * lifetime of the Astro build / dev server process.
 *
 * Paths are resolved at config time in astro.config.mjs and injected
 * via Vite `define` — no hardcoded paths here.
 */

import { resolveConfig } from '../scripts/resolve-config.js';
import type { ResolvedConfig } from '@atomic-platform/shared-types';

const SITE_DOMAIN: string = import.meta.env.SITE_DOMAIN;
const NETWORK_DATA_PATH: string = import.meta.env.NETWORK_DATA_PATH;

let _config: ResolvedConfig | null = null;

/**
 * Returns the fully-resolved site configuration.
 * The result is cached after the first call.
 */
export async function getConfig(): Promise<ResolvedConfig> {
  if (!_config) {
    _config = await resolveConfig(NETWORK_DATA_PATH, SITE_DOMAIN);
  }
  return _config;
}
