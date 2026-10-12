# Authors stage 2 — local end-to-end check (2026-10-11)

Local only: `wrangler dev` on the staging build with local KV (`--persist-to .wrangler/state`), seeded from a
network-repo `main` worktree. coffeeactually got `authors: [taylor-winters, ryan-powell, no-profile]`; profiles for
Taylor Winters and Ryan Powell (both real author names on the site), later one for `no-profile` with zero articles.
Nothing remote was written.

| Check | Request | Result |
|---|---|---|
| Homepage still renders | `/` | 200 |
| Author page | `/author/taylor-winters` | 200 |
| Assigned, no profile | `/author/no-profile` (before its profile) | 404 |
| Not assigned | `/author/ella-hughes` | 404 |
| ProfilePage JSON-LD | author page | present |
| Indexable with ≥3 articles | author page (75 articles) | no `noindex` |
| First page of cards | author page | 12 feed cards |
| Load More wired | author page | `data-endpoint="/api/author-articles?id=taylor-winters"` |
| Load More endpoint | `/api/author-articles?id=taylor-winters&page=2` | 200, 12 cards |
| Linked byline | `/5-simple-condensed-milk-desserts-to-make-at-home` | `href="/author/taylor-winters"` |
| About the author box | same article | present |
| Article JSON-LD author url | same article | `"url":"https://coffeeactually.com/author/taylor-winters"` |
| noindex with 0 articles | `/author/no-profile` (with profile) | 200, `noindex`, "No articles yet" |
| seed-authors prune | re-seed without `test-writer` | "pruned 1 deleted author(s)" |
| seed-kv under plain Node | `tsx scripts/seed-kv.ts` | loads (usage message) |

Unit suites: site-worker 606/606, content-pipeline 819/819, dashboard 762/762; `tsc` + `astro check` clean.
