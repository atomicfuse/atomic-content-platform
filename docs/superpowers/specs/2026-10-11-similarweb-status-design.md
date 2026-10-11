# Similarweb status per site — design

**Status:** design approved in session 2026-10-11 (Asaf); this spec awaits review.
**Scope:** dashboard only (`services/dashboard`). No site-worker, pipeline or network-repo changes.

## Goal
See at a glance which network sites Similarweb knows about: **has a global rank → Yes, no rank → No**, plus the
rank and monthly visits when there is one. Filled by a monthly manual check today; by the Similarweb REST API once
the account has API access — without changing what people see.

## Decisions
| # | Decision |
|---|----------|
| D1 | Rule: a site is **Yes** when Similarweb shows a global rank, otherwise **No**. A visits estimate without a rank (e.g. 257/mo) is **No**. Sites with no real domain show **No domain**. |
| D2 | Data source now: the CSV produced by the Similarweb checklist page (Asaf checks each domain with the browser extension, ~5–10 min/month) is pasted or uploaded into the dashboard. The unofficial extension endpoint is not used (it blocks automated requests and is against Similarweb's terms). |
| D3 | Data source later: Similarweb REST API v5 (`/v5/website-analysis/websites/traffic-and-engagement`, header `api-key`) once the plan includes REST API access (today it shows a crown/upgrade). Same storage and UI; only the `source` changes. Not built in this stage. |
| D4 | Where it shows: a **Similarweb** column on the Dashboard home table and on the Sites list (sortable; filterable on the Sites list), an "Update Similarweb data" button on both, and a badge in the site page header. |
| D5 | Only the latest result per site is kept (no history/trend). |
| D6 | Day one: the 2026-10-11 results (21 Yes / 35 No of 56 live sites) are imported through the same box right after deploy. |

## Data

### Import format (the checklist page's "Copy results")
```
domain,site,similarweb,global_rank,monthly_visits
journeypeaks.com,journeypeaks,yes,79692,"1.34M"
gamerswiredaily.com,gamerswiredaily,no,,"257"
scoopella.com,scoopella,no,,""
```
- Header row required; column order free (matched by name, case-insensitive); `monthly_visits` optional.
- `similarweb`: `yes` | `no` | `unchecked`. `unchecked` rows are ignored (the site keeps its previous result).
- A `yes` row needs a positive integer `global_rank` (commas allowed); otherwise the row is rejected and reported.
- `monthly_visits`: `68,562`, `68562`, `1.34M`, `12.5K` or empty → integer or null. Ignored on `no` rows (D1 stores visits only with a rank).
- Rows match a site by `domain` against the site's `custom_domain` (lowercased, `www.` stripped), falling back to `site` against the site id. Unknown rows are reported, never stored.
- Quoted fields and Windows line endings are accepted.

### Storage — network repo `similarweb.yaml` on `main` (revised 2026-10-11)

Revised after local testing: under `grid dev` the injected Mongo has no writable primary, and Mongo-only data diverges between local and production dashboards. The results now live in one YAML file in the network repo (`sites: { <siteId>: {domain, has_rank, global_rank, monthly_visits, checked_at, source} }`), read through the dashboard's GitHub helpers and written with one commit per import (merged, so other sites keep their results). No sync workflow watches a root-level file. The shape below is unchanged.
```ts
interface SimilarwebStatus {
  site: string;              // dashboard site id (dashboard-index `domain`), unique
  domain: string;            // the real domain that was checked
  has_rank: boolean;
  global_rank: number | null;
  monthly_visits: number | null;
  checked_at: string;        // ISO date of the import (or API fetch later)
  source: "manual" | "api";
}
```
- One entry per site, replaced on each import. A broken file reads as "no data" instead of failing pages.

## API (Next.js route handlers)
- `GET /api/sites/similarweb` → `{ statuses: Record<siteId, SimilarwebStatus> }` (all sites, one query).
- `POST /api/sites/similarweb/import` `{ csv: string }` → `{ updated: number, ignored: number, rejected: Array<{ line: number; reason: string }>, unknown: string[] }`. Parsing happens server-side with the pure parser below; nothing is written when the CSV has no valid rows. Fast (one bulk write) — well under the ~60 s gateway limit.

## UI

### Sites list — column **Similarweb** (default visible)
- Cell: **✓ #79,692 · 1.34M/mo** (rank with thousands separators; visits compact: 1.34M / 568K / 6K; visits omitted when null) · **✗ No rank** · **No domain** (site without `custom_domain`) · **—** (domain but never checked). Text, not colour alone; green/red tint only as reinforcement.
- Header tooltip: "Similarweb global rank and monthly visits (last checked …)".
- Sortable: by rank ascending (Yes first, best rank first), then No, then never checked, then No domain.
- Filter: a "Similarweb" filter with All / Has rank / No rank / Not checked, using the table's existing filter controls.
- CSV export: the same text as the cell (`#79,692 · 1.34M/mo`, `No rank`, `No domain`, empty when never checked), through the existing `SITE_COLUMNS` `csv` accessor (one column per chooser column).
- Data loads lazily from `GET /api/sites/similarweb` the first time the column is visible (same pattern as the live-config columns).

### Sites list — **Update Similarweb data**
- A secondary button above the table opens a modal: a textarea to paste the results **or** a `.csv` file picker, then **Preview** → shows "56 rows · 21 Yes · 35 No · 0 unknown · 0 rejected" and lists any unknown/rejected rows → **Import**. Success toast: "Similarweb updated for 56 sites". The modal links to the checklist page and states the monthly routine in one line.

### Site page header — badge
- Next to the status badge: **Similarweb #79,692 · 1.34M/mo** / **Similarweb: no rank** / nothing for sites without a domain or never checked. Tooltip: "Checked Oct 11, 2026 (manual)".

## Units
| Unit | Responsibility |
|---|---|
| `src/lib/similarweb/parse.ts` | pure: CSV text → `{ rows: ParsedRow[]; rejected; ignored }`; number parsing (`1.34M`, `68,562`) |
| `src/lib/similarweb/match.ts` | pure: parsed rows + dashboard sites → `{ statuses: SimilarwebStatus[]; unknown }` |
| `src/lib/similarweb/format.ts` | pure: cell/badge text, compact visits, sort key, filter predicate, CSV value |
| `src/lib/db/similarweb.ts` | Mongo read-all / bulk upsert, index creation |
| `src/app/api/sites/similarweb/route.ts`, `…/import/route.ts` | the two endpoints |
| `src/lib/site-columns.ts` + `SitesTable.tsx` | column def (`source: "similarweb"`), lazy load, sort, filter |
| `src/components/dashboard/SimilarwebImportModal.tsx` | paste/upload → preview → import |
| `src/components/site-detail/SiteDetailHeader.tsx` | badge |
| `public/guide/similarweb.md` + `GUIDE_PAGES` | in-app guide page |

## Error handling
| Situation | Behaviour |
|---|---|
| CSV missing required columns (`similarweb` and one of `domain`/`site`) | Preview shows "This doesn't look like the checklist results — missing column X"; Import disabled |
| `yes` row without a valid rank | Row rejected with its line number; other rows still import |
| Unknown domain/site | Listed under "Not matched"; not stored |
| Mongo unavailable | Column shows "—" for all sites; import returns an error toast; the rest of the Sites page still works |
| Site renamed | Its status follows the new id on the next import (old document is left; harmless, reported nowhere) |

## Testing
- Unit: parser (quotes, CRLF, `1.34M`/`12.5K`/`68,562`, unchecked ignored, yes-without-rank rejected, missing columns), matcher (custom-domain match, `www.`, fallback to site id, unknown), format (cell text, compact visits, sort order, filter, CSV).
- API: import route with a mocked db — counts, nothing written on zero valid rows.
- RTL: column cell states incl. "No domain" and "—"; sort order; filter; import modal preview → import → toast; header badge.
- Manual: import the 2026-10-11 results on local, check the list and a site page; then on production after plug.

## Rollout
1. Merge + `grid plug`.
2. On the production dashboard: Update Similarweb data → paste the 2026-10-11 results → Import.
3. Monthly: re-run the checklist, paste, import.
4. Later (separate stage): REST API access → monthly automatic fetch writing the same documents with `source: "api"`.

## Out of scope
Visit history and trend charts; country-level data; automatic API fetching (D3, later stage); showing Similarweb data on the sites themselves.
