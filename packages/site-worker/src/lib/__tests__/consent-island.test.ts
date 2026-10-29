// @vitest-environment jsdom
// @vitest-environment-options {"runScripts":"dangerously"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderConsentUi, inertScript, inertHtml } from '../consent-scripts';
import { CONSENT_DEFAULTS, decideConsent } from '../consent';
import type { ResolvedConsentConfig } from '@atomic-platform/shared-types';

type Win = Window & { gtag?: unknown; fbq?: unknown };

const consent = (over: Partial<ResolvedConsentConfig> = {}): ResolvedConsentConfig => ({
  ...CONSENT_DEFAULTS, enabled: true, ...over,
});

/** Mounts the island output (plus optional extra page HTML) and runs its inline script. */
function mount(opts: { country: string | null; cfg?: Partial<ResolvedConsentConfig>; extra?: string }): void {
  const c = consent(opts.cfg);
  const decision = decideConsent({ consent: c, country: opts.country, cookie: null });
  const html = renderConsentUi({ consent: c, decision, country: opts.country });
  document.body.innerHTML = (opts.extra ?? '') + html;
  // Inline <script> in innerHTML doesn't run — execute the client script the way a browser would.
  const script = document.querySelector('script[data-atl-consent-client]');
  // eslint-disable-next-line no-new-func
  new Function(script?.textContent ?? '')();
}

const click = (sel: string): void => {
  (document.querySelector(sel) as HTMLElement).click();
};
const ran = (): string | null => document.body.getAttribute('data-ran');
const RUN_JS = 'document.body.setAttribute("data-ran", String(Number(document.body.getAttribute("data-ran")||0)+1))';

function clearCookies(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

let gtag: ReturnType<typeof vi.fn>;
let fbq: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearCookies();
  document.body.removeAttribute('data-ran');
  gtag = vi.fn();
  fbq = vi.fn();
  (window as Win).gtag = gtag;
  (window as Win).fbq = fbq;
});
afterEach(() => {
  document.body.innerHTML = '';
  clearCookies();
});

const root = (): HTMLElement => document.querySelector('.atl-consent') as HTMLElement;

describe('renderConsentUi markup', () => {
  it('hides the banner when showBanner is false but keeps config + script for the footer link', () => {
    const c = consent();
    const html = renderConsentUi({
      consent: c,
      decision: decideConsent({ consent: c, country: 'US', cookie: { analytics: true, marketing: true } }),
      country: 'US',
    });
    document.body.innerHTML = html;
    expect(root().hidden).toBe(true);
    expect(document.getElementById('atl-consent-config')).not.toBeNull();
    expect(document.querySelector('script[data-atl-consent-client]')).not.toBeNull();
  });

  it('shows Accept and Reject as equally styled buttons', () => {
    mount({ country: 'DE' });
    expect(root().hidden).toBe(false);
    const accept = document.querySelector('[data-atl-consent-bar] [data-atl-consent="accept"]') as HTMLElement;
    const reject = document.querySelector('[data-atl-consent-bar] [data-atl-consent="reject"]') as HTMLElement;
    expect(accept.tagName).toBe('BUTTON');
    expect(reject.tagName).toBe('BUTTON');
    expect(accept.className).toBe(reject.className);
  });

  it('escapes the message and uses the default when empty', () => {
    mount({ country: 'DE', cfg: { message: '<b>x</b>' } });
    expect(document.querySelector('.atl-consent b')).toBeNull();
    expect(root().textContent).toContain('<b>x</b>');
    mount({ country: 'DE' });
    expect(root().textContent).toContain('We use cookies to measure traffic');
  });

  it('links the privacy page and refuses javascript: URLs', () => {
    mount({ country: 'DE', cfg: { privacy_url: '/legal/privacy' } });
    expect(document.querySelector('.atl-consent a')?.getAttribute('href')).toBe('/legal/privacy');
    mount({ country: 'DE', cfg: { privacy_url: 'javascript:alert(1)' } });
    expect(document.querySelector('.atl-consent a')?.getAttribute('href')).toBe('/privacy');
  });
});

