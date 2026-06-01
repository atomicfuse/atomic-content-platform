# Spec: Dismissable Sticky Ad (Close Button)

**Date:** 2026-04-20
**Status:** Draft — pending implementation
**Related:** `docs/specs/FINAL-architecture-spec.md` (ad rendering, ad_placements)
**Plan:** `/Users/michal/.claude/plans/users-michal-documents-atl-content-netwo-sunny-sunrise.md` (It's also here: `/Users/michal/Documents/ATL-content-network/atomic-content-platform/docs/plans/users-michal-documents-atl-content-netwo-sunny-sunrise.md`)

---

## Goal

Let site visitors dismiss the `sticky-bottom` ad slot via an accessible × button. Dismissal persists for the current browser session only. Publishers can disable the × on a per-site basis via the monetization admin UI.

## Problem

The `sticky-bottom` ad is rendered in three Astro layouts with `position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;`. It overlays the footer, end-of-article content, and newsletter signup. Visitors have no way to dismiss it. This spec adds a user-dismissable × button with session-scoped persistence and a per-placement admin toggle.

## Non-goals

- Dismiss for inline, sidebar, or homepage ads (they do not overlay content).
- Cross-device persistence or login-based preferences.
- Dismiss-for-N-days / frequency capping.
- Analytics UI for dismissal rate (event is emitted; dashboard work is separate).

## User story

> As a visitor reading an article on a Cool News ATL site, the sticky ad at the bottom of my screen is covering the footer and the end of the article. I click the small × button at the top-right of that ad, and it disappears for the rest of my session. The next time I open the site in a new tab, it can come back.

---

## Functional requirements

1. **Close button renders** at top-right of the `.ad-sticky-bottom` container when ad-loader fills the slot AND `placement.dismissible !== false`.
2. **Clicking ×** hides the container (`display: none`), writes `sessionStorage._atl_sticky_dismissed = '1'`, and dispatches `window` event `atl:sticky-dismissed`.
3. **On subsequent page loads in the same session**, if `sessionStorage._atl_sticky_dismissed === '1'`, the slot is NOT injected and the container is set to `display: none` before any ad request fires.
4. **New session** (new tab, new window after close, or cleared storage) resets the state — sticky ad shows again.
5. **Admin toggle**: publishers can set `dismissible = false` per-placement in `AdsConfigForm`. When false, the × does not render and visitors cannot dismiss.
6. **Default**: `dismissible` is `true` for all existing and new `sticky-bottom` placements. Undefined field is treated as `true`.

## Non-functional requirements

- **Accessibility**: `aria-label="Close advertisement"`, real `<button type="button">`, keyboard-focusable, `:focus-visible` outline, 32×32 hit target.
- **Contrast**: close button meets WCAG 2.1 AA for non-text UI (3:1 against scrim).
- **No layout shift**: container already reserves `min-height: 50px`; button is `position: absolute` inside the container.
- **No framework dependency**: all runtime JS stays in `ad-loader.js` (vanilla).
- **Backwards compatible**: existing ad configs without `dismissible` behave as `dismissible: true`.

---

## Data model

`packages/shared-types/src/ads.ts` — add to the existing `AdPlacement` interface:

```ts
dismissible?: boolean; // Only meaningful when position === 'sticky-bottom'. Default: true.
```

## Admin UI

In `services/dashboard/src/components/settings/AdsConfigForm.tsx`, for each placement row where `placement.position === 'sticky-bottom'`, render one new checkbox:

> ☑ Allow visitors to dismiss this ad (×)
> *If unchecked, the sticky ad stays until the user leaves the page.*

- Default checked when `placement.dismissible === undefined || placement.dismissible === true`.
- Binds to `placement.dismissible`.
- Not rendered for any other `position` value.

In `services/dashboard/src/components/shared/PlacementPreview.tsx`, render a small × glyph at the top-right of the sticky-bottom mock when `dismissible !== false`.

## Runtime contract

In `packages/site-builder/public/ad-loader.js`, inside the per-placement iteration (replacing the current `sticky-bottom` branch near line 111):

```js
} else if (p.position === 'sticky-bottom') {
  var st = document.querySelector('[data-slot="sticky-bottom"]');
  if (!st) return;
  var dismissed = false;
  try { dismissed = sessionStorage.getItem('_atl_sticky_dismissed') === '1'; } catch (e) {}
  if (dismissed) {
    st.style.display = 'none';
    return;
  }
  attachToSlot(st, slot);
  if (p.dismissible !== false) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ad-close-btn';
    btn.setAttribute('aria-label', 'Close advertisement');
    btn.textContent = '\u00D7'; // U+00D7 MULTIPLICATION SIGN
    btn.onclick = function () {
      try { sessionStorage.setItem('_atl_sticky_dismissed', '1'); } catch (e) {}
      st.style.display = 'none';
      try { window.dispatchEvent(new CustomEvent('atl:sticky-dismissed')); } catch (e) {}
    };
    st.appendChild(btn);
  }
}
```

All other placement branches (`above-content`, `after-paragraph-*`, `below-content`, `sidebar`, `homepage-top`, `homepage-mid`, `category-top`) are unchanged.

## Styling

Add to the existing `.ad-sticky-bottom` CSS block in:

- `packages/site-builder/src/layouts/ArticleLayout.astro`
- `packages/site-builder/src/layouts/PageLayout.astro`
- `packages/site-builder/src/layouts/ArticlePreviewLayout.astro`

```css
.ad-sticky-bottom .ad-close-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--color-text, #333);
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--color-text, #333);
  padding: 0;
  z-index: 101; /* one above the .ad-sticky-bottom container */
}
.ad-sticky-bottom .ad-close-btn:focus-visible {
  outline: 2px solid var(--color-primary, #0066cc);
  outline-offset: 2px;
}
```

Hit target = 32×32 (WCAG 2.5.5 AAA; AA requires only 24×24). Visible glyph = 16px `×`. Rounded pill so it reads as a content dismiss, not window chrome.

---

## Testing

### Local dev

- Run the site-builder dev server (see `CLAUDE.md`).
- Load an article page. Confirm × is visible at top-right of the sticky ad.
- Click × → ad disappears; `sessionStorage._atl_sticky_dismissed === '1'`.
- Navigate to another article in the same tab → sticky ad does not render.
- Open a new incognito window → sticky ad renders again.

### Admin

- Open the site's Monetization / Ads settings in the dashboard.
- For the `sticky-bottom` placement, uncheck "Allow visitors to dismiss".
- Save. Reload the published preview. × is no longer visible; ad stays fixed.

### Accessibility

- Tab to the close button → visible focus outline.
- Press Enter → ad dismisses.
- macOS VoiceOver announces "Close advertisement, button".
- Lighthouse a11y score on an article page ≥ 95.

### Regression

- `sidebar` and `after-paragraph-N` placements are unchanged — no × button.
- Interstitial (`_atl_int`) still works independently — separate storage key, separate DOM path.
- Fresh session storage → sticky ad renders on first load.

### Post-deploy

- On `staging-coolnews-atl.pages.dev`, verify × appears on an article, clicks work, and the `atl:sticky-dismissed` event fires. In DevTools console:

  ```js
  window.addEventListener('atl:sticky-dismissed', () => console.log('dismissed'));
  ```

  Then click ×. Expect `dismissed` to log.

---

## Files touched

| File | Change |
|---|---|
| `packages/shared-types/src/ads.ts` | Add `dismissible?: boolean` to `AdPlacement` |
| `services/dashboard/src/components/settings/AdsConfigForm.tsx` | Conditional "Allow visitors to dismiss" checkbox |
| `services/dashboard/src/components/shared/PlacementPreview.tsx` | Mock × glyph in sticky-bottom preview |
| `packages/site-builder/public/ad-loader.js` | sessionStorage gate + × button injection |
| `packages/site-builder/src/layouts/ArticleLayout.astro` | `.ad-close-btn` CSS |
| `packages/site-builder/src/layouts/PageLayout.astro` | `.ad-close-btn` CSS |
| `packages/site-builder/src/layouts/ArticlePreviewLayout.astro` | `.ad-close-btn` CSS |

## Out of scope

- Dismiss analytics dashboard — event is emitted; surfacing it is a separate ticket.
- Frequency capping ("show again tomorrow").
- Animation on dismiss (fade/slide). Simple `display: none` for v1.
- `sidebar-sticky` close button — no such slot exists in code; sidebar placements do not overlay content.
- Per-device (mobile vs desktop) X styling beyond shared 32×32 touch target.
