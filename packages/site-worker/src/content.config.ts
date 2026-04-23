import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'coolnews-atl';

const DEFAULT_NETWORK_PATH = join(__dirname, '..', '..', '..', '..', 'atomic-labs-network');
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH || DEFAULT_NETWORK_PATH;

const articles = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: `${NETWORK_DATA_PATH}/sites/${SITE_DOMAIN}/articles`,
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    type: z.enum(['listicle', 'how-to', 'review', 'standard']).default('standard'),
    status: z.enum(['draft', 'review', 'published']).default('draft'),
    publishDate: z.coerce.date(),
    author: z.string(),
    tags: z.array(z.coerce.string()).default([]),
    featuredImage: z.string().optional(),
    reviewer_notes: z.string().optional(),
    slug: z.string(),
    excerpt: z.string().optional(),
  }),
});

export const collections = { articles };
