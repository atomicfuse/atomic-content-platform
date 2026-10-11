# Similarweb

The **Similarweb** column on the Dashboard home and on the Sites list shows whether Similarweb ranks each site:

| Shows | Means |
|---|---|
| ✓ #79,692 · 1.34M/mo | Similarweb has a global rank for the domain (and its monthly visits estimate) |
| ✗ No rank | Similarweb has no ranking — even if it shows a small visits estimate |
| No domain | The site has no real domain yet (staging-only) |
| — | Never checked |

Sort by the column to see the best-ranked sites first, or filter to **No rank**. The same result shows as a badge on each site's page.

## Monthly update (about 10 minutes)
1. Open the Similarweb checklist page and check each site with the Similarweb browser extension (or its Similarweb page): mark **Has rank** with the rank, or **No rank**.
2. Click **Copy results**.
3. On the Dashboard home (or the Sites list) click **Update Similarweb data**, paste, **Preview**, then **Import**.

Results are saved in the network repo (`similarweb.yaml` on main), so every dashboard — local or production — shows the same data.

Rows that don't match a site, or say "yes" without a rank, are listed in the preview and skipped. A site left "unchecked" keeps its previous result.

## Later
With Similarweb REST API access, the dashboard will refresh this automatically every month — same column, no pasting.
