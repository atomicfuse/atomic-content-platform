# ads.txt Management

`ads.txt` is an IAB Tech Lab standard that lets publishers declare which ad networks are authorized to sell their inventory. Every site in the network gets an auto-generated `ads.txt` file at build time.

## How It Works

The `generate-ads-txt.ts` script in the site builder reads the fully-resolved config and outputs the `ads.txt` content. The file is a simple newline-separated list of IAB-format seller entries.

```typescript
export function generateAdsTxt(resolvedConfig: ResolvedConfig): string {
  return resolvedConfig.ads_txt.join("\n");
}
```

The `ads_txt` array in `ResolvedConfig` is pre-merged from org and group layers by the config resolver.

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

ads.txt entries are defined at two levels:

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

A site in the `premium-ads` group would get all org entries plus the group-specific Taboola and Criteo entries.

## Advertising Configuration

Beyond `ads.txt`, the `ads_config` object controls ad display behavior:

```yaml
ads_config:
  primary_advertiser: "google"
  interstitial: true        # full-page ads between page loads
  layout: "standard"        # or "aggressive"
  in_content_slots: 3       # ads between paragraphs
  sidebar: true             # sidebar ad placements
  ad_placements:
    - id: "above-content"
      position: "above-content"
      device: "all"
      sizes:
        desktop: [[728, 90], [970, 250]]
        mobile: [[320, 50], [300, 250]]
    - id: "after-paragraph-3"
      position: "after-paragraph-3"
      device: "all"
      sizes:
        desktop: [[300, 250], [336, 280]]
        mobile: [[300, 250]]
    - id: "sticky-bottom"
      position: "sticky-bottom"
      device: "mobile"
      sizes:
        mobile: [[320, 50]]
```

These settings follow the same org -> group -> site merge hierarchy.

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

At build time, the site builder writes `ads.txt` to the Astro public directory so it is served at `https://{domain}/ads.txt`. The file contains all merged entries from org + group layers, one per line.
