# Plan: Dismissable X Button for Sticky Ads

**Date:** 2026-04-20
**Project:** `/Users/michal/Documents/ATL-content-network/atomic-content-platform`
**Status:** Awaiting approval — no code changes yet

---

## Context

Published sites render a persistently-fixed ad at the bottom of every article and page — the `sticky-bottom` slot. It's injected in three layouts at roughly these lines:

- `packages/site-builder/src/layouts/ArticleLayout.astro:131-135` (+ CSS at `:231-239`)
- `packages/site-builder/src/layouts/PageLayout.astro:131-135`
- `packages/site-builder/src/layouts/ArticlePreviewLayout.astro` (equivalent)

It's filled at runtime by `packages/site-builder/public/ad-loader.js:90-125`. The container is `position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;` with a light background scrim — so it visually and spatially covers the bottom of the page (footer, end of article, newsletter form).

**Problem:** visitors have no way to dismiss it. It stays there for the entire visit, obscuring content.

**Intended outcome:** add a small, accessible X button to the sticky-bottom container. One click dismisses the sticky ad for the rest of the browser session (matches the existing interstitial pattern at `ad-loader.js:186-193`). Publishers can disable the X per-site via the monetization admin UI if they prefer a non-dismissable sticky.

---

## Decisions made (during this planning session)

| Decision | Choice | Reasoning |
|---|---|---|
| Dismiss persistence | Per session (`sessionStorage`) | Matches existing `_atl_int` interstitial pattern; balances UX and ad revenue. |
| Admin control | Toggle in `AdsConfigForm` — per-placement `dismissible` flag | Gives publishers control; consistent with config-driven pattern used throughout the dashboard. |
| Spec location | `docs/specs/` | Matches existing `docs/specs/FINAL-architecture-spec.md` and related specs already in the repo. |
| Scope | `sticky-bottom` only | The only slot that overlays content. `sidebar` and inline placements do not need dismiss controls. |

---

## Approach

### 1. Data model — `packages/shared-types/src/ads.ts`

Add an optional `dismissible?: boolean` field on `AdPlacement`. Defaults to `true` at render time when `position === 'sticky-bottom'`. Undefined/absent means "true" for backwards compatibility with existing configs.

### 2. Admin UI — `services/dashboard/src/components/settings/AdsConfigForm.tsx`

When a placement row has `position === 'sticky-bottom'`, render a new checkbox labeled **"Allow visitors to dismiss"** (default checked). Wire it to `placement.dismissible`. Do not render the checkbox for any other `position` value.

The existing live preview panel (`PlacementPreview.tsx`) should show a small `×` glyph at the top-right of the sticky-bottom mock when `dismissible !== false`, so publishers can see what visitors will see.

### 3. Runtime behavior — `packages/site-builder/public/ad-loader.js`

Inside the `sticky-bottom` branch of the placement loop (around `:111` in the current file):

1. If `sessionStorage.getItem('_atl_sticky_dismissed') === '1'`: set the container to `display: none` and `return` without injecting a slot. No CLS impact because the container already reserves `min-height: 50px`.
2. Otherwise, call `attachToSlot(anchor, slot)` as today.
3. If `placement.dismissible !== false`, append a close button element to the container after the slot is attached. Button is a real `<button type="button">` for keyboard/screen-reader support.
4. On click: `sessionStorage.setItem('_atl_sticky_dismissed', '1')`, set container `display: none`, dispatch a custom `atl:sticky-dismissed` event for analytics hooks (optional, future-friendly).

All logic stays in vanilla JS — no framework, same style as the existing `close` button at `:186-193`.

### 4. Styling — Astro layouts (3 files)

Add to the existing `.ad-sticky-bottom` CSS block in all three layouts:

```css
.ad-sticky-bottom { position: fixed; /* existing */ }
.ad-sticky-bottom .ad-close-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--color-text, #333);
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--color-text, #333);
  padding: 0;
}
.ad-sticky-bottom .ad-close-btn:focus-visible {
  outline: 2px solid var(--color-primary, #0066cc);
  outline-offset: 2px;
}
```

