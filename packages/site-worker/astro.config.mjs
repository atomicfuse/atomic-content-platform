import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'server',

  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: {
      enabled: true,
    },
  }),

  integrations: [sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },
});
