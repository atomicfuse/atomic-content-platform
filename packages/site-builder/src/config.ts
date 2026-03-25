/**
 * Build-time config loader.
 *
 * Reads the resolved site configuration once and caches it for the
 * lifetime of the Astro build / dev server process.
 */

import { resolveConfig } from '../scripts/resolve-config.js';
import type { ResolvedConfig } from '@atomic-platform/shared-types';

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'coolnews.dev';
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH || '../../atomic-labs-network';

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