Hit target = 32×32 (meets WCAG 2.5.5 AAA minimum; AA only requires 24×24). Visible glyph is 16px `×`. Rounded pill so it reads as a dismiss, not a close-window chrome.

### 5. Accessibility

- `aria-label="Close advertisement"`
- `type="button"` (prevents form submission when embedded anywhere)
- Keyboard: focusable, activates on Enter/Space (default button behavior)
- Contrast: button background rgba(255,255,255,0.9) over scrim, dark glyph → passes WCAG AA for non-text UI
- Escape key: out of scope for v1 (the button itself is reachable via Tab)

### 6. Analytics hook (optional, recommended)

Dispatch `window.dispatchEvent(new CustomEvent('atl:sticky-dismissed'))` on click so publishers who wire up Plausible/GA4 can count dismissals without a second code change later.

---

## Files to modify

| File | Change |
|---|---|
| `packages/shared-types/src/ads.ts` | Add `dismissible?: boolean` to `AdPlacement` type |
| `services/dashboard/src/components/settings/AdsConfigForm.tsx` | Add "Allow visitors to dismiss" checkbox shown only when `position === 'sticky-bottom'` |
| `services/dashboard/src/components/shared/PlacementPreview.tsx` | Render mock × in sticky-bottom preview when dismissible |
| `packages/site-builder/public/ad-loader.js` | Inject close button, sessionStorage gate, hide-on-click |
| `packages/site-builder/src/layouts/ArticleLayout.astro` | Add `.ad-close-btn` CSS |
| `packages/site-builder/src/layouts/PageLayout.astro` | Add `.ad-close-btn` CSS |
| `packages/site-builder/src/layouts/ArticlePreviewLayout.astro` | Add `.ad-close-btn` CSS |

### New documents to create (only after approval)

| File | Purpose |
|---|---|
| `docs/specs/2026-04-20-sticky-ad-close-button-spec.md` | The spec below, saved as its own file |
| `docs/audit-logs/2026-04-20-HHMM-sticky-ad-close-button.md` | Dev-audit-trail log, created before any code is written |
| `docs/sessions/2026-04-20-sticky-ad-close-button.md` | Session summary, created at end of implementation |

Existing `docs/audit-logs/`, `docs/sessions/`, `docs/specs/`, `docs/plans/` stay untouched. No existing files are deleted.

---

## Spec content (to be saved at `docs/specs/2026-04-20-sticky-ad-close-button-spec.md`)

