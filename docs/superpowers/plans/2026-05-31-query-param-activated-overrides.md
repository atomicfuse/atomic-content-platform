# Query-Param-Activated Overrides — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow dashboard overrides to activate only when a specific query parameter is present in the URL (e.g. `travelswire.com?tamirtest=true`), so config changes can be tested on production traffic without affecting normal visitors.

**Architecture:** Overrides with an `activation` field are excluded from the normal seed-time merge. Instead, they're stored as a separate KV entry (`cond-overrides:<siteId>`). At request time, the middleware reads this entry, checks if any query params match, and deep-merges the matching override into the config before rendering. No activation = existing behavior unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers KV, Astro middleware, React (dashboard)

---

## Safety invariant — CRITICAL

**Overrides without `activation` MUST continue to work exactly as today.** Every change in this plan is guarded by checking whether `activation` exists. The hot path for normal requests (no matching query param) adds one KV read that returns `null` — no merge, no config mutation.

---

## File structure

| # | File | Action | Responsibility |
|---|------|--------|----------------|
| 1 | `packages/site-worker/scripts/lib/resolve.ts` | Modify | Add `activation` to `OverrideConfig` interface, add `selectConditionalOverrides()` |
| 2 | `packages/site-worker/scripts/__tests__/resolve.test.ts` | Modify | Tests for new interface + filter function |
| 3 | `packages/site-worker/src/lib/kv-schema.ts` | Modify | Add `conditionalOverridesKey()` + `ConditionalOverrideEntry` type |
| 4 | `packages/site-worker/scripts/seed-kv.ts` | Modify | Split overrides with `activation` into separate KV entry |
| 5 | `packages/site-worker/src/lib/deep-merge.ts` | Create | Tiny deep-merge for runtime use (copy from resolve.ts) |
| 6 | `packages/site-worker/src/lib/__tests__/deep-merge.test.ts` | Create | Tests for runtime deep-merge |
| 7 | `packages/site-worker/src/middleware.ts` | Modify | Load conditional overrides, check query params, merge into config |
| 8 | `packages/site-worker/src/lib/preview-override.ts` | Modify | Propagate activation query params across navigation + fetch |
| 9 | `packages/site-worker/src/lib/__tests__/preview-override.test.ts` | Modify | Tests for param propagation script |
| 10 | `services/dashboard/src/app/overrides/[id]/page.tsx` | Modify | Add activation fields to General tab |

---

### Task 1: Add `activation` to the `OverrideConfig` interface + filter helper

**Files:**
- Modify: `packages/site-worker/scripts/lib/resolve.ts:244-250`
- Modify: `packages/site-worker/scripts/__tests__/resolve.test.ts`

- [ ] **Step 1: Write the failing test for `selectConditionalOverrides`**

Add to `resolve.test.ts` after the existing `selectMatchingOverrides` describe block:

```ts
describe('selectConditionalOverrides', () => {
  const overrides: OverrideConfig[] = [
    {
      override_id: 'always-on',
      priority: 10,
      targets: { sites: ['travelswire'] },
      ads_config: { ad_placements: [{ id: 'a1', position: 'above-content' }] },
    },
    {
      override_id: 'conditional-tamir',
      priority: 20,
      targets: { sites: ['travelswire'] },
      activation: { query_param: 'tamirtest', query_value: 'true' },
      ads_config: { ad_placements: [{ id: 'a2', position: 'below_content' }] },
    },
    {
      override_id: 'conditional-param-only',
      priority: 30,
      targets: { sites: ['travelswire'] },
      activation: { query_param: 'debug' },
      tracking: { ga4: 'G-DEBUG' },
    },
  ];

  it('returns only overrides that have activation field', () => {
    const result = selectConditionalOverrides(overrides, 'travelswire', []);
    expect(result.map((o) => o.override_id)).toEqual(['conditional-tamir', 'conditional-param-only']);
  });

  it('does not return overrides without activation', () => {
    const result = selectConditionalOverrides(overrides, 'travelswire', []);
    expect(result.map((o) => o.override_id)).not.toContain('always-on');
  });

  it('respects site targeting', () => {
    const result = selectConditionalOverrides(overrides, 'otherdomain', []);
    expect(result).toHaveLength(0);
  });

  it('sorts by priority ascending', () => {
    const result = selectConditionalOverrides(overrides, 'travelswire', []);
    const ps = result.map((o) => o.priority ?? 0);
    expect(ps).toEqual([...ps].sort((a, b) => a - b));
  });
});
```

