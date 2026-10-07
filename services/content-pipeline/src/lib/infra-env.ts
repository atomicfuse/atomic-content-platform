/**
 * Connection URLs for the grid-provided Mongo and Redis. cloudgrid.yaml `needs:` (v2) injects
 * DATABASE_MONGODB_URL / QUEUE_REDIS_URL; the v1 `requires:` names (MONGODB_URL, REDIS_URL) are
 * checked first so an explicit local .env override (e.g. REDIS_URL=redis://localhost:6379, see
 * CLAUDE.md #32) still wins. Read lazily — never at module top level.
 */
type Env = Record<string, string | undefined>;

export function mongoUrl(env: Env = process.env): string | undefined {
  return env.MONGODB_URL || env.MONGODB_URI || env.DATABASE_MONGODB_URL || undefined;
}

export function redisUrl(env: Env = process.env): string | undefined {
  return env.REDIS_URL || env.QUEUE_REDIS_URL || undefined;
}
