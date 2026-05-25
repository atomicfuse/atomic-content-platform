import type { APIRoute } from 'astro';
import { getConfig } from '../lib/config';

/**
 * Serve the merged ads.txt for each site.
 *
 * Content comes from the 5-layer config inheritance chain
 * (org → groups → overrides → site), resolved at seed-time
 * and stored in KV as `ads_txt: string[]`.
 */
export const GET: APIRoute = (context) => {
  const config = getConfig(context);
  const lines = config.ads_txt ?? [];

  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
};