Also add a test that `selectMatchingOverrides` now EXCLUDES overrides with `activation`:

```ts
it('excludes overrides that have activation (conditional overrides)', () => {
  const withActivation: OverrideConfig[] = [
    { override_id: 'normal', priority: 10, targets: { sites: ['coolnews-atl'] } },
    { override_id: 'conditional', priority: 20, targets: { sites: ['coolnews-atl'] }, activation: { query_param: 'test' } },
  ];
  const result = selectMatchingOverrides(withActivation, 'coolnews-atl', []);
  expect(result.map((o) => o.override_id)).toEqual(['normal']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/site-worker && pnpm vitest run scripts/__tests__/resolve.test.ts`
Expected: FAIL — `selectConditionalOverrides` not exported, existing test fails because `activation` overrides are still included.

- [ ] **Step 3: Implement the changes in `resolve.ts`**

Update the `OverrideConfig` interface (around line 244):

```ts
export interface OverrideConfig extends Record<string, unknown> {
  override_id?: string;
  name?: string;
  /** Lowest priority is applied FIRST; highest LAST (so it wins). */
  priority?: number;
  targets?: { groups?: string[]; sites?: string[] };
  /** When present, this override is NOT merged at seed-time. Instead it's
   *  stored separately and applied at request-time only when the specified
   *  query parameter is present in the URL. */
  activation?: { query_param: string; query_value?: string };
}
```

Update `selectMatchingOverrides` to exclude conditional overrides (line 264 — add one filter):

```ts
export function selectMatchingOverrides(
  overrides: OverrideConfig[],
  siteId: string,
  siteGroups: readonly string[],
): OverrideConfig[] {
  const matching = overrides.filter((o) => {
    // Skip conditional overrides — they're handled at request-time, not seed-time.
    if (o.activation) return false;
    const t = o.targets ?? {};
    const sites = Array.isArray(t.sites) ? t.sites : [];
    const groups = Array.isArray(t.groups) ? t.groups : [];
    if (sites.includes(siteId)) return true;
    if (groups.some((g) => siteGroups.includes(g))) return true;
    return false;
  });
  return [...matching].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}
```

Add the new function right below `selectMatchingOverrides`:

```ts
/**
 * Filters overrides that have an `activation` condition AND target the given
 * site. These are stored separately in KV and evaluated at request-time.
 */
export function selectConditionalOverrides(
  overrides: OverrideConfig[],
  siteId: string,
  siteGroups: readonly string[],
): OverrideConfig[] {
  const matching = overrides.filter((o) => {
    if (!o.activation?.query_param) return false;
    const t = o.targets ?? {};
    const sites = Array.isArray(t.sites) ? t.sites : [];
    const groups = Array.isArray(t.groups) ? t.groups : [];
    if (sites.includes(siteId)) return true;
    if (groups.some((g) => siteGroups.includes(g))) return true;
    return false;
  });
  return [...matching].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/site-worker && pnpm vitest run scripts/__tests__/resolve.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/site-worker/scripts/lib/resolve.ts packages/site-worker/scripts/__tests__/resolve.test.ts
git commit -m "feat(overrides): add activation field to OverrideConfig and selectConditionalOverrides helper"
```

Also add `activation` to `stripOverrideMetaFields` so it doesn't leak into the KV config when conditional overrides are processed:

Update the function at line 360:

```ts
export function stripOverrideMetaFields(config: Record<string, unknown>): Record<string, unknown> {
  const { override_id, name, priority, targets, activation, ...rest } = config;
  void override_id; void name; void priority; void targets; void activation;
  return rest;
}
```

---

### Task 2: Add KV key builder + type for conditional overrides

**Files:**
- Modify: `packages/site-worker/src/lib/kv-schema.ts`

- [ ] **Step 1: Add the type and key builder**

Add after the existing key builders (after line 67):

