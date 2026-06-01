import { defineConfig } from 'vitest/config';

/**
 * Three projects:
 *
 * - `unit`: pure-function tests under `scripts/__tests__/` and
 *   `src/**\/__tests__/`. No network, no fs writes outside tmp. Fast (<2s).
 *
 * - `build`: spawns the actual `pnpm build` and asserts on its outputs.
 *   Slower (~5s); covers the regression that bit Phase 6 (Astro adapter
 *   not propagating env-specific KV bindings).
 *
 * - `live`: HTTP smoke against the deployed staging Worker URL. Slowest;
 *   only run on demand or via the `site-worker-live.yml` cron.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/__tests__/**/*.test.ts', 'scripts/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'build',
          include: ['tests/build/**/*.test.ts'],
          environment: 'node',
          // Build tests spawn the actual `pnpm build` so they need a longer budget.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
    ],
  },
});