```markdown
# Spec: Dismissable Sticky Ad (Close Button)

**Date:** 2026-04-20
**Status:** Draft — pending implementation
**Related:** `docs/specs/FINAL-architecture-spec.md` (ad rendering, ad_placements)

## Goal

Let site visitors dismiss the `sticky-bottom` ad slot via an accessible X button.
Dismissal persists for the current browser session only. Publishers can disable the
X on a per-site basis via the monetization admin UI.

## Non-goals

- Dismiss for inline, sidebar, or homepage ads (they don't cover content).
- Cross-device persistence or login-based preferences.
- Dismiss-for-N-days / frequency capping.
- Analytics UI for dismissal rate (event is emitted; dashboard work is separate).

## User story

> As a visitor reading an article on a Cool News ATL site, the sticky ad at the
> bottom of my screen is covering the footer and the end of the article. I click
> the small × button at the top-right of that ad, and it disappears for the rest
> of my session. The next time I open the site in a new tab, it can come back.

## Functional requirements

1. **Close button renders** at top-right of the `.ad-sticky-bottom` container
   when ad-loader fills the slot AND `placement.dismissible !== false`.
2. **Clicking X** hides the container (`display: none`), writes
   `sessionStorage._atl_sticky_dismissed = '1'`, and dispatches
   `window` event `atl:sticky-dismissed`.
3. **On subsequent page loads in the same session**, if
   `sessionStorage._atl_sticky_dismissed === '1'`, the slot is NOT injected and
   the container is set to `display: none` before any ad request fires.
4. **New session** (new tab, new window-after-close, or cleared storage) resets
   the state — sticky ad shows again.
5. **Admin toggle**: publishers can set `dismissible = false` per-placement in
   `AdsConfigForm`. When false, the X does not render and visitors cannot dismiss.
6. **Default**: `dismissible` is `true` for all existing and new `sticky-bottom`
   placements. Undefined field treated as `true`.

## Non-functional requirements

- **Accessibility**: `aria-label="Close advertisement"`, real `<button type="button">`,
  keyboard-focusable, `:focus-visible` outline, 32×32 hit target.
- **Contrast**: close button meets WCAG 2.1 AA for non-text UI (3:1 against scrim).
- **No layout shift**: container already reserves `min-height: 50px`; button is
  `position: absolute` inside the container.
- **No framework dependency**: all runtime JS stays in `ad-loader.js` (vanilla).
- **Backwards compatible**: existing ad configs without `dismissible` behave as
  `dismissible: true`.

## Admin UI

In `AdsConfigForm.tsx`, each placement row already has position, device, desktop/mobile
sizes. Add one new row element that is conditionally rendered when
`placement.position === 'sticky-bottom'`:

> [ ] Allow visitors to dismiss this ad (×) — *If unchecked, the sticky ad stays
> until the user leaves the page.*

Checkbox binds to `placement.dismissible`, defaulting to `true` when the field is
absent on load.

The live preview at `PlacementPreview.tsx` shows a small × glyph on the sticky-bottom
mock when `dismissible !== false`, so publishers see the outcome before saving.

## Runtime contract

`ad-loader.js`, inside the per-placement iteration:

```js
} else if (p.position === 'sticky-bottom') {
  var st = document.querySelector('[data-slot="sticky-bottom"]');
  if (!st) return;
  if (sessionStorage.getItem('_atl_sticky_dismissed') === '1') {
    st.style.display = 'none';
    return;
  }
  attachToSlot(st, slot);
  if (p.dismissible !== false) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ad-close-btn';
    btn.setAttribute('aria-label', 'Close advertisement');
    btn.textContent = '×';
    btn.onclick = function () {
      sessionStorage.setItem('_atl_sticky_dismissed', '1');
      st.style.display = 'none';
      try { window.dispatchEvent(new CustomEvent('atl:sticky-dismissed')); } catch (e) {}
    };
    st.appendChild(btn);
  }
}
```

CSS lives in the Astro layouts' existing `<style>` blocks (ArticleLayout,
PageLayout, ArticlePreviewLayout) so the selector co-locates with `.ad-sticky-bottom`.

## Testing

**Local dev**:
- Run `npm run dev` in `packages/site-builder` (or whichever dev script the repo
  uses — see `CLAUDE.md`).
- Load an article page. Confirm X is visible at top-right of the sticky ad.
- Click X → ad disappears, `sessionStorage._atl_sticky_dismissed === '1'`.
- Navigate to another article in the same tab → sticky ad does not render.
- Open a new tab / incognito → sticky ad renders again.

**Admin**:
- Open `/settings/ads` (or wherever `AdsConfigForm` is mounted) for a test site.
- For the `sticky-bottom` placement, uncheck "Allow visitors to dismiss".
- Save. Reload the published preview. X is no longer visible; ad stays fixed.

**Accessibility**:
- Tab to the close button → visible focus outline.
- Press Enter → ad dismisses.
- VoiceOver (macOS) announces "Close advertisement, button".

**Regression**:
- `sidebar` and inline `after-paragraph-N` placements are unchanged — no X button,
  same render as today.
- Interstitial (`_atl_int`) still works independently — separate storage key.

**Post-deploy**:
- On staging-coolnews-atl.pages.dev, verify X appears on an article, clicks work,
  and the `atl:sticky-dismissed` event fires (observable via DevTools console
  `window.addEventListener('atl:sticky-dismissed', () => console.log('ok'))`).
```