```ts
/** A conditional override stored in KV. Stripped of meta-fields except
 *  activation (needed at request-time for query-param matching). */
export interface ConditionalOverrideEntry {
  override_id: string;
  priority: number;
  activation: { query_param: string; query_value?: string };
  /** The config patch to deep-merge when activation matches. */
  config: Record<string, unknown>;
}

export const conditionalOverridesKey = (siteId: string): string => `cond-overrides:${siteId}`;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/site-worker && pnpm tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/lib/kv-schema.ts
git commit -m "feat(kv-schema): add conditionalOverridesKey and ConditionalOverrideEntry type"
```

---

### Task 3: Store conditional overrides separately in seed-kv

**Files:**
- Modify: `packages/site-worker/scripts/seed-kv.ts:314-330`

This is the **key safety change**. Overrides with `activation` are NOT merged into the config layers. They're stored as a separate KV entry that middleware reads at request-time.

- [ ] **Step 1: Import the new helper and type**

At the top of `seed-kv.ts`, update the import from `./lib/resolve` to include `selectConditionalOverrides`:

```ts
import {
  deepMerge,
  mergeScriptLayers,
  mergeAdPlacementLayers,
  resolveScriptVars,
  selectMatchingOverrides,
  selectConditionalOverrides,  // NEW
  stripModeKeys,
  stripOverrideMetaFields,
  // ... other existing imports
} from './lib/resolve';
```

Also import the new KV type:

```ts
import { conditionalOverridesKey, type ConditionalOverrideEntry } from '../src/lib/kv-schema';
```

- [ ] **Step 2: Update `resolveSiteConfig` to extract and return conditional overrides**

Update the return type (line 277):

```ts
async function resolveSiteConfig(siteId: string): Promise<{
  config: ResolvedConfig;
  site: Record<string, unknown>;
  conditionalOverrides: ConditionalOverrideEntry[];
}> {
```

After line 330 (the end of the `for (const o of matchingOverrides)` loop), add:

```ts
  // Conditional overrides — stored separately, applied at request-time
  // when the activation query param is present in the URL.
  const conditionalMatches = selectConditionalOverrides(overrideFiles, siteId, groups);
  const condEntries: ConditionalOverrideEntry[] = conditionalMatches.map((o) => ({
    override_id: o.override_id ?? 'unnamed',
    priority: o.priority ?? 0,
    activation: o.activation!,
    config: stripOverrideMetaFields(stripModeKeys(o) as Record<string, unknown>),
  }));
  if (condEntries.length > 0) {
    console.log(`[seed-kv]   conditional overrides: ${condEntries.map((o) => o.override_id).join(', ')}`);
  }
```

At the bottom of `resolveSiteConfig` (line 451), update the return to include `conditionalOverrides`:

```ts
  return { config, site, conditionalOverrides: condEntries };
```

- [ ] **Step 3: Update `main()` to write conditional overrides to KV**

Update the destructuring in `main()` (around line 492):

```ts
  const { config, conditionalOverrides } = await resolveSiteConfig(siteId);
```

Note: `site` is NOT used in `main()` (it was only needed inside `resolveSiteConfig`), so omitting it from the destructuring is safe.

