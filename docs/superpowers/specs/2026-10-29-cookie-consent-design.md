# Cookie Consent Banner — Design

**Date:** 2026-10-29
**Status:** Draft for approval
**Owner:** Asaf (decisions) · Claude (build)

## Intent and the why

None of our sites ask for cookie consent today. GA4, GTM, the Meta pixel and
any custom tracking load for every visitor the moment a page opens. We want a
simple cookie-consent banner on every site, current and future, managed from
the dashboard like any other config.

We are building our own banner instead of using a third-party consent manager
(Cookiebot, InMobi, CookieYes). Asaf's reasons: we keep full control and a
native look, and EU traffic is currently too small to justify the cost or
setup of a certified tool.

**Accepted trade-off (Asaf, explicit):** our banner is not an IAB TCF
certified consent manager, so it cannot pass a "yes" to ad partners in the
format they recognise. EU/UK visitors therefore get non-personalised or
limited ads whether they accept or reject. Visitors outside the EU are not
affected. If EU traffic grows, a certified tool can be added for EU visitors
only later; this design must not block that.

## Goals

1. Every site shows a consent banner. Which visitors see it is a setting:
   **everyone** (default) or **only listed countries**.
2. Behaviour by region:
   - **Opt-in region** (EU 27 + Iceland, Liechtenstein, Norway, UK,
     Switzerland, and *unknown country*): tracking waits for Accept.
   - **Everywhere else:** tracking runs by default, and the banner lets the
     visitor Reject.
3. On Reject, or before an answer in an opt-in region, do what Cookiebot does:
   - **Tracking off:** the Meta pixel and `tracking.custom` scripts don't run.
   - **Google stays cookie-free:** GA4, Google Ads and GTM load with Google
     Consent Mode v2 set to "denied", so they send cookieless pings only.
   - **Ads keep running:** ad partner scripts (`scripts.*`, the interstitial
     loader, ad slots) are never blocked.
4. The settings live in a new `consent` config block with normal inheritance:
   org → groups → overrides → site. The dashboard edits it at org, group,
   override and site level, and new sites inherit it automatically.
5. Visitors can change their mind via a footer link on every page.

## Non-goals

- IAB TCF / GPP strings, certification, or any third-party consent manager.
- Translations. The banner is in English only.
- Cookie scanning or auto-discovery of scripts.
- Storing proof of consent server-side (no consent log).
- Blocking ad partner scripts. We knowingly keep ads running in every region.
- Pages served by other workers (`QUERY_HANDLER` on `?x=1`,
  `ATL_STREAMED_LANDER` on `?agi=1011`). They don't render our layouts, so
  they get no banner. *(Claude's call: those workers aren't in this repo.)*
- A per-site "which script is analytics vs marketing" editor. The
  categories are fixed (see below).

## Anti-goals (failure even if it "works")

- **Any live site 404s or breaks** because a KV config lacks `consent`. This
  has happened before (2026-05-20, see CLAUDE.md "KV Schema Evolution").
- **Ad revenue drops outside the EU** because the banner blocks or delays
  ads, or US tracking defaults to off.
- **Visible layout shift or a full-screen wall over the content and ads.**
- **The wrong banner served from cache.** Article and home pages are
  edge-cached (`s-maxage` 60–300 s), so anything that depends on the
  visitor's country or cookie must never be baked into cached HTML.
- **Accept and Reject with unequal prominence** (EU rules require equal).

## Constraints (from the codebase)

- **Pages are edge-cached; server islands are not.**
  `/_server-islands/*` is `private, no-store` (`src/middleware.ts`).
  `PixelLoader.astro` is already a server island (`server:defer`) and already
  renders all tracking (GA4, Google Ads, GTM, Meta pixel, `tracking.custom`).
  So country- and cookie-dependent decisions belong in the island. Cached
  HTML may only contain things that are the same for every visitor, such as
  the footer link, which depends only on `consent.enabled`.
