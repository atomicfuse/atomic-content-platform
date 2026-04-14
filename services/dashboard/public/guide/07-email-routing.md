# Per-Site Contact Email via Cloudflare Email Routing

Each site in the network gets a contact email address in the format `contact@{domain}`. This is implemented using Cloudflare Email Routing, which forwards incoming emails to a central mailbox without requiring a mail server.

## How It Works

1. **Cloudflare Email Routing** is enabled on each site's DNS zone
2. A catch-all or specific route forwards `contact@{domain}` to a shared inbox
3. The forwarding destination is `michal@atomiclabs.io`
4. No mail server is needed -- Cloudflare handles routing at the DNS level

## When It Activates

Email routing only works when a **custom domain** is connected to the site. Sites on `*.pages.dev` subdomains do not support email routing because the `pages.dev` zone is owned by Cloudflare.

For sites without a custom domain, the contact page falls back to a generic email address.

## Fallback Logic

The shared pages use the `{{support_email}}` placeholder. Resolution order:

1. If `resolvedConfig.legal["support_email"]` is set -- use that (per-site override)
2. Otherwise, default to `contact@{resolvedConfig.domain}`

For sites still on `*.pages.dev`, operators should set an explicit `support_email` in the site's legal config:

```yaml
# site.yaml
legal:
  support_email: "michal@atomiclabs.io"
```

Once the custom domain is connected and email routing is configured, the override can be removed to use the auto-generated `contact@{domain}`.

## Template Usage

The `{{support_email}}` placeholder appears in these shared pages:

- **Contact** (`contact.md`): primary contact method listed on the page
- **Privacy Policy** (`privacy.md`): data subject requests and inquiries
- **Terms of Service** (`terms.md`): legal contact
- **DMCA** (`dmca.md`): takedown request submissions

Example from the contact page template:

```markdown
## Get in Touch

**Email:** {{support_email}}
```

## Setting Up Email Routing for a New Domain

When a custom domain is attached to a site:

1. The domain's DNS zone must be active in Cloudflare
2. Enable Email Routing in the Cloudflare dashboard for that zone
3. Add a routing rule: `contact@{domain}` -> `michal@atomiclabs.io`
4. Cloudflare automatically adds the required MX and TXT DNS records

This is currently a manual step performed after the site goes live with a custom domain.

## DNS Records

Cloudflare Email Routing adds these records automatically:

```
MX    {domain}    route1.mx.cloudflare.net    priority 69
MX    {domain}    route2.mx.cloudflare.net    priority 34
MX    {domain}    route3.mx.cloudflare.net    priority 5
TXT   {domain}    "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

## Overriding for Specific Sites

If a site needs a different contact email (e.g., a custom support address), set it in `site.yaml`:

```yaml
legal:
  support_email: "help@my-custom-domain.com"
```

This value takes precedence over the auto-generated `contact@{domain}` in all shared pages.
