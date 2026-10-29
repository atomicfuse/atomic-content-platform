# Cookie Consent Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add our own cookie-consent banner to every site, configured as a
new inheritable `consent` block (org → group → override → site), editable in
the dashboard.

**Architecture:** The pieces, by where they run:
- **Cached page HTML** (the same for every visitor):
  - a static Consent Mode bootstrap in `<head>`;
  - a footer "Cookie settings" button.
- **The `PixelLoader` server island** (per request, no-store):
  - reads the visitor's country and their `atl_consent` cookie;
  - renders marketing tags live or inert;
  - renders the banner and a small client script.
- **Shared logic:** pure functions in `packages/site-worker/src/lib/consent.ts`.
- **Dashboard:** a new `ConsentSection` inside `UnifiedConfigForm`.

**Tech Stack:** Astro 6 on Cloudflare Workers, TypeScript strict, vitest,
Next.js 15 dashboard, RTL.

**Spec:** `docs/superpowers/specs/2026-10-29-cookie-consent-design.md`

## Global Constraints

- **Cookie:** `atl_consent`, value `v1.<a>.<m>` (`a`, `m` ∈ `0|1`), `Path=/;
  SameSite=Lax; Max-Age=15552000` (180 days). Set in the browser, never
  HttpOnly.
- **Opt-in countries:** EU 27 + `IS`, `LI`, `NO` + `GB` + `CH`. Unknown,
  empty, `XX` and `T1` also count as opt-in.
- **Defaults:**

  ```ts
  CONSENT_DEFAULTS = {
    enabled: false,
    show_to: 'everyone',
    countries: [],
    message: '',
    privacy_url: '/privacy',
  }
  ```
- **Default message:** "We use cookies to measure traffic and improve your
  experience. You can accept, reject, or choose in Settings."
- **Link labels:** "Cookie settings" by default; "Do not sell or share my
  personal information" for `US`.
- **Consent disabled:** `PixelLoader` output and the layouts' `<head>` must
  be byte-identical to today.
- **Ads are never withheld:** `scripts.*`, the interstitial and ad slots are
  untouched.
- **Staging country override:** `?consent_country=XX`, accepted only when
  the hostname ends with `.workers.dev` or is `localhost`. Stored in the
  session cookie `atl_consent_country`.
- **TypeScript:** strict, no `any`, explicit return types. Commits are
  conventional, with the trailer `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>`.

## Review Focus

1. **A visitor who already chose loads a cached page.** Neither the
   bootstrap nor the island may re-show the banner or reset the choice.
   Test: bootstrap with cookie `v1.0.0` emits a denied default and no
   region default (Task 3).
2. **`show_to: countries` and a visitor whose country isn't listed.** They
   get no banner and everything allowed, even in an opt-in country. Test in
   `decideConsent` (Task 1).
3. **A site with only GTM** (no GA4 or Google Ads). The bootstrap must still
   define the `gtag` shim before GTM pushes. Test: the bootstrap defines
   `window.gtag` when run alone (Task 3).
4. **A `tracking.custom` entry containing a `<script>`.** While inert it must
   not execute, and after Accept it must execute once. Test in the client
   script test (Task 4).
5. **Malformed or garbage cookie values** (`v2.1.1`, `v1.x.1`, empty). Treated
   as no choice, never a 500. Test in `parseConsentCookie` (Task 1) and the
   middleware cookie read (Task 5).

---

### Task 1: Shared types + consent core logic

**Files:**
- Modify: `packages/shared-types/src/config.ts`. Add `ConsentConfig` and
  `ResolvedConsentConfig`; add `consent?: Partial<ConsentConfig>` to
  `OrgConfig`, `GroupConfig` and `SiteConfig`; add `consent:
  ResolvedConsentConfig` to `ResolvedConfig`.
- Modify: `packages/shared-types/src/index.ts` (export the new types).
- Create: `packages/site-worker/src/lib/consent.ts`
- Test: `packages/site-worker/src/lib/__tests__/consent.test.ts`

**Interfaces (produces):**

