# Authors Stage 4: local end-to-end

Environment: `grid dev` (dashboard :3000, pipeline :5000), real OpenAI, writes to the real network repo.

## Migration dry run (read-only), 2026-10-12, before "Give every site an author"
- Sites read: 64 (deleted sites excluded). Library authors: 0.
- New library author: Ella Hughes, exclusive to scoopella; scoopella's `authors:` gets `ella-hughes`.
- Re-credited now: 0 (scoopella has no bad bylines).
- Waiting for site authors (bad bylines, counted on staging and on main, so published articles appear twice): 27 sites, 486 file copies (about 240 distinct articles). Largest: cleanmotiondaily 80, wineoceans 76, financenewsbase 52, medicalnewscorner 36, carsnewsmag 32, muvizzcom 28.
- After "Give every site an author" runs in production, the plan re-credits these to each site's new author.

## Checklist
| # | Check | Result |
|---|-------|--------|
| 1 | Author profile: Best fit Regenerate → 1–3 categories; Save; Good match for lists matching sites; library Best fit filter (`?v=`); card shows categories | pending |
| 2 | Site with no authors: previous-name line; Create author for this site → progress → new row → topic → Save authors → in library, exclusive to the site; reload keeps authors and topic split | pending |
| 3 | Add author exclusive to another site → asks first → Assign → Save → both sites under Exclusive to; remove again → Save | pending |
| 4 | Second author with own topics on one site → Save → each keeps topics; unassigned line clears | pending |
| 5 | Generate 2 articles on that site → frontmatter `author` + `author_id` of an assigned author | pending |
| 6 | Give every site an author with 2 test sites ticked (one with authors, one without) → one created, one skipped; status line + disabled button while running | pending |
| 7 | Migration plan summary reviewed by Asaf | pending |
