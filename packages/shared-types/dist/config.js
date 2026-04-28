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
    sidebar_topics: { auto: true, explicit: [] },
    load_more: { page_size: 10 },
};
//# sourceMappingURL=config.js.map