```ts
export interface ConsentConfig {
  enabled: boolean;
  show_to: 'everyone' | 'countries';
  countries: string[];
  message: string;
  privacy_url: string;
}
export type ResolvedConsentConfig = ConsentConfig;

// consent.ts
export const OPT_IN_COUNTRIES: readonly string[];
export const CONSENT_DEFAULTS: ResolvedConsentConfig;
export const DEFAULT_CONSENT_MESSAGE: string;
export const CONSENT_COOKIE = 'atl_consent';
export type ConsentRegion = 'opt_in' | 'notice';
export interface ConsentChoice { analytics: boolean; marketing: boolean }
export interface ConsentDecision {
  region: ConsentRegion;
  showBanner: boolean;
  analyticsAllowed: boolean;
  marketingAllowed: boolean;
  stored: boolean;
}
export function normalizeConsentConfig(
  raw: unknown,
  warn?: (msg: string) => void,
): ResolvedConsentConfig;
export function regionFor(country: string | null | undefined): ConsentRegion;
export function parseConsentCookie(value: string | null | undefined): ConsentChoice | null;
export function formatConsentCookie(choice: ConsentChoice): string; // "v1.1.0"
export function decideConsent(input: {
  consent: ResolvedConsentConfig;
  country: string | null;
  cookie: ConsentChoice | null;
}): ConsentDecision;
```

- [ ] **Step 1: Write the failing tests** in `consent.test.ts`:
  - **`normalizeConsentConfig`:**
    - `undefined` → `CONSENT_DEFAULTS`.
    - `{show_to:'banana'}` → `show_to:'everyone'`, and `warn` is called.
    - `countries:['de',' fr ','DE','zzz1']` → `['DE','FR']`.
    - `enabled:'yes'` → `false`, with a warning.
    - `privacy_url:''` → `'/privacy'`.
  - **`regionFor`:**
    - `'DE'`, `'GB'`, `'CH'`, `'NO'` → `opt_in`.
    - `'US'`, `'IL'` → `notice`.
    - `null`, `''`, `'XX'`, `'T1'` → `opt_in`.
    - Lower-case `'de'` → `opt_in`.
  - **Cookie:**
    - `parseConsentCookie('v1.1.0')` → `{analytics:true, marketing:false}`.
    - `'v2.1.1'`, `'v1.x.1'`, `''` and `null` → `null`.
    - Round-trip through `formatConsentCookie`.
  - **`decideConsent`:**
    - Disabled → `showBanner:false`, both allowed.
    - Stored `{false,false}` in a notice region → both denied, no banner,
      `stored:true`.
    - Opt-in, no cookie → banner, both denied.
    - Notice, no cookie → banner, both allowed.
    - `show_to:'countries'`, `countries:['FR']`, country `DE` → no banner,
      both allowed.
    - Same config with country `FR` → banner, denied.
