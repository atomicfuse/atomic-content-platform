/**
 * Browser-side pieces of the cookie-consent banner, built as strings.
 *
 * `buildConsentBootstrap()` goes into the cached page `<head>`, so it must be
 * identical for every visitor: it reads the visitor's stored choice in the
 * browser and lets Google apply the opt-in region itself (gtag `region`).
 * It runs before `scripts.head`, so ad SDKs that honour Consent Mode
 * (AdSense) see the default too.
 */
import { CONSENT_COOKIE, DEFAULT_CONSENT_MESSAGE, OPT_IN_COUNTRIES, type ConsentDecision } from './consent';
import type { ResolvedConsentConfig } from '@atomic-platform/shared-types';

/** Google Consent Mode v2 defaults + the gtag shim. Visitor-independent. */
export function buildConsentBootstrap(): string {
  return `(function(){
var w=window;w.dataLayer=w.dataLayer||[];
w.gtag=w.gtag||function(){w.dataLayer.push(arguments);};
function s(ads,an){return{ad_storage:ads,ad_user_data:ads,ad_personalization:ads,analytics_storage:an};}
var m=/(?:^|;\\s*)${CONSENT_COOKIE}=v1\\.([01])\\.([01])(?:;|$)/.exec(document.cookie);
if(m){w.gtag('consent','default',s(m[2]==='1'?'granted':'denied',m[1]==='1'?'granted':'denied'));return;}
var d=s('denied','denied');d.region=${JSON.stringify(OPT_IN_COUNTRIES)};
w.gtag('consent','default',d);
w.gtag('consent','default',s(navigator.globalPrivacyControl===true?'denied':'granted','granted'));
})();`;
}

// ---------------------------------------------------------------------------
// Island pieces (rendered per request by PixelLoader)
// ---------------------------------------------------------------------------

const US_LINK_LABEL = 'Do not sell or share my personal information';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only same-site paths and http(s) URLs; anything else (e.g. `javascript:`) falls back to /privacy. */
export function safePrivacyUrl(url: string): string {
  return /^(\/(?!\/)|https?:\/\/)/i.test(url) ? url : '/privacy';
}

