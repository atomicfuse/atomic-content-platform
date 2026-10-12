# Authors Stage 3: local end-to-end

Environment: `grid dev` (dashboard :3000, pipeline :5000), real OpenAI, writes to the real network repo (`main`).
Local end-to-end: all 10 checks passed (Asaf, 2026-10-12).
Automated: dashboard vitest 802/802, pipeline vitest 855/855, typecheck clean (2026-10-12).

| # | Check | Result |
|---|-------|--------|
| 1 | Sidebar → Authors: empty state ("No authors yet") | pass |
| 2 | New author → Generate with AI for coffeeactually → checklist reaches 5× Done in under ~2 min; portrait illustrated; bio 60 to 120 words, no credentials → Save author → lands on `/authors/<id>`; network repo has `authors/<id>.yaml` (one commit) | pass |
| 3 | Regenerate bio → unsaved bar shows "bio" → Discard restores; Regenerate again → Save author | pass |
| 4 | Upload a photo → square portrait; Remove → initials; Save author | pass |
| 5 | Click a sidebar link while dirty → "Leave without saving?" | pass |
| 6 | Library: search, each filter chip, sort; URL keeps them; back button restores | pass |
| 7 | Delete the test author → gone from the list; file removed from the repo (locally the site check reads each site.yaml from git, so it takes a few seconds) | pass |
| 8 | Guide → Authors page renders | pass |
| 9 | Generate missing profiles: close the dialog → status line keeps counting on the page; button disabled until done; cards fill in after each author | pass |
| 10 | Generate everything: text fills in part by part; typing a link during the run is kept; button disabled while running | pass |