- [ ] **Step 2: Run the tests and confirm they fail.** Run: `cd
  packages/site-worker && pnpm vitest run --project unit
  src/lib/__tests__/consent.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the types and `consent.ts`.** The ISO code check
  is `/^[A-Z]{2}$/` after trim and upper-case.
- [ ] **Step 4: Run the tests and confirm they pass.** Also run `pnpm
  --filter @atomic-platform/shared-types build` and confirm it succeeds.
- [ ] **Step 5: Commit.** Message: `feat(site-worker): consent decision core
  and shared types`.

### Task 2: Seed-time + runtime defaults (KV schema evolution steps 1–2)

**Files:**
- Modify: `packages/site-worker/scripts/seed-kv.ts`. In the `config`
  literal (~line 627), add `consent: normalizeConsentConfig(merged.consent,
  (m) => console.warn(\`[seed-kv] ${siteId}: ${m}\`))`.
- Modify: `packages/site-worker/src/lib/config.ts`. In `getConfig`, add
  `config.consent ??= { ...CONSENT_DEFAULTS }`.
- Test: `packages/site-worker/src/lib/__tests__/consent-config.test.ts`

**Interfaces:** consumes `normalizeConsentConfig` and `CONSENT_DEFAULTS`
from Task 1.

- [ ] **Step 1: Write the failing tests.**
  - `getConfig({locals:{site:{config: configWithoutConsent}}}).consent`
    equals `CONSENT_DEFAULTS`. Use a fixture config shaped like the ones in
    `authors-config.test.ts`.
  - **Layered merge:** `deepMerge` (from `scripts/lib/resolve.ts`) of
    `org {consent:{enabled:true, countries:['DE']}}`, `group
    {consent:{countries:['FR']}}` and `site {consent:{message:'Hi'}}`,
    then normalized → `{enabled:true, countries:['FR'], message:'Hi',
    show_to:'everyone', privacy_url:'/privacy'}`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement both edits.**
- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full
  `pnpm test` in `packages/site-worker` and confirm it passes.
- [ ] **Step 5: Commit.** Message: `feat(site-worker): resolve consent
  config at seed time with runtime default`.

### Task 3: Head Consent Mode bootstrap

**Files:**
- Create: `packages/site-worker/src/lib/consent-scripts.ts`
- Modify: `packages/site-worker/src/layouts/BaseLayout.astro`. Directly
  after `<slot name="head" />` and before the `headScripts` map, add:
  ```astro
  {config.consent.enabled && <script is:inline set:html={buildConsentBootstrap()} />}
  ```
- Modify: `packages/site-worker/src/themes/grid/GridLayout.astro`. Same
  placement, before its head scripts.
- Add devDependency: `jsdom` to `packages/site-worker` (same major as the
  dashboard's, `^29`). It's used only by tests via `// @vitest-environment
  jsdom`.
- Test: `packages/site-worker/src/lib/__tests__/consent-bootstrap.test.ts`

**Interfaces (produces):** `export function buildConsentBootstrap(): string`.
It returns a self-contained IIFE string with no visitor or site data
interpolated except the `OPT_IN_COUNTRIES` constant.

- [ ] **Step 1: Write the failing tests** (jsdom). Eval the string, then
  inspect `window.dataLayer`:
  - **No cookie:** the first entry is `['consent','default',{4 keys
    denied, region: OPT_IN_COUNTRIES}]`. The next is `['consent','default',{4
    keys granted}]`.
  - **Cookie `atl_consent=v1.1.0`:** a single default with
    `analytics_storage:'granted'` and the three `ad_*` keys `'denied'`, and
    no region entry.
  - **No cookie and `navigator.globalPrivacyControl = true`:** the global
    default has the `ad_*` keys denied and `analytics_storage` granted.
  - `typeof window.gtag === 'function'` after eval (Review Focus 3).
  - The string contains no `{{` and no site-specific text.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** The shim must match Google's form:
  `window.dataLayer=window.dataLayer||[];function
  gtag(){dataLayer.push(arguments)}`, assigned to `window.gtag`. In the
  tests, convert `arguments` objects to arrays before comparing.
- [ ] **Step 4: Run the tests and confirm they pass.** Then run `pnpm
  typecheck` in `packages/site-worker` and confirm it passes.
- [ ] **Step 5: Commit.** Message: `feat(site-worker): consent mode default
  bootstrap in page head`.

### Task 4: Island — country, marketing gating, banner, client script

**Files:**
- Modify: `packages/site-worker/src/lib/consent-scripts.ts`. Add the banner
  HTML, the client script and the inert-tag helpers.
- Create: `packages/site-worker/src/lib/consent-request.ts`. Reads the
  country and the cookie from the request.
- Modify: `packages/site-worker/src/components/PixelLoader.astro`
- Test: `packages/site-worker/src/lib/__tests__/consent-request.test.ts`,
  `consent-island.test.ts` (jsdom)

**Interfaces (produces):**

```ts
// consent-request.ts
export const CONSENT_COUNTRY_COOKIE = 'atl_consent_country';
export function countryFromRequest(request: Request, opts: { isStaging: boolean }): string | null;
// Order: staging cookie (only if isStaging) → request.cf?.country → cf-ipcountry header → null.
export function consentCookieFromRequest(request: Request): ConsentChoice | null;

// consent-scripts.ts
export function inertScript(js: string): string;
// <script type="text/plain" data-atl-consent="marketing">…</script>; escapes "</script"
export function inertHtml(html: string): string;
// <template data-atl-consent="marketing">…</template>
export function renderConsentUi(input: {
  consent: ResolvedConsentConfig;
  decision: ConsentDecision;
  country: string | null;
}): string;
// Always: <script type="application/json" id="atl-consent-config">{region,country,analytics,marketing,showBanner,privacyUrl}</script>
// + client script.
// Banner markup only when decision.showBanner.
```

**The client script contract** (inline, an IIFE, wrapped in try/catch):
- **Wires buttons:**
  - `[data-atl-consent="accept"]`, `[data-atl-consent="reject"]` and
    `[data-atl-consent="settings"]` inside the banner root `.atl-consent`.
  - Every `[data-atl-consent-open]` on the page.
- **Panel:** it holds two checkboxes (`name="analytics"`,
  `name="marketing"`) and a `[data-atl-consent="save"]` button.
- **On each choice:**
  - Writes the cookie (format per Global Constraints).
  - Calls `gtag('consent','update',…)` if `window.gtag` exists.
  - **If marketing was granted,** activates every inert node. For a
    `script[type="text/plain"]`, create a new `<script>` with the same text.
    For a `template`, append its content and re-create any `<script>`
    inside it so it runs.
  - **If marketing was revoked** and `window.fbq` exists, calls
    `fbq('consent','revoke')`.
  - Hides the banner.
- **US relabel:** if the config's `country === 'US'`, sets the link text to
  "Do not sell or share my personal information".
- Escape closes the panel.

**PixelLoader changes:**
- When `config.consent.enabled`:
  - Compute the decision.
  - Render the Meta pixel block and `customScripts` via
    `inertScript`/`inertHtml` when `!decision.marketingAllowed`.
  - Append `renderConsentUi(...)`.
- When disabled: no change at all.
- Get `isStaging` from `isStagingEnv(Astro)`.

- [ ] **Step 1: Write the failing tests.**
  - **`countryFromRequest`:**
    - The `cf-ipcountry: us` header → `'US'`.
    - `request.cf = {country:'DE'}` beats the header.
    - The staging cookie `atl_consent_country=FR` is used only when
      `isStaging:true`.
    - Nothing → `null`.
  - **`consentCookieFromRequest`:**
    - A malformed `Cookie` header → `null`, no throw.
  - **`renderConsentUi` (jsdom):**
    - **No banner when `showBanner:false`,** but the config JSON and
      script are still present (the footer link must work).
    - **Banner present** with Accept and Reject as `<button>`s with the
      same class.
    - **The message is HTML-escaped:** `<b>x</b>` renders as text.
    - **The privacy link `href`** is `privacy_url`; a `javascript:` URL is
      replaced by `/privacy`.
    - **Click Accept:**
      - `document.cookie` contains `atl_consent=v1.1.1`.
      - A stubbed `gtag` received `consent`/`update` with granted.
      - An inert `<script type="text/plain"
        data-atl-consent="marketing">window.__ran=(window.__ran||0)+1</script>`
        runs exactly once (`__ran === 1`).
      - A `<template>` with an inline script runs once (Review Focus 4).
      - The banner is hidden.
    - **Click Reject:** cookie `v1.0.0`; `gtag` update denied;
      `fbq('consent','revoke')` called when `fbq` is stubbed; inert scripts
      not run.
    - **Settings → untick analytics → Save:** cookie `v1.0.1`.
    - **A US config relabels** an existing `[data-atl-consent-open]`.
  - **`inertScript`:** a body containing `</script>` is escaped and can't
    break out.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement `consent-request.ts`, the additions to
  `consent-scripts.ts`, and the PixelLoader edits.**

  Banner styles are inline `<style>` scoped under `.atl-consent`:
  - **Colours:** use `var(--color-background)`, `var(--color-text)` and
    `var(--color-primary)`, plus the foreground vars. Check the names
    against `themeForegroundVars`.
  - **Position:** `position:fixed; bottom:0; left:0; right:0;
    z-index:2147483000`.
  - **Clearing the sticky-bottom ad:** add `bottom:
    var(--atl-sticky-offset, 0px)`. The client script sets
    `--atl-sticky-offset` from the height of `[data-ad-position="sticky-bottom"]`
    or the existing sticky slot selector; grep `AdSlot.astro` for it.
- [ ] **Step 4: Run the tests and confirm they pass.** Then run `pnpm test`
  and `pnpm typecheck` in `packages/site-worker` and confirm both pass.
- [ ] **Step 5: Commit.** Message: `feat(site-worker): consent banner and
  marketing gating in pixel island`.

### Task 5: Staging country override + footer links

**Files:**
- Modify: `packages/site-worker/src/lib/consent-request.ts`. Add
  `consentCountryParam(searchParams): string | 'clear' | null` and the
  cookie header builders.
- Modify: `packages/site-worker/src/middleware.ts`. Copy the existing
  `mockAdsParam` handling, but only `if (isStaging)`. Set
  `atl_consent_country=<CC>; Path=/; SameSite=Lax` (a session cookie, not
  HttpOnly-sensitive, but keep it HttpOnly since only the server reads it),
  or clear it with `Max-Age=0`.
- Modify: `packages/site-worker/src/themes/modern/components/Footer.astro`.
  After `quickLinks`, when `config.consent?.enabled`, add `<li><button
  type="button" data-atl-consent-open class="…same look as links…">Cookie
  settings</button></li>`.
- Modify: `packages/site-worker/src/themes/grid/components/GridFooter.astro`.
  The same button with the `g-footer__link` class.
- Test: extend `consent-request.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `consentCountryParam`:
    - `?consent_country=de` → `'DE'`.
    - `?consent_country=` → `'clear'`.
    - `?consent_country=germany` → `null`.
    - Absent → `null`.
  - Cookie header strings as specified.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Use `Astro.locals.site.config` in the footers:
  `Footer` already receives `config` as a prop; check what `GridFooter`
  receives.
- [ ] **Step 4: Run the tests and confirm they pass.** Then run `pnpm test`,
  `pnpm typecheck` and `pnpm build` in `packages/site-worker` and confirm
  all pass.
- [ ] **Step 5: Commit.** Message: `feat(site-worker): staging consent
  country override and footer cookie-settings link`.

### Task 6: Dashboard consent section

**Files:**
- Modify: `services/dashboard/src/lib/config-normalizers.ts`. Add
  `normalizeConsent(raw: unknown): ConsentFormValue`.
- Create: `services/dashboard/src/components/config/ConsentSection.tsx`
- Modify: `services/dashboard/src/components/config/UnifiedConfigForm.tsx`.
  Add `consent?: ConsentFormValue` to `UnifiedConfigFields` and render
  `<ConsentSection>` after Legal in all modes.
- Modify: `services/dashboard/src/app/settings/page.tsx`,
  `src/app/groups/[groupId]/page.tsx`, `src/app/overrides/new/page.tsx`,
  `src/app/overrides/[id]/page.tsx`, and
  `src/components/site-detail/SiteConfigTab.tsx`. Map `consent:
  normalizeConsent(config.consent)` into `formConfig`, and make sure
  form changes write `consent` back to the saved object.
- Modify: `services/dashboard/src/lib/site-config-updates.ts`. Add
  `"consent"` to `SAVED_SECTIONS`, and add `applyConsent(site,
  {consent?})`: an empty object deletes the key; otherwise replace.
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`. Call
  `applyConsent` next to `applyAdsTxtAndLegal`.
- Modify: `stripDefaultOverrideFields` in `config-normalizers.ts`, so an
  empty `consent` is stripped from overrides.
- Tests: `services/dashboard/src/lib/__tests__/consent-normalizer.test.ts`,
  `src/components/config/__tests__/ConsentSection.test.tsx`, and extend
  `site-config-updates.test.ts`.

**Interfaces (produces):**

```ts
// Partial: an omitted key means "inherit"
export type ConsentFormValue = Partial<{
  enabled: boolean;
  show_to: 'everyone' | 'countries';
  countries: string[];
  message: string;
  privacy_url: string;
}>;
export interface ConsentSectionProps {
  value: ConsentFormValue;
  onChange: (v: ConsentFormValue) => void;
  mode: 'org' | 'group' | 'override' | 'site';
}
```

**UI:**
- **Enabled:**
  - In `org` mode, a checkbox.
  - In other modes, a select with Inherit / On / Off. Inherit removes the
    key.
- **Show banner to:**
  - A select: Everyone / Only these countries, plus Inherit in non-org
    modes.
  - "Only these countries" shows a text input for comma-separated codes.
    On blur it upper-cases, dedupes and drops invalid codes.
  - If any `OPT_IN` code is missing from the list, show an amber warning:
    "EU/UK visitors outside this list won't see the banner and will be
    tracked without consent."
- **Message:** a textarea, with the default text as placeholder. Empty
  removes the key.
- **Privacy link:** placeholder `/privacy`. Empty removes the key.
- **Shared constants:** copy `OPT_IN_COUNTRIES` and
  `DEFAULT_CONSENT_MESSAGE` into a dashboard constant file
  `src/lib/consent-constants.ts`, with a comment pointing at the
  site-worker source. Dashboard code can't import site-worker.

- [ ] **Step 1: Write the failing tests.**
  - **`normalizeConsent`** drops unknown keys and invalid values.
  - **`ConsentSection` renders** heading "Cookie consent" in all 4 modes.
  - **In org mode, ticking Enabled** calls `onChange` with `{enabled:true}`.
  - **In site mode, picking Inherit** removes `enabled`.
  - **Choosing countries `fr, de`** gives `['FR','DE']` and shows the
    warning.
  - **`collectChangedSections`** includes `consent` when it changed.
  - **`applyConsent`:**
    - `{}` deletes the key.
    - `{enabled:false}` sets it.
- [ ] **Step 2: Run the tests and confirm they fail.** Run: `cd
  services/dashboard && pnpm vitest run <files>`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Then run `pnpm test`
  and `pnpm typecheck` in `services/dashboard` and confirm both pass.
- [ ] **Step 5: Commit.** Message: `feat(dashboard): cookie consent settings
  section at org, group, override and site level`.

### Task 7: Guide page, docs, full verification

**Files:**
- Create: `services/dashboard/public/guide/29-cookie-consent.md`. Cover:
  - what visitors see, by region;
  - each setting;
  - inheritance;
  - the EU ads trade-off;
  - testing on staging with `?consent_country=DE` / `US`;
  - resetting by clearing the `atl_consent` cookie.
- Modify: `services/dashboard/src/app/guide/page.tsx`. Register `{ slug:
  "29-cookie-consent", title: "Cookie Consent" }`.
- Modify: `CLAUDE.md`. Add a landmine line: consent is KV schema; the
  bootstrap is in the cached head; the country is read only in the island.
- Create: `docs/test-results/2026-10-29-cookie-consent.txt`

- [ ] **Step 1: Run every suite and save the output.** Run: `pnpm
  typecheck && pnpm test 2>&1 | tee
  docs/test-results/2026-10-29-cookie-consent.txt`. Expected: all green.
  Record the before/after test counts.
- [ ] **Step 2: Build the site worker.** Run: `cd packages/site-worker &&
  pnpm build`. Expected: success.
- [ ] **Step 3: Check it locally.** Run `pnpm dev:worker` with a local
  config that has consent enabled. Load `/?consent_country=DE` and
  `/?consent_country=US`, on a modern site and a Grid site. Record the
  results in the test-results file:
  - Is the banner present?
  - Is the pixel inert in DE and live in US?
  - Does the footer link work?
  - Does Accept activate the pixel?
- [ ] **Step 4: Commit.** Message: `docs: cookie consent guide page and
  test results`.

### Task 8: Ship and roll out (after the PR is merged)

1. **Open the PR.** It must say `Closes #<issue>`. Merge it to `main`, then
   `grid plug` (dashboard). Confirm the issue closed.
2. **Deploy the site worker to staging.** Run `pnpm deploy:staging`, then
   verify on a staging host:
   - `?consent_country=DE` shows the banner.
   - With consent not yet enabled in `org.yaml`, nothing changes.
3. **Deploy to production.** Run `pnpm deploy:production`, then confirm a
   few live sites are unchanged (consent is still off).
4. **Pilot.** Enable consent at site level on one modern live site, via the
   dashboard Config tab or a `site.yaml` edit plus sync. From a US
   connection confirm:
   - The island sees `US`: the footer link reads "Do not sell…".
   - The Meta pixel or GA fires without Accept.
   - The ads load.

   If the country is missing, stop and report.
5. **Switch on the network.** Commit `consent: { enabled: true }` to
   network `org.yaml` on `main`. Wait for `sync-kv` to finish, then remove
   the pilot's site-level duplicate if one was added as a direct edit.
6. **Spot-check 2–3 live sites** (modern + Grid).
