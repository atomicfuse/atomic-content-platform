# ads.txt Management

`ads.txt` is an IAB Tech Lab standard that lets publishers declare which ad networks are authorized to sell their inventory. Every site in the network gets an auto-generated `ads.txt` file at build time.

## How It Works

The `generate-ads-txt.ts` script in the site builder reads the fully-resolved config and outputs the `ads.txt` content. The file includes a header comment, entries sorted alphabetically, and a trailing newline.

```typescript
export function generateAdsTxt(resolvedConfig: ResolvedConfig): string {
  const header = `# ads.txt for ${resolvedConfig.domain} — auto-generated`;
  const sorted = [...resolvedConfig.ads_txt].sort();
  return [header, ...sorted, ""].join("\n");
}
```

The `ads_txt` array in `ResolvedConfig` is assembled by **appending** entries from org, all groups (in order), overrides, and site, then **deduplicating** while preserving order. See the **Config Inheritance & Groups** guide for the full merge process.

## IAB Format

Each line follows the standard format:

```
<domain>, <publisher-account-id>, <account-type>, <certification-authority-id>
```

Example:

```
google.com, pub-1234567890, DIRECT, f08c47fec0942fa0
taboola.com, 1234567, DIRECT, c228e6794e811952
outbrain.com, 00abc123def, DIRECT
```

## Config Layers

ads.txt entries are defined at four levels and **appended** (not replaced) across layers:

### Organization Level (`org.yaml`)

The `ads_config.ads_txt` array in `org.yaml` defines entries that apply to every site in the network:

```yaml
# org.yaml
ads_config:
  ads_txt:
    - "google.com, pub-XXXXXXXXX, DIRECT, f08c47fec0942fa0"
    - "outbrain.com, 00XXXXXXX, DIRECT"
```

### Group Level (`group.yaml`)

Groups can add additional entries via their `ads_txt` array. These are merged (appended) with org-level entries:

```yaml
# groups/premium-ads.yaml
group_id: premium-ads
name: Premium Ads
ads_txt:
  - "taboola.com, 1234567, DIRECT, c228e6794e811952"
  - "criteo.com, B-XXXXXX, DIRECT"
```

A site in the `premium-ads` group would get all org entries plus the group-specific Taboola and Criteo entries. If a site belongs to multiple groups, entries from all groups are appended in order and then deduplicated. Duplicate lines are removed while preserving the order of first appearance.

### Override Level (`overrides/config/<id>.yaml`)

Overrides use REPLACE semantics. If an override defines `ads_txt`, it completely replaces the group chain's ads_txt for targeted sites:

```yaml
# overrides/config/test-ads-mock.yaml
override_id: test-ads-mock
targets:
  sites: ["coolnews-atl"]
ads_txt: []    # empty — removes all inherited ads.txt entries for this site
```

## Advertising Configuration

Beyond `ads.txt`, the `ads_config` object controls ad display behavior. Ads render on **all page types** — articles, homepage, category pages, and shared pages (about, privacy, terms, contact, DMCA).

```yaml
ads_config:
  interstitial: true        # full-page ads between page loads
  layout: "standard"        # or "high-density"
  ad_placements:
    - id: "top-banner"
      position: "above-content"
      device: "all"
      sizes:
        desktop: [[728, 90], [970, 250]]
        mobile: [[320, 50], [300, 250]]
    - id: "in-content-1"
      position: "after-paragraph-3"
      device: "all"
      sizes:
        desktop: [[300, 250], [336, 280]]
        mobile: [[300, 250]]
    - id: "sidebar-sticky"
      position: "sidebar"
      device: "desktop"
      sizes:
        desktop: [[300, 600], [160, 600], [300, 250]]
    - id: "homepage-top-banner"
      position: "homepage-top"
      device: "all"
      sizes:
        desktop: [[970, 90], [728, 90]]
        mobile: [[320, 50]]
    - id: "category-banner"
      position: "category-top"
      device: "all"
      sizes:
        desktop: [[728, 90]]
        mobile: [[320, 50]]
    - id: "mobile-anchor"
      position: "sticky-bottom"
      device: "mobile"
      sizes:
        mobile: [[320, 50]]
```

Available positions: `above-content`, `after-paragraph-1` through `after-paragraph-8`, `below-content`, `sidebar`, `sticky-bottom`, `homepage-top`, `homepage-mid`, `category-top`.

These settings follow the same org -> groups -> overrides -> site merge hierarchy. Ad placements use **replacement** semantics — a child layer that defines `ad_placements` replaces the parent's list entirely.

## Script Injection for Ads

Ad network scripts (e.g., Google Ad Manager, Taboola loader) are injected via the `scripts` config:

```yaml
scripts:
  head:
    - id: "gpt"
      src: "https://securepubads.g.doubleclick.net/tag/js/gpt.js"
      async: true
  body_start:
    - id: "gtm-noscript"
      inline: "<noscript>...</noscript>"
  body_end:
    - id: "taboola-loader"
      src: "https://cdn.taboola.com/libtrc/publisher/loader.js"
```

Script entries support `{{variable}}` placeholders that are resolved using `scripts_vars` from the site config, allowing per-site publisher IDs.

## Build Output

At build time, the site builder writes `ads.txt` to the Astro public directory so it is served at `https://{domain}/ads.txt`. The file contains a header comment, all merged entries from org + group(s) + overrides + site layers sorted alphabetically, one per line.
