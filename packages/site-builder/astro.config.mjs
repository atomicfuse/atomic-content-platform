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

export default defineConfig({
  site: `https://${SITE_DOMAIN}`,
  outDir: './dist',

  vite: {
    plugins: [tailwindcss()],
    // Make env vars available to Astro components at build time
    define: {
      'import.meta.env.SITE_DOMAIN': JSON.stringify(SITE_DOMAIN),
      'import.meta.env.NETWORK_DATA_PATH': JSON.stringify(NETWORK_DATA_PATH),
    },
  },

  integrations: [sitemap()],
});
