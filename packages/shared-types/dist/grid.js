"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRID_CARD_DEFAULTS = exports.GRID_DEFAULTS = exports.GRID_CARD_OPTIONS = void 0;
/** Allowed values for each card-look option (single source for validation + dashboard). */
exports.GRID_CARD_OPTIONS = {
    style: ["bordered", "shadow", "flat"],
    corners: ["square", "small", "rounded"],
    image_ratio: ["4:3", "16:9", "1:1"],
    image_position: ["top", "left"],
    density: ["comfortable", "compact"],
    source_position: ["below", "badge"],
};
/** Seed-time and runtime defaults for `grid`. */
exports.GRID_DEFAULTS = {
    topics: [],
    include_sites: [],
    exclude_sites: [],
    per_site_limit: 10,
    max_age_days: null,
    story_mode: "excerpt",
    excerpt_paragraphs: 3,
    feed_ad_every: 3,
    page_size: 20,
    show_intro: false,
    outbound_utm: true,
    pinned: [],
    external_story_mode: "what_it_covers",
    blocked_categories: [],
    per_bundle_limit: 20,
    hidden_stories: [],
    blocked_domains: [],
};
/** Seed-time and runtime defaults for `theme.card` (dazzr-like). */
exports.GRID_CARD_DEFAULTS = {
    style: "bordered",
    corners: "rounded",
    image_ratio: "4:3",
    image_position: "top",
    density: "comfortable",
    source_position: "below",
};
//# sourceMappingURL=grid.js.map