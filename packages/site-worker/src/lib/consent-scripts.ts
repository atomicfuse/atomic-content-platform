/**
 * Browser-side pieces of the cookie-consent banner, built as strings.
 *
 * `buildConsentBootstrap()` goes into the cached page `<head>`, so it must be
 * identical for every visitor: it reads the visitor's stored choice in the
 * browser and lets Google apply the opt-in region itself (gtag `region`).
 * It runs before `scripts.head`, so ad SDKs that honour Consent Mode
 * (AdSense) see the default too.
 */
import { CONSENT_COOKIE, OPT_IN_COUNTRIES } from './consent';

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