Before the `bulkPut(entries)` call, always write the conditional overrides key (empty array is fine — this ensures stale entries are cleaned up when an override's `activation` is removed):

```ts
  entries.push({
    key: conditionalOverridesKey(siteId),
    value: JSON.stringify(conditionalOverrides),
  });
  if (conditionalOverrides.length > 0) {
    console.log(`[seed-kv] conditional overrides for KV: ${conditionalOverrides.length}`);
  }
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd packages/site-worker && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd packages/site-worker && pnpm vitest run`
Expected: ALL PASS — no existing behavior changed for overrides without `activation`.

- [ ] **Step 6: Commit**

```bash
git add packages/site-worker/scripts/seed-kv.ts
git commit -m "feat(seed-kv): store conditional overrides as separate KV entry"
```

---

### Task 4: Runtime deep-merge utility for the worker

**Files:**
- Create: `packages/site-worker/src/lib/deep-merge.ts`
- Create: `packages/site-worker/src/lib/__tests__/deep-merge.test.ts`

The `deepMerge` in `scripts/lib/resolve.ts` is a build-time script dependency. The worker middleware needs the same function at runtime. Rather than cross-importing from `scripts/` (which would pull in the `yaml` package and other build-only deps), create a minimal copy.

- [ ] **Step 1: Write the test**

Create `packages/site-worker/src/lib/__tests__/deep-merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deepMerge } from '../deep-merge';

describe('deepMerge (runtime)', () => {
  it('merges nested objects', () => {
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  });

  it('arrays in b replace arrays in a', () => {
    expect(deepMerge({ x: [1, 2] }, { x: [3] })).toEqual({ x: [3] });
  });

  it('null/undefined in b do not erase a', () => {
    expect(deepMerge({ x: 1 }, { x: null })).toEqual({ x: 1 });
    expect(deepMerge({ x: 1 }, { x: undefined })).toEqual({ x: 1 });
  });

  it('later scalar wins', () => {
    expect(deepMerge({ x: 1 }, { x: 2 })).toEqual({ x: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/site-worker && pnpm vitest run src/lib/__tests__/deep-merge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `packages/site-worker/src/lib/deep-merge.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/site-worker && pnpm vitest run src/lib/__tests__/deep-merge.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/site-worker/src/lib/deep-merge.ts packages/site-worker/src/lib/__tests__/deep-merge.test.ts
git commit -m "feat(site-worker): add runtime deep-merge utility for conditional overrides"
```

---

### Task 5: Middleware — apply conditional overrides at request-time

**Files:**
- Modify: `packages/site-worker/src/middleware.ts`

This is the core runtime change. The middleware gains one extra KV read for conditional overrides. If the KV entry doesn't exist or no query params match, config is completely unchanged.

- [ ] **Step 1: Add imports**

At the top of `middleware.ts`, add:

```ts
import { conditionalOverridesKey, type ConditionalOverrideEntry } from './lib/kv-schema';
import { deepMerge } from './lib/deep-merge';
```

- [ ] **Step 2: Change `const config` to `let config` (line 114)**

The conditional override merge needs to reassign `config`. Change:

```ts
  const config = await env.CONFIG_KV.get<ResolvedConfig>(siteConfigKey(siteId), 'json');
```
to:
```ts
  let config = await env.CONFIG_KV.get<ResolvedConfig>(siteConfigKey(siteId), 'json');
```

- [ ] **Step 3: Add conditional override resolution after config is loaded (after line 123)**

After the config is loaded and validated (after the `if (!config)` block ending at line 123), and BEFORE `context.locals.site` is set (line 126), insert:

```ts
  // --- Conditional overrides (query-param-activated) ---
  // Only triggered when the URL contains a matching query param.
  // If no conditional overrides exist for this site, the KV read returns
  // null and we skip — zero impact on the config.
  let matchedActivationParams: Array<[string, string]> = [];
  if (context.url.searchParams.toString()) {
    const condOverrides = await env.CONFIG_KV.get<ConditionalOverrideEntry[]>(
      conditionalOverridesKey(siteId),
      'json',
    );
    if (condOverrides && condOverrides.length > 0) {
      for (const co of condOverrides) {
        const paramValue = context.url.searchParams.get(co.activation.query_param);
        if (paramValue === null) continue;
        if (co.activation.query_value && paramValue !== co.activation.query_value) continue;
        // Match — merge this override's config on top.
        config = deepMerge(config, co.config) as ResolvedConfig;
        matchedActivationParams.push([co.activation.query_param, paramValue]);
      }
    }
  }
  const hasConditionalOverride = matchedActivationParams.length > 0;
```

Cache handling for conditional overrides is done in Task 6 (param propagation script block sets `cache-control: private, no-store`).

- [ ] **Step 4: Verify typecheck passes**

Run: `cd packages/site-worker && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run all existing tests to make sure nothing breaks**

Run: `cd packages/site-worker && pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/site-worker/src/middleware.ts
git commit -m "feat(middleware): apply conditional overrides based on query params"
```

---

### Task 6: Propagate activation query params across navigation

**Files:**
- Modify: `packages/site-worker/src/lib/preview-override.ts`
- Modify: `packages/site-worker/src/lib/__tests__/preview-override.test.ts`
- Modify: `packages/site-worker/src/middleware.ts` (inject script)

When a user visits `travelswire.com/article?tamirtest=true` and clicks an internal link, the `tamirtest=true` param must carry over — otherwise the next page renders without the override. Same problem the `_atl_site` param already solves. We use the same pattern.

- [ ] **Step 1: Write the test**

Add to `preview-override.test.ts`:

```ts
describe('generateParamPropagationScript', () => {
  it('returns a script tag with the params embedded', () => {
    const script = generateParamPropagationScript([['tamirtest', 'true']]);
    expect(script).toContain('<script data-atl-param-propagation>');
    expect(script).toContain('tamirtest');
    expect(script).toContain('true');
  });

  it('returns empty string for empty params', () => {
    expect(generateParamPropagationScript([])).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/site-worker && pnpm vitest run src/lib/__tests__/preview-override.test.ts`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement in `preview-override.ts`**

Add at the end of the file:

```ts
/**
 * Generates an inline script that propagates the given query params
 * across internal link clicks and fetch calls — same pattern as
 * `generatePreviewScript` for `_atl_site`.
 *
 * Used for conditional override activation params so navigating between
 * pages keeps the override active.
 */
export function generateParamPropagationScript(params: Array<[string, string]>): string {
  if (params.length === 0) return '';
  const paramsJson = JSON.stringify(params);
  return [
    `<script data-atl-param-propagation>(function(){`,
    `var ps=${paramsJson};`,
    `document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;try{var u=new URL(a.href);if(u.origin!==location.origin)return;var changed=false;for(var i=0;i<ps.length;i++){if(!u.searchParams.has(ps[i][0])){u.searchParams.set(ps[i][0],ps[i][1]);changed=true;}}if(changed)a.href=u.pathname+u.search+u.hash}catch(x){}},true);`,
    `var _f=window.fetch;window.fetch=function(r,o){try{var u=(typeof r==='string')?new URL(r,location.origin):r instanceof URL?r:null;if(u&&u.origin===location.origin){for(var i=0;i<ps.length;i++){if(!u.searchParams.has(ps[i][0]))u.searchParams.set(ps[i][0],ps[i][1]);}r=u.toString()}}catch(x){}return _f.call(this,r,o)};`,
    `})()</script>`,
  ].join('');
}
```

