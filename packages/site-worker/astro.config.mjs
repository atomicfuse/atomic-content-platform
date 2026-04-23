import { defineConfig } from 'astro/config';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Phase 2: single-site build driven by SITE_DOMAIN env var (same pattern as
 * the legacy site-builder). Multi-tenant hostname resolution via KV +
 * middleware arrives in Phase 3 and replaces this env-var mechanism.
 */
const SITE_DOMAIN = process.env.SITE_DOMAIN || 'coolnews-atl';
const SITE_NAME = process.env.SITE_NAME || 'Cool News ATL';
const SITE_TAGLINE = process.env.SITE_TAGLINE || '';

const DEFAULT_NETWORK_PATH = join(__dirname, '..', '..', '..', 'atomic-labs-network');
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH || DEFAULT_NETWORK_PATH;

export default defineConfig({
  output: 'server',

  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),

  integrations: [sitemap()],

  vite: {
    plugins: [tailwindcss()],
    define: {
      'import.meta.env.SITE_DOMAIN': JSON.stringify(SITE_DOMAIN),
      'import.meta.env.SITE_NAME': JSON.stringify(SITE_NAME),
      'import.meta.env.SITE_TAGLINE': JSON.stringify(SITE_TAGLINE || null),
      'import.meta.env.NETWORK_DATA_PATH': JSON.stringify(NETWORK_DATA_PATH),
    },
  },
});