/** A marketing script held back until consent. `</script` is escaped so the body can't end the tag. */
export function inertScript(js: string): string {
  return `<script type="text/plain" data-atl-consent="marketing">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
}

/** Marketing HTML (may contain scripts) held back until consent. Template content never runs or renders. */
export function inertHtml(html: string): string {
  return `<template data-atl-consent="marketing">${html}</template>`;
}

const CONSENT_CSS = `
.atl-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;font-family:inherit;font-size:14px;line-height:1.45;color:var(--color-text,#111);background:var(--color-background,var(--color-surface,#fff));border-top:1px solid var(--color-border,rgba(0,0,0,.12));box-shadow:0 -4px 16px rgba(0,0,0,.08)}
.atl-consent[hidden],.atl-consent [hidden]{display:none!important}
.atl-consent__bar,.atl-consent__panel{box-sizing:border-box;max-width:1100px;margin:0 auto;padding:14px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px}
.atl-consent__panel{flex-direction:column;align-items:stretch;max-height:80vh;overflow:auto}
.atl-consent__panel .atl-consent__msg{flex:none}
.atl-consent__msg,.atl-consent__title{margin:0;flex:1 1 320px}
.atl-consent__title{font-weight:700;font-size:15px;flex:none}
.atl-consent a{color:inherit!important;text-decoration:underline!important}
.atl-consent__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.atl-consent__btn{appearance:none;border:0;border-radius:6px;padding:9px 18px;min-width:96px;font:inherit;font-weight:600;cursor:pointer;background:var(--color-primary,#1a1a2e);color:var(--color-primary-fg,#fff)}
.atl-consent__link{appearance:none;background:none;border:0;padding:9px 6px;font:inherit;color:inherit;text-decoration:underline;cursor:pointer}
.atl-consent button:focus-visible,.atl-consent input:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.atl-consent__opt{display:flex;gap:10px;align-items:flex-start}
.atl-consent__opt input{margin-top:3px;width:16px;height:16px;flex:none}
.atl-consent__opt small{display:block;opacity:.75}
@media (max-width:600px){.atl-consent__actions{width:100%}.atl-consent__btn{flex:1 1 0;min-width:0}}
`.trim();

/**
 * Runs in the browser. Applies choices live, wires the footer link, keeps clear of the sticky-bottom ad.
 * The PixelLoader island renders inside <head>, which is never displayed — so the banner is moved to <body>.
 */
const CONSENT_CLIENT = `(function(){try{
var cfgEl=document.getElementById('atl-consent-config');var root=document.querySelector('.atl-consent');
if(!cfgEl||!root)return;
var cfg=JSON.parse(cfgEl.textContent||'{}');
if(root.parentNode!==document.body){document.body.appendChild(root);}
var bar=root.querySelector('[data-atl-consent-bar]');var panel=root.querySelector('[data-atl-consent-panel]');
var state={a:!!cfg.analytics,m:!!cfg.marketing};var fromBar=false;
function v(b){return b?'granted':'denied';}
function input(n){return panel.querySelector('input[name="'+n+'"]');}
function place(){var w=document.querySelector('[data-atl-sticky-wrapper]');var h=0;
if(w&&w.getClientRects().length){h=w.getBoundingClientRect().height||0;}root.style.bottom=h+'px';}
function activate(){
var s=document.querySelectorAll('script[type="text/plain"][data-atl-consent="marketing"]');
for(var i=0;i<s.length;i++){var n=document.createElement('script');n.text=s[i].text;s[i].parentNode.replaceChild(n,s[i]);}
var t=document.querySelectorAll('template[data-atl-consent="marketing"]');
for(var j=0;j<t.length;j++){var f=t[j].content.cloneNode(true);var inner=f.querySelectorAll('script');
for(var k=0;k<inner.length;k++){var o=inner[k],c=document.createElement('script');
for(var x=0;x<o.attributes.length;x++){c.setAttribute(o.attributes[x].name,o.attributes[x].value);}
c.text=o.text;o.parentNode.replaceChild(c,o);}
t[j].parentNode.replaceChild(f,t[j]);}}
// The sticky-bottom ad is its own island and can appear (or be closed) after the banner — re-measure while visible.
var timer=null;
function track(){place();if(!timer){timer=setInterval(function(){if(root.hidden){clearInterval(timer);timer=null;}else{place();}},500);}}
function hide(){root.hidden=true;}
function showBar(){root.hidden=false;bar.hidden=false;panel.hidden=true;track();}
function openPanel(viaBar){fromBar=viaBar;root.hidden=false;bar.hidden=true;panel.hidden=false;
input('analytics').checked=state.a;input('marketing').checked=state.m;track();input('analytics').focus();}
function closePanel(){if(fromBar){showBar();}else{hide();}}
function choose(a,m){
document.cookie='atl_consent=v1.'+(a?1:0)+'.'+(m?1:0)+'; Path=/; Max-Age=15552000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
if(typeof window.gtag==='function'){window.gtag('consent','update',{ad_storage:v(m),ad_user_data:v(m),ad_personalization:v(m),analytics_storage:v(a)});}
if(typeof window.fbq==='function'){window.fbq('consent',m?'grant':'revoke');}
if(m){activate();}
state={a:a,m:m};hide();}
root.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-atl-consent]'):null;if(!b)return;
var act=b.getAttribute('data-atl-consent');
if(act==='accept'){choose(true,true);}else if(act==='reject'){choose(false,false);}
else if(act==='settings'){openPanel(true);}else if(act==='save'){choose(input('analytics').checked,input('marketing').checked);}});
root.addEventListener('keydown',function(e){if(e.key==='Escape'&&!panel.hidden){closePanel();}});
document.addEventListener('click',function(e){var l=e.target&&e.target.closest?e.target.closest('[data-atl-consent-open]'):null;
if(l){e.preventDefault();openPanel(false);}});
if(cfg.country==='US'){var ls=document.querySelectorAll('[data-atl-consent-open]');for(var q=0;q<ls.length;q++){ls[q].textContent=${JSON.stringify(US_LINK_LABEL)};}}
window.addEventListener('resize',function(){if(!root.hidden){place();}});
if(cfg.showBanner){showBar();}else{hide();}
}catch(err){if(window.console){console.warn('[atl-consent]',err);}}})();`;

/**
 * Banner + settings panel + client script for one visitor. Always rendered when consent is
 * enabled (the footer link needs the panel); the banner itself is visible only when
 * `decision.showBanner`.
 */
export function renderConsentUi(input: {
  consent: ResolvedConsentConfig;
  decision: ConsentDecision;
  country: string | null;
}): string {
  const { consent, decision, country } = input;
  const message = escapeHtml(consent.message || DEFAULT_CONSENT_MESSAGE);
  const privacy = escapeHtml(safePrivacyUrl(consent.privacy_url));
  const cfg = JSON.stringify({
    region: decision.region,
    country,
    analytics: decision.analyticsAllowed,
    marketing: decision.marketingAllowed,
    showBanner: decision.showBanner,
  }).replace(/</g, '\\u003c');
  return `<style>${CONSENT_CSS}</style>
<div class="atl-consent" role="region" aria-label="Cookie consent"${decision.showBanner ? '' : ' hidden'}>
<div class="atl-consent__bar" data-atl-consent-bar>
<p class="atl-consent__msg">${message} <a href="${privacy}">Privacy Policy</a></p>
<div class="atl-consent__actions">
<button type="button" class="atl-consent__btn" data-atl-consent="accept">Accept</button>
<button type="button" class="atl-consent__btn" data-atl-consent="reject">Reject</button>
<button type="button" class="atl-consent__link" data-atl-consent="settings">Settings</button>
</div>
</div>
<div class="atl-consent__panel" data-atl-consent-panel hidden>
<p class="atl-consent__title">Cookie settings</p>
<label class="atl-consent__opt"><input type="checkbox" name="analytics"><span>Analytics<small>Helps us understand how the site is used.</small></span></label>
<label class="atl-consent__opt"><input type="checkbox" name="marketing"><span>Marketing<small>Lets advertising and social partners personalise what you see.</small></span></label>
<div class="atl-consent__actions">
<button type="button" class="atl-consent__btn" data-atl-consent="save">Save choices</button>
<button type="button" class="atl-consent__link" data-atl-consent="accept">Accept all</button>
<button type="button" class="atl-consent__link" data-atl-consent="reject">Reject all</button>
</div>
<p class="atl-consent__msg"><a href="${privacy}">Privacy Policy</a></p>
</div>
</div>
<script type="application/json" id="atl-consent-config">${cfg}</script>
<script data-atl-consent-client>${CONSENT_CLIENT}</script>`;
}
