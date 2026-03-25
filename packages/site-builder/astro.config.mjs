import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'coolnews.dev';
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH || '../../atomic-labs-network';

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
