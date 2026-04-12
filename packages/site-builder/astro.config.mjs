import { defineConfig } from 'astro/config';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'coolnews.dev';

/**
 * Default: assumes both repos are cloned side-by-side in the same parent dir.
 * packages/site-builder/astro.config.mjs → ../../../atomic-labs-network
 */
const DEFAULT_NETWORK_PATH = join(__dirname, '..', '..', '..', 'atomic-labs-network');
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH || DEFAULT_NETWORK_PATH;

/**
 * Staging detection: true when building a staging branch.
 * Cloudflare Pages sets CF_PAGES_BRANCH automatically. We also support
 * an explicit STAGING=true for local development.
 */
const cfBranch = process.env.CF_PAGES_BRANCH || '';
const IS_STAGING = process.env.STAGING === 'true' || cfBranch.startsWith('staging/');

const SITE_URL = process.env.SITE_URL || `https://${SITE_DOMAIN}`;

export default defineConfig({
  site: SITE_URL,
  outDir: './dist',

  vite: {
    plugins: [tailwindcss()],
    // Make env vars available to Astro components at build time
    define: {
      'import.meta.env.SITE_DOMAIN': JSON.stringify(SITE_DOMAIN),
      'import.meta.env.NETWORK_DATA_PATH': JSON.stringify(NETWORK_DATA_PATH),
      'import.meta.env.IS_STAGING': JSON.stringify(IS_STAGING),
      'import.meta.env.SUBSCRIBE_API_URL': JSON.stringify(
        process.env.SUBSCRIBE_API_URL || 'https://atomic-content-platform.apps.cloudgrid.io/api/subscribe'
      ),
    },
  },

  integrations: [sitemap()],
});