---

## Implementer prompt (to pass to the coding session after approval)

```
Implement the dismissable sticky-ad X button per the spec at
docs/specs/2026-04-20-sticky-ad-close-button-spec.md.

Before touching any code, follow the dev-audit-trail skill:
- Read the last 2-3 files in docs/sessions/ for context
- Create docs/audit-logs/2026-04-20-HHMM-sticky-ad-close-button.md BEFORE editing code
- Populate pre-flight checks (tsc --noEmit, npm run lint)

Implementation steps (use TDD where a test surface exists; otherwise follow the
spec's Testing section):

1. packages/shared-types/src/ads.ts — add `dismissible?: boolean` to AdPlacement.
   Run tsc --noEmit; log result.

2. packages/site-builder/public/ad-loader.js — update the sticky-bottom branch
   per the "Runtime contract" code block in the spec. Preserve all other
   placement branches exactly as they are. Test by opening a preview page.

3. packages/site-builder/src/layouts/ArticleLayout.astro,
   packages/site-builder/src/layouts/PageLayout.astro,
   packages/site-builder/src/layouts/ArticlePreviewLayout.astro — add the
   `.ad-close-btn` CSS from the spec into each layout's existing <style> block,
   alongside the existing `.ad-sticky-bottom` rules.

4. services/dashboard/src/components/settings/AdsConfigForm.tsx — add a
   conditional checkbox labeled "Allow visitors to dismiss this ad (×)" that
   renders ONLY when `placement.position === 'sticky-bottom'`. Default checked
   when `placement.dismissible` is undefined. Write to `placement.dismissible`.

5. services/dashboard/src/components/shared/PlacementPreview.tsx — render a
   mock × glyph at the top-right of the sticky-bottom preview when
   `dismissible !== false`.

Rules:
- Do NOT refactor unrelated code.
- Do NOT add feature flags, migration shims, or backwards-compat beyond what the
  spec defines (undefined = true).
- Run tsc --noEmit after EVERY file change and log pass/fail in the audit log.
- Functionally test on a real dev server before marking the task complete — do
  not claim success based on compilation alone.
- At end of session: update CLAUDE.md if the ad architecture section needs it,
  sync docs/backlog/general.md (create if missing), and write
  docs/sessions/2026-04-20-sticky-ad-close-button.md with learning notes.
- Do NOT delete any existing files in docs/.
```

---

## Code-review prompt (to run via /code-review:code-review after implementation)

```
Review the changes for docs/specs/2026-04-20-sticky-ad-close-button-spec.md.

Focus areas:

1. Correctness of the sessionStorage gate — does it run BEFORE attachToSlot to
   avoid a wasted ad request when dismissed? Does it handle the case where
   sessionStorage is unavailable (private browsing edge cases)?

2. Accessibility of the close button:
   - Is it a real <button type="button">?
   - aria-label present and meaningful?
   - Focus-visible outline?
   - Hit target ≥24×24?
   - Does the × glyph use a proper Unicode × (U+00D7) not 'x'?

3. Backwards compatibility:
   - Existing AdPlacement configs without `dismissible` still behave correctly
     (treated as true, so X renders).
   - No type errors in shared-types consumers.

4. Admin UI:
   - Checkbox only renders for sticky-bottom placements — never for sidebar,
     inline, or homepage slots.
   - Default state is "checked" when field is absent.
   - Save-then-reload round-trips the value correctly (no lost writes).

5. CSS scoping:
   - .ad-close-btn selector only matches inside .ad-sticky-bottom, not
     leaking into other ad containers.
   - Z-index high enough to sit above the ad iframe.

6. Event emission:
   - atl:sticky-dismissed dispatched on click.
   - Wrapped in try/catch so CustomEvent polyfill gaps don't break dismissal.

7. No unrelated refactors or style churn in the diff.

Flag anything that diverges from the spec or breaks existing placements.
Report in the standard /code-review format.
```

