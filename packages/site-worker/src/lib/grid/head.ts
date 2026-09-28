import type { ResolvedGridCardConfig } from '@atomic-platform/shared-types';

/** Card look → <body> data attributes consumed by grid.css (ratio "4:3" → "4-3" for valid selectors). */
export function cardBodyAttributes(card: ResolvedGridCardConfig): Record<string, string> {
  return {
    'data-card-style': card.style,
    'data-card-corners': card.corners,
    'data-card-ratio': card.image_ratio.replace(':', '-'),
    'data-card-image': card.image_position,
    'data-card-density': card.density,
    'data-card-source': card.source_position,
  };
}
