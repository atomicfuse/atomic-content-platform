# Shared Pages

Every site in the network includes a set of global pages: About, Contact, Privacy Policy, Terms of Service, and DMCA Notice. These are maintained as templates with placeholder tokens that get resolved per-site at build time.

## Template Location

Templates live in the site-builder package:

```
packages/site-builder/shared-pages/
  about.md
  contact.md
  privacy.md
  terms.md
  dmca.md
```

Each file is a standard Markdown file with Astro frontmatter (layout reference) and `{{placeholder}}` tokens throughout the content.

## How Injection Works

During the Astro build, the `inject-shared-pages.ts` script:

1. Reads all `.md` files from the `shared-pages/` directory
2. Resolves every `{{placeholder}}` token using the site's `ResolvedConfig`
3. Writes the resolved files to `src/pages/` so Astro renders them as routes

The result: every site gets `/about`, `/contact`, `/privacy`, `/terms`, and `/dmca` pages with correct site-specific content.

## Available Placeholders

| Placeholder | Source | Example |
|-------------|--------|---------|
| `{{site_name}}` | `resolvedConfig.site_name` | "Wanderlust Weekly" |
| `{{domain}}` | `resolvedConfig.domain` | "wanderlust.dev" |
| `{{support_email}}` | `resolvedConfig.legal.support_email` or `contact@{domain}` | "contact@wanderlust.dev" |
| `{{company_name}}` | `resolvedConfig.legal_entity` | "NGC Digital Ltd." |
| `{{company_country}}` | `resolvedConfig.legal.company_country` | "Israel" |
| `{{effective_date}}` | `resolvedConfig.legal.effective_date` | "January 1, 2026" |
| `{{site_description}}` | `resolvedConfig.legal.site_description` | "travel tips and guides" |

Any key present in `resolvedConfig.legal` is also available as a placeholder. Unrecognized tokens are left as-is (e.g., `{{unknown_key}}` passes through unchanged).

## Placeholder Resolution Logic

The resolver builds a flat lookup map:

```typescript
const vars: Record<string, string> = {
  site_name: resolvedConfig.site_name,
  domain: resolvedConfig.domain,
  support_email: resolvedConfig.legal["support_email"] ?? `contact@${resolvedConfig.domain}`,
  company_name: resolvedConfig.legal_entity,
  company_country: resolvedConfig.legal["company_country"] ?? "",
  effective_date: resolvedConfig.legal["effective_date"] ?? "",
  site_description: resolvedConfig.legal["site_description"] ?? "",
  ...resolvedConfig.legal,  // any custom keys
};
```

Then replaces all `{{key}}` occurrences in the template.

## Config Hierarchy for Legal Content

Legal values follow the standard merge chain:

```
org.yaml          -- defines legal_entity, company_address, legal templates
  group.yaml      -- legal_pages_override (optional)
    site.yaml     -- legal overrides (optional)
```

At the org level, `legal` is a key-value map of template variables. Groups and sites can override specific keys. For example, a site could override `support_email` to use a custom address.

## Per-Site Overrides

To override a shared page for a specific site, add entries to the `legal` map in that site's `site.yaml`:

```yaml
# site.yaml
legal:
  support_email: "special@example.com"
  company_country: "United States"
  site_description: "in-depth travel reviews and destination guides"
```

These values take precedence over org/group defaults during placeholder resolution.

## Example: Contact Page Template

```markdown
---
title: "Contact Us"
layout: ../layouts/PageLayout.astro
---

# Contact {{site_name}}

We would love to hear from you.

## Get in Touch

**Email:** {{support_email}}

## About {{site_name}}

{{site_name}} is operated by **{{company_name}}**, based in {{company_country}}.
We cover {{site_description}}.

**Website:** https://{{domain}}
```

After resolution for a site named "TechPulse" with domain `techpulse.dev`:

```markdown
# Contact TechPulse

**Email:** contact@techpulse.dev

TechPulse is operated by **NGC Digital Ltd.**, based in Israel.
We cover the latest in technology and gadgets.
```

## Adding a New Shared Page

1. Create a new `.md` file in `packages/site-builder/shared-pages/`
2. Add Astro frontmatter with `layout: ../layouts/PageLayout.astro`
3. Use `{{placeholder}}` tokens for any site-specific content
4. The injection script will automatically pick it up -- no code changes needed