- **Production traffic** reaches the site worker through
  `atl-sites-workers-manager` via a Service Binding. The visitor's country
  must survive that hop. Read `request.cf.country` first, then the
  `cf-ipcountry` header. If neither is present, treat the country as unknown,
  which means opt-in (fail safe). The builder must verify on staging that
  the country is actually available inside the island.
- **KV schema evolution (3 mandatory steps)** applies to the new
  `ResolvedConfig.consent` field:
  1. A runtime default in `packages/site-worker/src/lib/config.ts`
     (`getConfig`, `??=`).
  2. A seed-time default in `scripts/seed-kv.ts`.
  3. A re-seed of all sites before the feature is switched on.
- **`sync-kv.yml`** (network repo) checks out the platform repo's default
  branch (`main`) to run `seed:kv`. The seed-time default only exists in CI
  after this PR is merged.
- **Every dashboard config page** (org settings, group, override new/edit,
  site Config tab) builds a `formConfig` object for `UnifiedConfigForm`.
  - Org and group pages PUT their whole config.
  - The site Config tab sends only changed sections (`SAVED_SECTIONS` in
    `src/lib/site-config-updates.ts`) to `/api/sites/save`, which merges
    into a config read from Mongo.
  - Normalizers live only in `src/lib/config-normalizers.ts`.
- **The Grid template** (`theme.template: grid`) has its own layout
  (`GridLayout.astro`, which also uses `PixelLoader`) and its own footer
  (`GridFooter.astro`). The modern template uses
  `themes/modern/components/Footer.astro`. Both need the footer link.
- Every site already has a `/privacy` page, so the default privacy link is
  `/privacy`.
- User-visible features need an in-app guide page in
  `services/dashboard/public/guide/`, registered in `GUIDE_PAGES`.

## What Asaf decided

- Build our own banner (option 1). No third-party consent manager.
- Who sees it is a dashboard setting: "Everyone" or "Only these countries".
  The default is **Everyone**.
- Opt-in in the EU/UK. Elsewhere, tracking is on by default and visitors can
  Reject (the "notice" style).
- On Reject: block tracking, keep Google in denied mode, keep ads running
  (the Cookiebot behaviour).
- GTM containers contain only Google tags, so Consent Mode alone is enough
  for GTM.

## Design

### Config: the `consent` block

```yaml
# org.yaml / groups/<id>.yaml / overrides/config/<id>.yaml / sites/<d>/site.yaml
consent:
  enabled: true              # master switch
  show_to: everyone          # everyone | countries
  countries: [DE, FR, GB]    # ISO-3166 alpha-2; only used when show_to = countries
  message: "We use cookies…" # optional; code default used when empty
  privacy_url: /privacy      # optional; default /privacy
```

- **Shared types:**
  - Add `ConsentConfig` to `packages/shared-types`.
  - Add `consent?: Partial<ConsentConfig>` to `OrgConfig`, `GroupConfig` and
    `SiteConfig`.
  - Add a required `consent: ResolvedConsentConfig` (all fields filled in)
    to `ResolvedConfig`.
- **Merge rules:** the existing generic `deepMerge`. Objects merge per key,
  and a later layer wins. Arrays (`countries`) are replaced by the last layer
  that sets them. No merge modes for this block.
- **Defaults** (`CONSENT_DEFAULTS`, used at seed time and at runtime):
  `enabled: false`, `show_to: "everyone"`, `countries: []`, `message: ""`,
  `privacy_url: "/privacy"`. The code default is **off** on purpose: an old
  KV entry or a missing block must change nothing. The feature is switched on
  for the network by adding `consent: { enabled: true }` to `org.yaml` as the
  last rollout step.
- **The opt-in country list is a code constant**, not a setting. It's a legal
  fact, not a business choice, and it keeps the dashboard simple.

### Runtime: decision logic (pure, unit-tested)

A new `packages/site-worker/src/lib/consent.ts` exposes pure functions. In
outline:

- `regionFor(country) → "opt_in" | "notice"`. Returns `opt_in` for the
  constant list and for unknown or empty countries.