- [ ] **Step 4: Inject the script in middleware**

In `middleware.ts`, after the `if (preview.siteIdOverride)` script injection block (around line 147), add:

```ts
  // Propagate conditional override query params across navigation.
  // Same pattern as _atl_site: rewrite <a> hrefs and patch fetch().
  if (hasConditionalOverride) {
    const contentType = finalResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = typeof (finalResponse as Response & { _bodyUsed?: boolean })._bodyUsed !== 'undefined'
        ? await finalResponse.clone().text()
        : await finalResponse.text();
      // Collect the matched activation params from the URL
      const activationParams: Array<[string, string]> = [];
      // Re-check which params matched (we know hasConditionalOverride is true)
      const condOverrides2 = await env.CONFIG_KV.get<ConditionalOverrideEntry[]>(
        conditionalOverridesKey(siteId),
        'json',
      );
```

Note: `matchedActivationParams` was already collected during the conditional override loop in Task 5 Step 3.

After the existing preview script injection block (after line 147), add the param propagation script:

```ts
  if (hasConditionalOverride) {
    const contentType = finalResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await finalResponse.text();
      const script = generateParamPropagationScript(matchedActivationParams);
      const modifiedHtml = html.replace('</head>', `${script}\n</head>`);
      finalResponse = new Response(modifiedHtml, {
        status: finalResponse.status,
        statusText: finalResponse.statusText,
        headers: new Headers(finalResponse.headers),
      });
    }
    finalResponse.headers.set('cache-control', 'private, no-store');
  }
```

**Body consumption safety:** When preview is active, the preview block already consumed `response.text()` and created a NEW `finalResponse` with an unconsumed body. So `await finalResponse.text()` here reads the new Response's body — no conflict. When preview is NOT active, `finalResponse = response` and its body is unconsumed. Both paths are safe.

- [ ] **Step 5: Update the import in middleware.ts**

```ts
import { resolvePreview, generatePreviewScript, generateParamPropagationScript } from './lib/preview-override';
```

- [ ] **Step 6: Run tests**

Run: `cd packages/site-worker && pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/site-worker/src/lib/preview-override.ts packages/site-worker/src/lib/__tests__/preview-override.test.ts packages/site-worker/src/middleware.ts
git commit -m "feat(preview-override): propagate activation query params across navigation"
```

---

### Task 7: Dashboard — add Activation section to override detail page

**Files:**
- Modify: `services/dashboard/src/app/overrides/[id]/page.tsx`

