import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS } from '@atomic-platform/shared-types';
import { cardBodyAttributes } from '../head';

describe('cardBodyAttributes', () => {
  it('maps the card look to body data attributes', () => {
    expect(cardBodyAttributes({ ...GRID_CARD_DEFAULTS, style: 'shadow', image_ratio: '16:9' })).toEqual({
      'data-card-style': 'shadow', 'data-card-corners': 'rounded', 'data-card-ratio': '16-9',
      'data-card-image': 'top', 'data-card-density': 'comfortable', 'data-card-source': 'below',
    });
  });
});