- `parseConsentCookie(value) → { analytics, marketing } | null`.
- `decideConsent({ consent, country, cookie }) → { showBanner,
  analyticsAllowed, marketingAllowed, region }`. The rules:
  1. **If `enabled` is false:** no banner, everything allowed. Today's
     behaviour, byte-for-byte.
  2. **If a stored choice exists:** use it, and show no banner.
  3. **If there's no stored choice:**
     - Banner shown when `show_to = everyone`, or when the country is in
       `countries`.
     - Default permissions:
       - `opt_in` region → analytics and marketing denied.
       - `notice` region → both allowed.
  4. **Opt-in region not covered by `countries`** (`show_to = countries` and
     the country is missing from the list): no banner, everything allowed.
     That is the admin's explicit choice. The dashboard shows a warning when
     the list leaves out opt-in countries.

**Cookie:** `atl_consent`, first-party, `Path=/`, `SameSite=Lax`, 180 days.
- Value format: `v1.<a>.<m>`, where `a` and `m` are `0` or `1`.
- Set in the browser by the consent script. The island reads it from the
  request.

**Global Privacy Control** *(Claude's call)*: in a `notice` region, if there's
no stored choice and `navigator.globalPrivacyControl === true`, treat the
visitor as having rejected marketing. The California opt-out laws expect
this.

### Runtime: Consent Mode default in the cached `<head>` *(Claude's call, from the builder check)*

Google ad scripts in `scripts.head`, such as AdSense on hypezen, run from the
cached HTML before the deferred island loads. So the island is too late to
set Google's consent default. Instead, `BaseLayout.astro` and
`GridLayout.astro` render a small **static** inline bootstrap at the top of
`<head>`, before `scripts.head`.

The bootstrap renders only when `consent.enabled` is true, which keeps it
cache-safe. It contains nothing that depends on the visitor:
1. **Define** the `dataLayer` and `gtag` shim.
2. **Read** the `atl_consent` cookie in the browser.
3. **If there's a stored choice:** call `gtag('consent','default', …)` with
   that choice.
4. **Otherwise**, set two defaults:
   - denied for all four keys, scoped with `region: [<opt-in country
     list>]`;
   - granted globally.

   Google applies the region scoping itself, so no server country is
   needed for Google tags. If `navigator.globalPrivacyControl` is true, the
   global default sets the `ad_*` keys to denied.

Key mapping: analytics → `analytics_storage`; marketing → `ad_storage`,
`ad_user_data` and `ad_personalization`. The opt-in list comes from the same
code constant used by `consent.ts`.

### Runtime: what the island renders (`PixelLoader.astro`)

- **When `enabled` is false:** identical output to today. A regression test
  must prove it.
- **When `enabled` is true:**
  1. **No consent default in the island.** The head bootstrap already set
     it. The island must not redefine `dataLayer`; today's snippet uses
     `window.dataLayer = window.dataLayer || []`, which is safe.
  2. **GA4, Google Ads and GTM:** rendered exactly as today. They are never
     withheld, because Consent Mode governs them.
  3. **Meta pixel and `tracking.custom`** count as *marketing*. When
     marketing is allowed they render as today. Otherwise they render
     inert:
     - Inline scripts: `<script type="text/plain"
       data-atl-consent="marketing">`.
     - `custom` HTML: kept in a `<template data-atl-consent="marketing">`.
     - The consent script activates them when the visitor accepts marketing
       on that page.
  4. **The consent script plus a JSON config** (region, current decision,
     message, privacy URL, show-banner flag). Delivered inline from the
     island so it's always fresh. Keep it small; it doesn't need a
     framework.
  5. **The banner markup**, only when `showBanner` is true.

**Consent script behaviour (browser):**
- **Accept:** set the cookie to `v1.1.1`, call
  `gtag('consent','update', all granted)`, activate inert marketing scripts,
  and hide the banner.
- **Reject:** set the cookie to `v1.0.0`, call `gtag('consent','update', all
  denied)`. If the Meta pixel already ran this page (notice region), call
  `fbq('consent','revoke')`. Hide the banner. Later pages render with
  marketing withheld, because the island reads the cookie.
- **Settings:** open a small panel with two switches, Analytics and
  Marketing. They start from the current decision. **Save** stores
  `v1.<a>.<m>` and applies the same updates as above.
- **Footer link:** clicking `[data-atl-consent-open]` opens the panel at any
  time, including when the banner isn't shown.
  - For visitors in the US (`country === "US"`), relabel the link to "Do not
    sell or share my personal information" and open the panel straight away.
    Turning Marketing off there is the opt-out.
  - Everyone else sees "Cookie settings".

### Banner UI *(Claude's calls unless noted)*

- **Placement:** a fixed bar at the bottom of the viewport. It isn't
  full-screen, has no backdrop, and doesn't block scrolling. On mobile it's
  a compact stacked layout.
- **It must not cover a `sticky-bottom` ad.** When a sticky-bottom ad slot is
  present, the banner sits above it. The builder decides how, for example by
  measuring the slot or using a CSS variable offset.
- **Layout:**
  - The message (default: "We use cookies to measure traffic and improve your
    experience. You can accept, reject, or choose in Settings.") followed by
    a "Privacy Policy" link to `privacy_url`.
  - Buttons: **Accept**, **Reject**, **Settings**. Accept and Reject have
    equal size and weight.
- **Styling:**
  - Uses the site theme's CSS variables (`--color-*`, plus the foreground
    variables from `themeForegroundVars`). Must work on both the modern and
    Grid templates and in light and dark palettes.
  - All CSS is scoped under one root class, so it can't leak into or be
    broken by site CSS.
- **Accessibility:**
  - `role="region"` with an `aria-label`, real `<button>` elements,
    keyboard-operable, and a visible focus style.
  - No focus trap, because it isn't modal.
  - Escape closes the Settings panel, not the banner.
- **Display:** no animation needed. It mustn't flash for visitors who
  already chose, which is natural because the island doesn't render it for
  them.

### Footer link

- `Footer.astro` (modern) and `GridFooter.astro` (Grid) show the link when
  `config.consent.enabled`: `<button type="button" data-atl-consent-open>Cookie
  settings</button>`.
- This doesn't vary by country, so it's safe in cached HTML. The island
  script relabels it for US visitors.
- Style it like the neighbouring footer links.

### Staging / testing aid *(Claude's call)*

Country can't be faked on real traffic. On staging and preview hosts only
(not production), a `?consent_country=XX` page parameter:
- is stored in a session cookie by middleware (the same pattern as
  `?mockads`), and
- is read by the island as the country.

`?consent_country=` with no value clears it.

### Dashboard

- **New "Cookie consent" section in `UnifiedConfigForm`, in all 4 modes:**
  - An **Enabled** switch.
  - **Show banner to:** a radio with "Everyone" / "Only these countries".
    The second option reveals a country-code input (comma-separated ISO
    codes, upper-cased and deduplicated, invalid codes rejected).
  - **Banner message:** a textarea, with the default text as placeholder.
  - **Privacy policy link:** placeholder `/privacy`.
  - A warning when "Only these countries" leaves out any opt-in country.
- **Inheritance:** at group, override and site level, an untouched section
  means "inherit". The site Config tab already sends only changed sections.
  For the Enabled switch in non-org modes, show the inherited value and an
  "Inherited from org/group" hint. The builder picks the simplest correct
  control (e.g. tri-state Inherit / On / Off).
- **Wiring:**
  - Add `consent` to `UnifiedConfigFields`.
  - Add a `normalizeConsent` to `config-normalizers.ts`.
  - Map it in every `formConfig` builder: `settings/page.tsx`,
    `groups/[groupId]/page.tsx`, `overrides/new/page.tsx`,
    `overrides/[id]/page.tsx` and `SiteConfigTab.tsx`.
  - Add `consent` to `SAVED_SECTIONS`.
  - Make sure `/api/sites/save` persists it and dual-writes Mongo, like
    other sections.
  - Group and override pages must write `consent` back to their YAML.
  - The group, override and org save flows are already followed by the
    "Sync now" modal. Nothing new there.
- **Guide page:** `public/guide/cookie-consent.md`. It covers what the
  banner does in each region, the settings, the EU ads trade-off, and how to
  test with `?consent_country=`. Register it in `GUIDE_PAGES`.

### Error handling

- **Missing `consent` in KV:** the runtime default sets it to off, and the
  site behaves as today.
- **Country unavailable:** treated as unknown, which means opt-in.
- **Malformed cookie:** treated as no stored choice.
- **Invalid config values** (e.g. `show_to: banana`, a non-array
  `countries`): normalised at seed time to defaults. The seed must not throw
  on them; it logs a warning.
- **Consent script errors** must never break the page or the ads. Wrap them
  defensively; ads don't depend on them.

## Test plan

**Site worker (vitest):**
- `consent.ts` covers every branch of `decideConsent`:
  - disabled.
  - stored accept, stored reject, stored partial.
  - opt-in and notice with no choice.
  - `show_to = countries`, with the country listed and not listed.
  - unknown country.
  - malformed cookie.
- Cookie parse and format round-trip.
- The seed resolves `consent`:
  - org-only, group override, site override.
  - arrays replaced.
  - absent → defaults.
  - invalid → defaults with a warning.
- `getConfig` backfills `consent` on a config without it.
- **Island output** (test whatever pure builder function produces the
  script strings):
  - disabled → identical to today's output.
  - opt-in with no choice → Meta pixel inert, banner present.
  - notice with no choice → pixel active, banner present.
  - stored reject → pixel inert, no banner.
- **Head bootstrap:** absent when consent is disabled. When enabled, it
  contains no visitor-specific data, sets the region-scoped denied default
  plus the global granted default, and applies a stored cookie choice
  (jsdom).
- The consent-script DOM behaviour, in jsdom: Accept, Reject and Settings
  set the cookie, call `gtag('consent','update', …)`, and activate inert
  scripts on Accept.

**Dashboard (vitest + RTL):**
- The section renders in all 4 modes, edits the values, and shows the
  opt-in warning.
- `normalizeConsent`.
- `collectChangedSections` includes `consent`.
- The save route persists `consent`.

**Manual on staging** (screenshots or notes in `docs/test-results/`):
- modern and Grid templates.
- `?consent_country=DE` and `?consent_country=US`.
- A real country read on staging (the Service Binding check).
- With and without a sticky-bottom ad.

## Rollout

1. **Merge and deploy the dashboard.** Merge the PR to `main` (the seed
   default becomes active in CI), then `grid plug`.
2. **Deploy the site worker to staging, then to production.** The runtime
   default is off, so this changes nothing yet.
3. **Pilot one production site first** *(Claude's call, from the builder
   check)*. Staging is served directly on `*.workers.dev`, so it never goes
   through `atl-sites-workers-manager`. Only production proves the country
   survives that hop.
   - Enable `consent` at site level on one modern site, e.g. via the site
     Config tab.
   - Load it from a US connection.
   - Confirm the island sees `US`: the footer link reads "Do not sell…" and
     the Meta pixel fires without Accept.
   - **If the country is missing**, every visitor counts as opt-in and US
     tracking would default to off. Stop here and forward the country
     (`cf-ipcountry`) through the manager worker before going further.
4. **Turn it on for the network.** Commit `consent: { enabled: true }` to
   `org.yaml` on network `main`. `sync-kv` re-seeds every site to production
   KV, which takes roughly an hour for 70+ sites. Then sync the staging
   previews from the "Sync now" modal or the dashboard.
5. **Verify on 2–3 live sites (modern + Grid):**
   - The EU banner via a VPN or a staging check.
   - US default tracking still fires.
   - Ads load in every case.

## Left to the builder

- The exact module split, cookie-helper names and script size budget.
- How the banner avoids the sticky-bottom ad.
- The visual details within the theme variables.
- The Enabled control's exact form in non-org modes.
- How the consent script is tested in jsdom.