---

## QA prompt (after code-review fixes are merged in)

```
QA the sticky-ad dismiss feature end-to-end before marking it shippable.

Setup:
- Pull the latest branch.
- Run the site-builder preview server (see CLAUDE.md for the exact command).
- Have a test site config with a sticky-bottom placement that has device: all
  and default dismissible (not set).

Test matrix:

A. Default behavior (dismissible = undefined)
   1. Load an article page. X visible at top-right of sticky ad.  ✅/❌
   2. Tab through the page — focus lands on the X with a visible outline.  ✅/❌
   3. Press Enter on the X — sticky ad disappears.  ✅/❌
   4. sessionStorage._atl_sticky_dismissed === '1' in DevTools.  ✅/❌
   5. Navigate to another article (same tab) — no sticky ad.  ✅/❌
   6. Open a new incognito window — sticky ad is back.  ✅/❌

B. Admin toggle off
   1. In AdsConfigForm, uncheck "Allow visitors to dismiss" on the sticky-bottom
      placement. Save.  ✅/❌
   2. Reload the preview page — sticky ad renders without X.  ✅/❌
   3. Re-check the box. Save. Reload. X is back.  ✅/❌

C. Admin UI correctness
   1. Sidebar placement — no "Allow dismiss" checkbox visible.  ✅/❌
   2. after-paragraph-3 placement — no checkbox visible.  ✅/❌
   3. Only sticky-bottom shows it.  ✅/❌

D. Accessibility
   1. macOS VoiceOver: focusing the X announces "Close advertisement, button".  ✅/❌
   2. Lighthouse a11y score on an article page ≥ 95.  ✅/❌
   3. Color contrast of X glyph ≥ 3:1 against sticky background.  ✅/❌

E. Regression
   1. Interstitial ads still dismiss via their own Close button.  ✅/❌
   2. sessionStorage._atl_int and _atl_sticky_dismissed are independent.  ✅/❌
   3. Sidebar and inline ads render unchanged.  ✅/❌
   4. No console errors on load or dismiss.  ✅/❌

F. Mobile (Chrome DevTools device emulation, 390×844)
   1. X is tappable (≥32×32 hit area).  ✅/❌
   2. X doesn't overlap the ad image or text.  ✅/❌
   3. Dismissal works on mobile viewport.  ✅/❌

Report every failure with a screenshot or console snippet. Do not pass QA until
every row is ✅.
```

---

## Verification plan (end-to-end, for the user to run)

After implementation + code-review + QA pass:

1. `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform`
2. Run the site-builder preview (exact command in `CLAUDE.md` — typically
   `npm run dev` in `packages/site-builder`).
3. Load an article, confirm X appears, click it, confirm ad disappears and stays
   gone on next navigation in the same tab.
4. Close the tab, reopen — ad returns.
5. Open `services/dashboard` locally, go to a site's Monetization settings,
   toggle "Allow visitors to dismiss" off, save, reload the article — ad is back
   with no X.
6. Deploy to staging (`staging-coolnews-atl.pages.dev`) and repeat steps 3–5 on
   a real article URL.
7. Check browser console for `atl:sticky-dismissed` event when dismissing.

---

## Out of scope (deliberately)

- Dismiss analytics dashboard — event is emitted; surfacing it in the ops
  dashboard is a separate ticket.
- Frequency capping ("show again tomorrow").
- Animation on dismiss (fade/slide). Simple `display: none` for v1.
- A second close button for the `sidebar-sticky` variant — no such slot exists
  in the current codebase despite the preview label; sidebar placements don't
  overlay content.
- Mobile-specific X styling beyond the shared 32×32 touch target.
