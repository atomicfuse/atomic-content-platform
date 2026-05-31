/**
 * Deep-merge two objects. Arrays in `b` REPLACE arrays in `a`.
 * `null`/`undefined` in `b` do NOT override values in `a`.
 *
 * Identical to `scripts/lib/resolve.ts#deepMerge` but kept here as a
 * separate copy so the runtime worker bundle doesn't pull in the
 * build-time `yaml` package and other script-only dependencies.
 */
export function deepMerge(a: unknown, b: unknown): unknown {
  if (b === undefined || b === null) return a;
  if (
    typeof a !== 'object'
    || typeof b !== 'object'
    || Array.isArray(a)
    || Array.isArray(b)
    || a === null
  ) {
    return b;
  }
  const merged: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [key, val] of Object.entries(b as Record<string, unknown>)) {
    merged[key] = deepMerge(merged[key], val);
  }
  return merged;
}