- [ ] **Step 1: Add `activation` to the local `OverrideConfig` interface**

At line 22 (after `targets`), add:

```ts
  activation?: { query_param: string; query_value?: string };
```

- [ ] **Step 2: Add the Activation UI to the General tab content**

Inside the General tab content `<div>` (around line 261-284), after the Priority section, add:

```tsx
          <div className="mt-6 space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Activation Condition <span className="font-normal text-[var(--text-muted)]">(optional)</span>
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              When set, this override only applies when the URL contains the specified query parameter.
              Leave empty to apply the override to all requests (default behavior).
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Query Parameter Name"
                placeholder="e.g. tamirtest"
                value={config.activation?.query_param ?? ""}
                onChange={(e): void => {
                  const val = e.target.value.trim();
                  if (!val) {
                    // Clear activation entirely
                    const { activation: _, ...rest } = config;
                    setConfig(rest as OverrideConfig);
                  } else {
                    updateField("activation", {
                      query_param: val,
                      query_value: config.activation?.query_value,
                    });
                  }
                }}
              />
              <Input
                label="Query Value"
                placeholder="e.g. true (leave empty = any value)"
                value={config.activation?.query_value ?? ""}
                onChange={(e): void => {
                  const val = e.target.value.trim();
                  updateField("activation", {
                    query_param: config.activation?.query_param ?? "",
                    ...(val ? { query_value: val } : {}),
                  });
                }}
              />
            </div>
            {config.activation?.query_param && targetSites.length > 0 && (
              <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-[var(--text-secondary)]">
                <span className="font-semibold text-emerald-600">Preview URL: </span>
                <code className="break-all">
                  https://{targetSites[0]}?{config.activation.query_param}
                  {config.activation.query_value ? `=${config.activation.query_value}` : ""}
                </code>
              </div>
            )}
          </div>
```

- [ ] **Step 3: Verify the dashboard typecheck passes**

Run: `cd services/dashboard && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/overrides/[id]/page.tsx
git commit -m "feat(dashboard): add activation condition UI to override detail page"
```

---

### Task 8: Final verification — end-to-end safety check

**No code changes.** This task verifies the complete feature works and nothing is broken.

- [ ] **Step 1: Run ALL tests across the monorepo**

Run: `pnpm test` (from repo root)
Expected: ALL PASS — zero regressions

- [ ] **Step 2: Run typecheck across the monorepo**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Verify existing overrides are unaffected**

Mental checklist — confirm each:
- [ ] Overrides WITHOUT `activation` still merge at seed-time in `selectMatchingOverrides` (✓ — filter only skips when `activation` is present)
- [ ] The resolved `site-config:<siteId>` KV entry is identical to what it was before (✓ — non-conditional overrides flow through same merge path)
- [ ] Middleware falls through cleanly when no conditional overrides exist (✓ — `context.url.searchParams.toString()` is empty for normal requests OR KV returns `null`)
- [ ] Cache headers unchanged for normal requests (✓ — `hasConditionalOverride` is false)
- [ ] `stripOverrideMetaFields` strips `activation` (✓ — added in Task 1)

- [ ] **Step 4: Verify no new KV fields on `ResolvedConfig`**

The `cond-overrides:<siteId>` is a separate KV key — NOT a field on the existing `site-config` entry. No landmine #38 risk. Existing KV entries remain unchanged. Sites that haven't been re-seeded simply won't have `cond-overrides:*` and the middleware handles `null` gracefully.

---

## Deployment sequence

This is important — the middleware change reads from `cond-overrides:<siteId>`, which only exists after re-seeding.

1. **Deploy site-worker** (with the new middleware). No conditional overrides exist in KV yet → `CONFIG_KV.get()` returns `null` → middleware skips the block entirely. **Zero impact on existing sites.**
2. **Deploy dashboard** (with the new activation UI). No overrides have `activation` yet → nothing changes until someone creates one.
3. **Create a conditional override** via the dashboard (e.g. `tamirtest=true` targeting `travelswire`).
4. **Re-seed the target site** (`pnpm seed:kv travelswire travelswire.com`). This writes `cond-overrides:travelswire` to KV.
5. **Test** by visiting `travelswire.com?tamirtest=true` and verifying the override config is applied.

This order ensures zero risk at every step — each deployment is safe even without the others.
