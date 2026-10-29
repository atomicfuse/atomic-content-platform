# Cookie Consent

Every site can show our own cookie-consent banner: a bar at the bottom of the page with **Accept**, **Reject** and **Settings**. Settings has two switches, **Analytics** and **Marketing**. The visitor's choice is remembered for 6 months in the `atl_consent` cookie.

A **Cookie settings** link in every footer reopens the choices at any time. For US visitors it reads **Do not sell or share my personal information**.

## What visitors get

| | EU, Iceland, Liechtenstein, Norway, UK, Switzerland (and unknown country) | Everyone else |
|---|---|---|
| Before answering | Not tracked (opt-in) | Tracked (notice style) |
| Accept | Tracked | Tracked |
| Reject | Not tracked | Not tracked |
| Ads | Always load | Always load |

"Not tracked" means:

- **GA4, Google Ads and GTM** still load, but in Google Consent Mode "denied". They send anonymous, cookie-free pings only. AdSense follows the same setting.
- **The Meta pixel and custom tracking scripts** don't load at all.

Browsers that send Global Privacy Control outside the EU start with Marketing off.

**EU ads trade-off.** Our banner is not an IAB TCF certified consent tool, so it can't pass the visitor's choice to ad partners in the format they recognise. EU/UK visitors therefore get non-personalised or limited ads whether they accept or reject. Visitors outside the EU are not affected.

## Settings

Open the **Cookie consent** section on the **Config** tab of Org settings, a group, an override, or a site. It follows normal inheritance: org → groups → overrides → site. On groups, overrides and sites, **Inherit** or an empty field uses the value from the level above.

- **Enabled / Banner.** The master switch. The code default is off, so nothing changes until it's turned on.
- **Show banner to.**
  - **Everyone:** the default.
  - **Only these countries:** two-letter codes, e.g. `DE, FR, GB`. Visitors from other countries see no banner and are tracked as before. A warning appears if the list leaves out EU/UK countries.
- **Banner message.** Leave it empty to use the default text.
- **Privacy policy link.** Defaults to `/privacy`.

After saving, use **Sync now** (or wait for the commit to sync) so the change reaches the sites. New sites inherit the org setting automatically.

## Testing

- **On staging** (`*.workers.dev`), add `?consent_country=DE` to any URL to see the site as a visitor from Germany. `?consent_country=US` shows the US version. `?consent_country=` clears it. This doesn't work on live domains.
- **To see the banner again** after choosing, delete the `atl_consent` cookie for the site in your browser's dev tools.

## Notes

- The visitor's country and choice are read per request in the tracking loader, never in cached pages. A cached page can't show the wrong banner.
- Landing pages served by other workers (`?x=1`, `?agi=1011`) don't show the banner.
