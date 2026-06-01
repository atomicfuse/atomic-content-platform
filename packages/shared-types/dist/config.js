"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAYOUT_DEFAULTS = void 0;
/**
 * Baseline defaults for the v2 magazine layout. Used as the starting point
 * by `resolveLayout()` before merging org/group/site overrides.
 */
exports.LAYOUT_DEFAULTS = {
    hero: { enabled: true, count: 4 },
    must_reads: { enabled: true, count: 5 },
    whats_new: { enabled: true, count: 4 },
    more_on: { enabled: true, page_size: 8 },
    sidebar_topics: { auto: true, explicit: [] },
    load_more: { page_size: 4 },
};
//# sourceMappingURL=config.js.map