describe('client script', () => {
  const inert = (): string => inertScript(RUN_JS) + inertHtml(`<span id="custom-mark"></span><script>${RUN_JS}</script>`);

  it('Accept: stores v1.1.1, grants consent, runs held-back scripts once, hides the banner', () => {
    mount({ country: 'DE', extra: inert() });
    expect(ran()).toBeNull();
    click('[data-atl-consent-bar] [data-atl-consent="accept"]');
    expect(document.cookie).toContain('atl_consent=v1.1.1');
    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted',
    });
    expect(ran()).toBe('2'); // the inert <script> and the <template> script, each exactly once
    expect(document.getElementById('custom-mark')).not.toBeNull();
    expect(root().hidden).toBe(true);
    // A second Accept (via the footer panel) must not run them again.
    click('[data-atl-consent="accept"]');
    expect(ran()).toBe('2');
  });

  it('Reject: stores v1.0.0, denies consent, revokes the Meta pixel, runs nothing', () => {
    mount({ country: 'US', extra: inert() });
    click('[data-atl-consent-bar] [data-atl-consent="reject"]');
    expect(document.cookie).toContain('atl_consent=v1.0.0');
    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
    });
    expect(fbq).toHaveBeenCalledWith('consent', 'revoke');
    expect(ran()).toBeNull();
    expect(root().hidden).toBe(true);
  });

  it('Settings: untick analytics, keep marketing, save → v1.0.1', () => {
    mount({ country: 'US' });
    click('[data-atl-consent-bar] [data-atl-consent="settings"]');
    const panel = document.querySelector('[data-atl-consent-panel]') as HTMLElement;
    expect(panel.hidden).toBe(false);
    const analytics = panel.querySelector('input[name="analytics"]') as HTMLInputElement;
    const marketing = panel.querySelector('input[name="marketing"]') as HTMLInputElement;
    expect(analytics.checked).toBe(true); // notice region starts allowed
    analytics.checked = false;
    expect(marketing.checked).toBe(true);
    click('[data-atl-consent-panel] [data-atl-consent="save"]');
    expect(document.cookie).toContain('atl_consent=v1.0.1');
    expect(root().hidden).toBe(true);
  });

  it('the footer link opens the panel even when no banner is shown', () => {
    const c = consent();
    const html = renderConsentUi({
      consent: c,
      decision: decideConsent({ consent: c, country: 'DE', cookie: { analytics: false, marketing: false } }),
      country: 'DE',
    });
    document.body.innerHTML = '<footer><button type="button" data-atl-consent-open>Cookie settings</button></footer>' + html;
    // eslint-disable-next-line no-new-func
    new Function(document.querySelector('script[data-atl-consent-client]')?.textContent ?? '')();
    expect(root().hidden).toBe(true);
    click('[data-atl-consent-open]');
    expect(root().hidden).toBe(false);
    expect((document.querySelector('[data-atl-consent-panel]') as HTMLElement).hidden).toBe(false);
    expect((document.querySelector('[data-atl-consent-bar]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('input[name="marketing"]') as HTMLInputElement).checked).toBe(false);
  });

  it('relabels the footer link for US visitors only', () => {
    const link = '<button type="button" data-atl-consent-open>Cookie settings</button>';
    mount({ country: 'US', extra: link });
    expect(document.querySelector('[data-atl-consent-open]')?.textContent).toBe('Do not sell or share my personal information');
    mount({ country: 'GB', extra: link });
    expect(document.querySelector('[data-atl-consent-open]')?.textContent).toBe('Cookie settings');
  });

  it('Escape closes the settings panel', () => {
    mount({ country: 'DE' });
    click('[data-atl-consent-bar] [data-atl-consent="settings"]');
    root().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect((document.querySelector('[data-atl-consent-panel]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-atl-consent-bar]') as HTMLElement).hidden).toBe(false);
  });
});

describe('island rendered in <head>', () => {
  it('moves the banner into <body> so it can be displayed', () => {
    const c = consent();
    const decision = decideConsent({ consent: c, country: 'DE', cookie: null });
    document.head.insertAdjacentHTML('beforeend', renderConsentUi({ consent: c, decision, country: 'DE' }));
    // eslint-disable-next-line no-new-func
    new Function(document.head.querySelector('script[data-atl-consent-client]')?.textContent ?? '')();
    expect(root().parentElement).toBe(document.body);
    expect(root().hidden).toBe(false);
    document.head.querySelectorAll('style, script').forEach((n) => n.remove());
  });
});

describe('sticky-bottom ad', () => {
  it('sits above a sticky ad that appears after the banner', () => {
    vi.useFakeTimers();
    try {
      mount({ country: 'DE' });
      expect(root().style.bottom).toBe('0px');
      const sticky = document.createElement('div');
      sticky.setAttribute('data-atl-sticky-wrapper', '');
      sticky.getClientRects = (): DOMRectList => [{}] as unknown as DOMRectList;
      sticky.getBoundingClientRect = (): DOMRect => ({ height: 50 }) as DOMRect;
      document.body.appendChild(sticky);
      vi.advanceTimersByTime(600);
      expect(root().style.bottom).toBe('50px');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('inert helpers', () => {
  it('inertScript cannot be broken out of with </script>', () => {
    document.body.innerHTML = inertScript('var s = "</script><img src=x id=pwn>";');
    expect(document.getElementById('pwn')).toBeNull();
    expect(document.querySelectorAll('script[data-atl-consent="marketing"]')).toHaveLength(1);
  });
});
