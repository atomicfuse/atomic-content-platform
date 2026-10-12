# Authors Stage 4: Best fit, site authors, bylines and migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authors get "Best fit" site categories. Every site gets its own dedicated author (option A, chosen by Asaf 2026-10-12): per site from the Content Agent tab, or for all sites at once. Sites can have several authors with their own topics. New articles carry the right author with `author_id`. A reviewed migration brings Ella Hughes into the library (exclusive to scoopella) and re-credits the bad bylines (`admin`, `Editorial Team`, "… AI …"); the old generated default names are not migrated.

**Architecture:** Library authors stay in the network repo (`main`, `authors/<id>.yaml`, Stage 3 store). A site's authors live in its `site.yaml` `authors: [{ id, topics }]`, saved through the existing `/api/sites/save` dual-write (git → Mongo → revalidate). One pure dashboard module (`lib/authors/assignment.ts`) owns fit ranking, exclusive conflicts and topic distribution; the save route and the Authors section use it. New site authors are generated in the browser part by part (`lib/authors/site-author-flow.ts`), exclusive to their site. The pipeline resolves each article's byline from the site's `authors` (topic match, else rotation) and writes `author` + `author_id`. The migration is a plan → review → apply script that commits in local worktrees and prints push commands (same pattern as `brand-safe-slugs.ts`).

**Tech Stack:** Next.js 15 (dashboard), Node + vitest (content pipeline), React Testing Library, `yaml`, Octokit/git worktrees, MongoDB driver 7.

**Spec:** `docs/superpowers/specs/2026-10-08-authors-design.md` (roadmap: `docs/superpowers/plans/2026-10-08-authors-roadmap.md`). Builds on Stage 2 (`3dfc7cf`), Stage 3 (`c8dfab4`, `72bcc00`).

## Global Constraints

- TypeScript strict, no `any`, explicit return types; React components return `React.ReactElement`.
- Author records: git only (network repo `main`, `authors/<id>.yaml`) via `lib/authors/store.ts` — no Mongo mirror (Stage 3 ruling).
- Site config writes go through `/api/sites/save` (git commit on the staging branch → `upsertSiteConfig` → `revalidatePath`). Never commit site config without the Mongo upsert.
- Every dashboard request stays well under the ~60 s CloudGrid limit: one slow external call per request; AI generation is chained in the browser (`lib/authors/generate-flow.ts`).
- Option A: one dedicated author per site. Authors created for a site are exclusive to it (`exclusive_sites: [<site>]`). A human may still assign any author to another site; that site is then appended to their `exclusive_sites` after a confirm (D2). Nothing is assigned automatically without a person starting it.
- Spec deviations (Asaf, 2026-10-12): no AI ranker and no automatic picking of existing authors (D4); the wizard is unchanged (new sites get their author from the site's Authors section or the bulk action); the migration does not turn generated default names into library authors (D7).
- Grid sites have no authors: the Authors section and the bulk action skip them.
- Visible copy: no em-dashes, no emoji icons (Heroicons-style 1.5-stroke SVG), 44 px primary targets, existing tokens (`--bg-surface`, `--bg-elevated`, `--border-primary`, `text-cyan`), `Button`/`Modal`/`useToast`.
- Pipeline frontmatter keeps `author: <name>` and adds `author_id: <id>` only when the name comes from a library author assigned to the site.
- Migration: dry plan first, Asaf reviews it; apply commits locally and **never pushes**.
- `verticals:` is dashboard-only: the site worker's seed parser ignores it (checked: `scripts/lib/authors-seed.ts` reads named fields only).
- No commit, push, plug or deploy until Asaf has tested locally and approved (standing rule). Deploys are batched at the end of Stage 4.

## Review Focus

1. A topic renamed or deleted on the site after authors were assigned → the stale topic is dropped from the author on the next save, and the freed/new topics are split among the authors; nothing crashes (test in Task 3).
2. An author whose `authors/<id>.yaml` is missing or broken but who is still listed in a site's `authors` → new articles skip to the next author (or the legacy name), never "undefined" or a crash (test in Task 7).
3. Saving a site whose authors include an exclusive author without a confirm (stale tab, crafted request) → 409 naming the author; nothing is written (test in Task 4).
4. Migration re-run after apply (idempotent) → nothing to do, no second commit (test in Task 8).
5. Re-crediting an article must change only the header's `author:` line (plus `author_id:`), never text in the body that happens to start with "author:" (test in Task 8).

---

## File structure

| File | Responsibility |
|---|---|
| `services/content-pipeline/src/authors/text.ts`, `http.ts`, `generate.ts` | New text part `verticals` (pick 1–3 from a supplied list) |
| `services/dashboard/src/lib/authors/types.ts`, `record.ts`, `generate-flow.ts`, `library.ts` | `verticals` on the record, generation order, library filter |
| `services/dashboard/src/components/authors/AuthorProfileEditor.tsx`, `AuthorsLibrary.tsx`, `AuthorCard.tsx`, `useMissingProfilesRun.ts` | Best fit section, Good match for, vertical filter and tag |
| `services/dashboard/src/lib/authors/assignment.ts` (new) | Pure: fit, ranking, exclusive conflicts, topic distribution, normalising |
| `services/dashboard/src/lib/authors/site-author-flow.ts` (new) | Generate a dedicated author for one site (browser, part by part) |
| `services/dashboard/src/lib/authors/site-assignment.ts` (new) | Server: validate + exclusive append + distribute (used by the save route) |
| `services/dashboard/src/app/api/sites/save/route.ts`, `actions/wizard.ts` (`StagingSiteConfig`) | `authors` + `confirmedExclusive` in the save |
| `services/dashboard/src/components/site-detail/SiteAuthorsSection.tsx` (new) | Content Agent tab Authors section (replaces "Default Author") |
| `services/dashboard/src/components/authors/useAssignAllRun.ts`, `AssignAllModal.tsx` (new), `AuthorsPageClient.tsx` | "Give every site an author" |
| `services/content-pipeline/src/authors/bylines.ts` (new), `byline-reader.ts` (new) | Article author by topic / rotation, `author_id` |
| `services/content-pipeline/src/types.ts`, `lib/site-brief.ts`, `agents/content-generation/agent.ts`, `dedicated-agent.ts`, `agents/scheduled-publisher/index.ts`, `queue/content-generation.ts` | Thread site `authors` to the writer |
| `services/content-pipeline/src/scripts/migrate-authors-lib.ts`, `migrate-authors.ts` (new) | Migration (Ella + bad bylines): plan + apply |
| `services/dashboard/public/guide/26-authors.md`, `docs/test-results/authors-stage4/README.md` | Guide + local end-to-end record |

---

### Task 1: Pipeline: `verticals` generation part

**Files:**
- Modify: `services/content-pipeline/src/authors/text.ts`, `src/authors/http.ts`, `src/authors/generate.ts`
- Test: `services/content-pipeline/src/authors/__tests__/text.test.ts`, `__tests__/http.test.ts`, `__tests__/generate.test.ts`

**Interfaces:**
- Produces: `TextPart = "name" | "tagline" | "bio" | "beats" | "verticals"`; `buildTextPrompt(part, draft, ctx, takenNames, rng = Math.random, verticalOptions: string[] = [])`; `parseTextPart(part, raw, takenNames, verticalOptions: string[] = [])`; `GenerateRequest.verticalOptions?: string[]`; request body field `verticalOptions: string[]` (required when `part === "verticals"`). Endpoint value for `verticals`: `string[]` (1–3 names, spelled exactly as in the options).

- [ ] **Step 1: Write the failing tests**

Append to `src/authors/__tests__/text.test.ts`:

```ts
describe("verticals part", () => {
  const OPTIONS = ["Travel", "Food & Drink", "Entertainment", "Home & Garden"];
  it("prompt lists the allowed categories", () => {
    const p = buildTextPrompt("verticals", { name: "Maya Ortiz", beats: ["Coffee", "Cafes"] }, {}, [], () => 0, OPTIONS);
    expect(p.user).toContain("Travel | Food & Drink | Entertainment | Home & Garden");
  });
  it("keeps 1–3 names from the list, fixing case and dropping unknown or repeated ones", () => {
    expect(parseTextPart("verticals", '{"verticals":["food & drink","Travel","Cooking","travel"]}', [], OPTIONS))
      .toEqual({ ok: true, value: ["Food & Drink", "Travel"] });
  });
  it("rejects none or more than three valid picks", () => {
    expect(parseTextPart("verticals", '{"verticals":["Cooking"]}', [], OPTIONS)).toMatchObject({ ok: false });
    expect(parseTextPart("verticals", '{"verticals":["Travel","Food & Drink","Entertainment","Home & Garden"]}', [], OPTIONS)).toMatchObject({ ok: false });
  });
});
```

Append inside the `describe("parseGenerateBody", …)` block of `src/authors/__tests__/http.test.ts` (before its closing `});`):

```ts
  it("verticals needs the option list; other parts don't", () => {
    expect(() => parseGenerateBody('{"part":"verticals","draft":{}}')).toThrow(/verticalOptions/);
    expect(parseGenerateBody('{"part":"verticals","draft":{},"verticalOptions":["Travel"]}').verticalOptions).toEqual(["Travel"]);
  });
```

Append to `src/authors/__tests__/generate.test.ts`:

```ts
describe("generateAuthorPart verticals", () => {
  it("passes the options to the prompt and the parser", async () => {
    const d = deps(['{"verticals":["travel"]}']);
    const out = await generateAuthorPart({ part: "verticals", draft: { beats: ["Hiking"] }, siteContext: {}, takenNames: [], verticalOptions: ["Travel", "Science"] }, d);
    expect(out.value).toEqual(["Travel"]);
    expect(d.calls[0]).toContain("Travel | Science");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && npx vitest run src/authors`
Expected: FAIL (verticals is not a part; `verticalOptions` unknown).

- [ ] **Step 3: Implement**

`src/authors/text.ts`:
- Change `export type TextPart = "name" | "tagline" | "bio" | "beats";` to `export type TextPart = "name" | "tagline" | "bio" | "beats" | "verticals";`.
- Add to `ASK`:

```ts
  verticals: 'Choose the 1–3 site categories this author fits best, using ONLY names from the "Categories" list below, spelled exactly as listed. Return {"verticals": ["...", "..."]}.',
```

- Replace `buildTextPrompt` with:

```ts
export function buildTextPrompt(
  part: TextPart, draft: AuthorDraft, ctx: SiteContext, takenNames: string[], rng: () => number = Math.random,
  verticalOptions: string[] = [],
): { system: string; user: string } {
  const taken = part === "name" && takenNames.length > 0 ? `\nNames already used (do not reuse): ${takenNames.join(", ")}` : "";
  const heritage = part === "name"
    ? `\nName heritage: ${NAME_HERITAGES[Math.min(NAME_HERITAGES.length - 1, Math.floor(rng() * NAME_HERITAGES.length))]}. Use a natural, everyday first and last name a person of that heritage writing for an English-language site could have (not a stereotype, not a famous person).`
    : "";
  const categories = part === "verticals" ? `\nCategories: ${verticalOptions.join(" | ")}` : "";
  const ctxText = contextLines(draft, ctx);
  return { system: SYSTEM, user: `${ctxText ? `${ctxText}\n\n` : ""}${ASK[part]}${heritage}${categories}${taken}` };
}
```

- Change the `parseTextPart` signature to `export function parseTextPart(part: TextPart, raw: string, takenNames: string[], verticalOptions: string[] = []): …` and insert, right after `const v = obj[part];`:

```ts
  if (part === "verticals") {
    if (!Array.isArray(v)) return { ok: false, reason: "verticals must be an array" };
    const byKey = new Map(verticalOptions.map((o) => [o.toLowerCase(), o]));
    const picked = [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => byKey.get(x.trim().toLowerCase())).filter((x): x is string => !!x))];
    return picked.length >= 1 && picked.length <= 3 ? { ok: true, value: picked } : { ok: false, reason: "pick 1–3 categories from the Categories list, spelled exactly" };
  }
```

`src/authors/http.ts`:
- `const PARTS: ReadonlySet<AuthorPart> = new Set(["name", "tagline", "bio", "beats", "verticals", "portrait"]);` and update the error text to `"part must be name, tagline, bio, beats, verticals or portrait"`.
- Before the `return {`, add:

```ts
  const verticalOptions = strs(body.verticalOptions)?.map((o) => o.trim()).filter(Boolean) ?? [];
  if (part === "verticals" && verticalOptions.length === 0) throw new AuthorGenerateError("verticals needs verticalOptions", 400);
```

- In the returned object add `...(part === "verticals" ? { verticalOptions } : {}),`.

`src/authors/generate.ts`:
- `GenerateRequest` gains `/** Allowed names for the "verticals" part. */ verticalOptions?: string[];`.
- In `generateAuthorPart`, replace the prompt and parse calls:

```ts
  const prompt = buildTextPrompt(req.part, req.draft, req.siteContext, req.takenNames, Math.random, req.verticalOptions ?? []);
```

```ts
    const parsed = parseTextPart(req.part, out.text, req.takenNames, req.verticalOptions ?? []);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && npx vitest run src/authors && pnpm typecheck`
Expected: PASS, typecheck clean.

---

### Task 2: Dashboard: Best fit on the author (record, generation, editor, library)

**Files:**
- Modify: `services/dashboard/src/lib/authors/types.ts`, `record.ts`, `generate-flow.ts`, `library.ts`
- Modify: `services/dashboard/src/components/authors/AuthorProfileEditor.tsx`, `AuthorsLibrary.tsx`, `AuthorCard.tsx`, `useMissingProfilesRun.ts`
- Modify: `services/dashboard/src/app/authors/[id]/page.tsx`, `src/app/authors/new/page.tsx`
- Test: `src/lib/authors/__tests__/record.test.ts`, `generate-flow.test.ts`, `library.test.ts`, `src/components/authors/__tests__/AuthorProfileEditor.test.tsx`, `AuthorsLibrary.test.tsx`

**Interfaces:**
- Consumes: Task 1 body field `verticalOptions`, part `"verticals"`.
- Produces: `AuthorRecord.verticals: string[]` (also on `AuthorInput`, `AuthorListItem`); `AuthorPart` includes `"verticals"`; `ALL_PARTS = ["name", "tagline", "bio", "beats", "verticals", "portrait"]`; `generatePart(part, draft, opts: { …; verticalOptions?: string[] })`; `runParts(…, opts: { …; verticalOptions?: string[] })`; `missingParts(a: Pick<AuthorRecord, "tagline" | "bio" | "beats" | "verticals" | "portrait">)`; `filterAuthors(items, q, filter, sort, vertical = "")`; `verticalsIn(items): string[]`; editor prop `sites: Array<{ domain: string; vertical?: string }>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/authors/__tests__/record.test.ts` — append:

```ts
describe("verticals (Best fit)", () => {
  it("round-trips through YAML and defaults to []", () => {
    const a = parseAuthorYaml("ann-lee", "id: ann-lee\nname: Ann Lee\nverticals: [Travel, Food & Drink]\n")!;
    expect(a.verticals).toEqual(["Travel", "Food & Drink"]);
    expect(parseAuthorYaml("ann-lee", serializeAuthor(a))!.verticals).toEqual(["Travel", "Food & Drink"]);
    expect(parseAuthorYaml("bo-kim", "id: bo-kim\nname: Bo Kim\n")!.verticals).toEqual([]);
  });
  it("accepts at most 3", () => {
    expect(validateAuthorInput({ name: "Ann Lee", verticals: ["A", "B", "C", "D"] })).toMatchObject({ ok: false });
    expect(validateAuthorInput({ name: "Ann Lee", verticals: ["Travel"] })).toMatchObject({ ok: true, value: { verticals: ["Travel"] } });
  });
});
```

`src/lib/authors/__tests__/generate-flow.test.ts` — append:

```ts
describe("verticals in generation", () => {
  it("is generated after beats with the option list, and counts as missing when empty", async () => {
    expect(ALL_PARTS).toEqual(["name", "tagline", "bio", "beats", "verticals", "portrait"]);
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
      return ok(["Travel"]);
    });
    await runParts(["verticals"], { name: "Maya Ortiz" }, { authorIdFor: () => "maya-ortiz", takenNames: [], verticalOptions: ["Travel", "Science"] }, () => undefined, fetchFn as unknown as typeof fetch);
    expect(bodies[0]).toMatchObject({ part: "verticals", verticalOptions: ["Travel", "Science"] });
    const a = { name: "A B", tagline: "t", bio: "b", beats: ["X", "Y"], verticals: [], portrait: { kind: "generated", path: "/authors/assets/a-0123456789.webp" } } as unknown as AuthorRecord;
    expect(missingParts(a)).toEqual(["verticals"]);
  });
});
```

`src/lib/authors/__tests__/library.test.ts` — append (reuse the file's existing item factory; if it has none, add `const mk = (id: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({ id, name: id, tagline: "", bio: "Bio", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [], created_at: "", updated_at: "", sites: [], ...extra });` and import `AuthorListItem`):

```ts
describe("vertical filter", () => {
  it("keeps authors whose Best fit includes the vertical (any case); lists the verticals in use", () => {
    const items = [mk("a", { verticals: ["Travel"] }), mk("b", { verticals: ["Food & Drink", "travel"] }), mk("c")];
    expect(filterAuthors(items, "", "all", "name", "TRAVEL").map((x) => x.id)).toEqual(["a", "b"]);
    expect(verticalsIn(items)).toEqual(["Food & Drink", "Travel"]);
  });
});
```

`src/components/authors/__tests__/AuthorProfileEditor.test.tsx` — add at the top, after the existing `vi.mock` lines:

```ts
vi.mock("@/hooks/useReferenceData", () => ({
  useVerticals: () => ({ verticals: [{ id: "1", name: "Travel", iab_code: "" }, { id: "2", name: "Food & Drink", iab_code: "" }], loading: false }),
}));
```

and append inside the main `describe` (`ELLA` must gain `verticals: []` in its literal):

```ts
  it("Best fit: regenerate sends the network's categories; Good match for lists matching sites not yet using the author", async () => {
    respond({ verticals: ["Travel"] });
    render(<AuthorProfileEditor author={{ ...ELLA, sites: [{ site: "journeypeaks", topics: [] }] }} mode="edit" sites={[{ domain: "journeypeaks", vertical: "Travel" }, { domain: "geekytraveler", vertical: "Travel" }, { domain: "coffeeactually", vertical: "Food & Drink" }]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate verticals" }));
    const call = vi.mocked(global.fetch).mock.calls.find(([, i]) => String(i?.body).includes('"part":"verticals"'))!;
    expect(JSON.parse(String(call[1]!.body)).verticalOptions).toEqual(["Travel", "Food & Drink"]);
    const match = await screen.findByRole("list", { name: "Good match for" });
    expect(within(match).getAllByRole("link").map((l) => l.textContent)).toEqual(["geekytraveler"]);
  });
```

`src/components/authors/__tests__/AuthorsLibrary.test.tsx` — the `mk` factory gains `verticals: []`; append:

```ts
  it("vertical filter is in the URL; cards show the Best fit categories as text", async () => {
    render(<AuthorsLibrary authors={[mk("ella-hughes", { name: "Ella Hughes", verticals: ["Entertainment"] }), mk("ben-foster", { name: "Ben Foster" })]} />);
    expect(document.querySelector("[data-verticals]")?.textContent).toBe("Entertainment");
    await userEvent.selectOptions(screen.getByLabelText("Best fit"), "Entertainment");
    expect(replace).toHaveBeenCalledWith("/authors?v=Entertainment", { scroll: false });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/dashboard && npx vitest run src/lib/authors src/components/authors`
Expected: FAIL (no `verticals`, no `verticalsIn`, no Best fit UI).

- [ ] **Step 3: Implement the data side**

`types.ts`: in `AuthorRecord` after `beats: string[];` add `/** Best-fit site categories (dashboard-index verticals), 0–3. Dashboard-only. */ verticals: string[];`. Change `AuthorPart` to `"name" | "tagline" | "bio" | "beats" | "verticals" | "portrait"`.

`record.ts`:
- `parseAuthorYaml` return: after `beats: strList(d.beats),` add `verticals: strList(d.verticals),`.
- `serializeAuthor` doc: after `beats: a.beats,` add `verticals: a.verticals,`.
- `validateAuthorInput`: after the beats check add

```ts
  const verticals = strList(i.verticals);
  if (verticals.length > 3) return { ok: false, error: "At most 3 best-fit categories" };
```

  and add `verticals,` to the returned `value` (after `beats,`).

`generate-flow.ts`:
- `export const ALL_PARTS: AuthorPart[] = ["name", "tagline", "bio", "beats", "verticals", "portrait"];`
- `generatePart` opts type gains `verticalOptions?: string[]`; in the body add `...(part === "verticals" ? { verticalOptions: opts.verticalOptions ?? [] } : {}),`.
- `runParts` opts gain `verticalOptions?: string[];` and its `generatePart` call passes `verticalOptions: opts.verticalOptions`.
- Replace `missingParts`:

```ts
export function missingParts(a: Pick<AuthorRecord, "tagline" | "bio" | "beats" | "verticals" | "portrait">): AuthorPart[] {
  const parts: AuthorPart[] = [];
  if (!a.bio.trim()) {
    if (!a.tagline.trim()) parts.push("tagline");
    parts.push("bio");
    if (a.beats.length === 0) parts.push("beats");
  }
  if (!a.verticals?.length) parts.push("verticals");
  if (!a.portrait) parts.push("portrait");
  return parts;
}
```

`library.ts`: change `filterAuthors` to take `vertical = ""` as a 5th parameter and filter with `const v = vertical.trim().toLowerCase();` … `items.filter((a) => matches[filter](a) && hit(a) && (!v || (a.verticals ?? []).some((x) => x.toLowerCase() === v)))`. Add:

```ts
/** The Best-fit categories used by any author, de-duplicated case-insensitively, sorted. */
export function verticalsIn(items: Array<Pick<AuthorListItem, "verticals">>): string[] {
  const seen = new Map<string, string>();
  for (const a of items) for (const v of a.verticals ?? []) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
```

`useMissingProfilesRun.ts`: at the start of `run`, `const verticalOptions = (await getVerticals().catch(() => [])).map((v) => v.name);` (import `getVerticals` from `@/lib/reference-data`) and pass `verticalOptions` in the `runParts` opts. If `verticalOptions` is empty, filter `"verticals"` out of `missingParts(a)` before calling `runParts` (the endpoint refuses an empty list).

- [ ] **Step 4: Implement the editor and library UI**

`AuthorProfileEditor.tsx`:
- Props: `sites: Array<{ domain: string; vertical?: string }>`.
- `EMPTY` gains `verticals: []`; `toInput` copies `verticals: a.verticals ?? []`; `PART_LABEL` gains `verticals: "Best fit"`; `FIELD_PART` gains `verticals: "best fit"`.
- `import { useVerticals } from "@/hooks/useReferenceData";` and inside the component: `const { verticals: verticalItems } = useVerticals(); const verticalOptions = verticalItems.map((v) => v.name);`.
- Pass `verticalOptions` in both `generatePart(...)` (inside `regenerate`) and `runParts(...)` (inside `generateEverything`) opts. In `generateEverything`, use `ALL_PARTS.filter((p) => p !== "verticals" || verticalOptions.length > 0)`.
- After the Beats `SectionCard`, add:

```tsx
          <SectionCard eyebrow="Best fit" action={<RegenerateButton part="verticals" busy={!!busy.verticals} locked={running || verticalOptions.length === 0} onClick={(): void => { void regenerate("verticals"); }} />}>
            <ChipMultiSelect
              label="Site categories this author fits"
              addLabel="+ Category"
              value={draft.verticals}
              options={[...new Set([...verticalOptions, ...draft.verticals])].map((v) => ({ value: v, label: v }))}
              onChange={(next): void => setDraft((d) => ({ ...d, verticals: next.slice(0, 3) }))}
              emptyText="No categories yet"
            />
            {errors.verticals && <p role="alert" className="text-xs text-red-400">{errors.verticals}</p>}
            {goodMatch.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-[var(--text-muted)]">Good match for</p>
                <ul aria-label="Good match for" className="flex flex-wrap gap-1.5">
                  {goodMatch.slice(0, 8).map((s) => (
                    <li key={s.domain}><a href={`/sites/${s.domain}`} className="inline-flex min-h-8 items-center rounded-full border border-[var(--border-primary)] px-3 text-xs text-[var(--text-primary)] hover:border-cyan/60">{s.domain}</a></li>
                  ))}
                  {goodMatch.length > 8 && <li className="px-1 text-xs text-[var(--text-muted)]">and {goodMatch.length - 8} more</li>}
                </ul>
              </div>
            )}
          </SectionCard>
```

  with, above the `return`:

```ts
  const onSites = new Set((author?.sites ?? []).map((s) => s.site));
  const wantedVerticals = new Set(draft.verticals.map((v) => v.toLowerCase()));
  const goodMatch = sites.filter((s) => s.vertical && wantedVerticals.has(s.vertical.toLowerCase()) && !onSites.has(s.domain));
```

`src/app/authors/[id]/page.tsx` and `src/app/authors/new/page.tsx`: `sites={index.sites.map((s) => ({ domain: s.domain, vertical: s.vertical || undefined }))}`.

`AuthorsLibrary.tsx`: read `const vertical = params.get("v") ?? "";`, compute `const verticalOptions = useMemo(() => verticalsIn(authors), [authors]);`, call `filterAuthors(authors, q, filter, sort, vertical)`, and next to the sort `<select>` add (only when `verticalOptions.length > 0`):

```tsx
        <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          Best fit
          <select aria-label="Best fit" value={vertical} onChange={(e): void => setParam("v", e.target.value, "")} className="min-h-11 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)]">
            <option value="">Any</option>
            {verticalOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
```

`AuthorCard.tsx`: under the tagline `<p>`, add `{author.verticals?.length > 0 && <p data-verticals className="truncate text-[11px] font-medium text-cyan">{author.verticals.join(" · ")}</p>}`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/dashboard && npx vitest run src/lib/authors src/components/authors && pnpm typecheck`
Expected: PASS, typecheck clean. Fix any other `AuthorRecord` literal the typecheck flags (tests and fixtures) by adding `verticals: []`.

---

### Task 3: Assignment logic (pure)

**Files:**
- Create: `services/dashboard/src/lib/authors/assignment.ts`
- Modify: `services/dashboard/src/lib/authors/types.ts`
- Test: `services/dashboard/src/lib/authors/__tests__/assignment.test.ts`

**Interfaces:**
- Consumes: `AuthorRecord` (Task 2, with `verticals`), `AUTHOR_ID_RE` from `record.ts`.
- Produces (types in `types.ts`): `SiteAuthor { id: string; topics: string[] }`, `AuthorFit = "strong" | "close" | "none"`. Functions in `assignment.ts`:
  - `interface SiteFitContext { site: string; vertical?: string; topics: string[] }`
  - `fitOf(a: Pick<AuthorRecord, "beats" | "verticals" | "tagline">, ctx: SiteFitContext): AuthorFit`
  - `interface RankedAuthor { author: AuthorRecord; fit: AuthorFit; exclusiveElsewhere: boolean }`
  - `rankForSite(authors: AuthorRecord[], ctx: SiteFitContext, assigned: string[]): RankedAuthor[]`
  - `distributeTopics(assignments: SiteAuthor[], siteTopics: string[], rng: () => number = Math.random): SiteAuthor[]`
  - `exclusiveConflicts(assignments: SiteAuthor[], authors: AuthorRecord[], site: string): AuthorRecord[]`
  - `normalizeSiteAuthors(raw: unknown): SiteAuthor[]`
  - `siteTopicsOf(config: Record<string, unknown> | null | undefined): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// services/dashboard/src/lib/authors/__tests__/assignment.test.ts
import { describe, expect, it } from "vitest";
import { distributeTopics, exclusiveConflicts, fitOf, normalizeSiteAuthors, rankForSite, siteTopicsOf } from "../assignment";
import type { AuthorRecord } from "../types";

const mk = (id: string, extra: Partial<AuthorRecord> = {}): AuthorRecord => ({
  id, name: id.replace(/-/g, " "), tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {},
  exclusive_sites: [], created_at: "", updated_at: "", ...extra,
});
const SITE = { site: "journeypeaks", vertical: "Travel", topics: ["Hiking Trails", "Budget Travel", "Road Trips"] };

describe("fitOf", () => {
  it("strong = same vertical and a shared topic word; close = one of the two; none = neither", () => {
    expect(fitOf(mk("a", { verticals: ["travel"], beats: ["Hiking"] }), SITE)).toBe("strong");
    expect(fitOf(mk("b", { verticals: ["Travel"], beats: ["Museums"] }), SITE)).toBe("close");
    expect(fitOf(mk("c", { beats: ["Road trips"] }), SITE)).toBe("close");
    expect(fitOf(mk("d", { beats: ["Celebrities"] }), SITE)).toBe("none");
  });
  it("ignores filler words so 'News' or 'and' never count as a match", () => {
    expect(fitOf(mk("e", { beats: ["Car news and reviews"] }), { site: "x", topics: ["Celebrity news"] })).toBe("none");
  });
});

describe("rankForSite", () => {
  const lib = [
    mk("strong-one", { verticals: ["Travel"], beats: ["Hiking"] }),
    mk("close-one", { beats: ["Road trips"] }),
    mk("exclusive-one", { verticals: ["Travel"], beats: ["Hiking"], exclusive_sites: ["scoopella"] }),
    mk("unrelated", { beats: ["Celebrities"] }),
    mk("already", { verticals: ["Travel"], beats: ["Hiking"] }),
  ];
  it("ranks strong, then close, then none; skips authors already on the site; flags exclusive elsewhere", () => {
    const r = rankForSite(lib, SITE, ["already"]);
    expect(r.map((x) => [x.author.id, x.fit, x.exclusiveElsewhere])).toEqual([
      ["strong-one", "strong", false], ["exclusive-one", "strong", true], ["close-one", "close", false], ["unrelated", "none", false],
    ]);
  });
});

describe("distributeTopics", () => {
  const seq = (...v: number[]): (() => number) => { let i = 0; return () => v[i++ % v.length]!; };
  it("keeps chosen topics, gives every unassigned topic to an author, and is stable on re-save", () => {
    const out = distributeTopics([{ id: "a", topics: ["Hiking Trails"] }, { id: "b", topics: [] }], SITE.topics, seq(0.1, 0.9));
    expect(out.flatMap((x) => x.topics).sort()).toEqual([...SITE.topics].sort());
    expect(out.find((x) => x.id === "a")!.topics).toContain("Hiking Trails");
    expect(distributeTopics(out, SITE.topics, seq(0.5))).toEqual(out);
  });
  it("drops topics the site no longer has and fixes their case", () => {
    const out = distributeTopics([{ id: "a", topics: ["hiking trails", "Old Topic"] }], ["Hiking Trails"], seq(0.5));
    expect(out).toEqual([{ id: "a", topics: ["Hiking Trails"] }]);
  });
  it("no site topics: keeps what was chosen; no authors: returns []", () => {
    expect(distributeTopics([{ id: "a", topics: ["X"] }], [], seq(0.5))).toEqual([{ id: "a", topics: ["X"] }]);
    expect(distributeTopics([], SITE.topics, seq(0.5))).toEqual([]);
  });
});

describe("exclusiveConflicts / normalizeSiteAuthors / siteTopicsOf", () => {
  it("an author exclusive to another site conflicts; one already exclusive to this site doesn't", () => {
    const lib = [mk("ella-hughes", { exclusive_sites: ["scoopella"] }), mk("own", { exclusive_sites: ["journeypeaks"] }), mk("free")];
    expect(exclusiveConflicts([{ id: "ella-hughes", topics: [] }, { id: "own", topics: [] }, { id: "free", topics: [] }], lib, "journeypeaks").map((a) => a.id)).toEqual(["ella-hughes"]);
  });
  it("normalizes: valid ids only, no duplicates, trimmed unique topics", () => {
    expect(normalizeSiteAuthors([{ id: "a", topics: [" X ", "x", 3] }, { id: "a" }, { id: "../bad" }, "junk"])).toEqual([{ id: "a", topics: ["X"] }]);
  });
  it("site topics come from topics_v2 names, else brief.topics", () => {
    expect(siteTopicsOf({ brief: { topics_v2: [{ name: "A" }, { name: "B" }], topics: ["Z"] } })).toEqual(["A", "B"]);
    expect(siteTopicsOf({ brief: { topics: ["Z"] } })).toEqual(["Z"]);
    expect(siteTopicsOf(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && npx vitest run src/lib/authors/__tests__/assignment.test.ts`
Expected: FAIL ("Failed to resolve import ../assignment").

- [ ] **Step 3: Implement**

`types.ts` — append:

```ts
/** One author on a site (`site.yaml` `authors:`), with the topics they write. */
export interface SiteAuthor {
  id: string;
  topics: string[];
}

/** How well a library author suits a site. */
export type AuthorFit = "strong" | "close" | "none";
```

```ts
// services/dashboard/src/lib/authors/assignment.ts
import { AUTHOR_ID_RE } from "./record";
import type { AuthorFit, AuthorRecord, SiteAuthor } from "./types";

/**
 * Who fits a site (for the Add author list), exclusive conflicts, and how a site's topics are split among its
 * authors. Shared by the site save route and the Authors section. Deterministic (no AI ranker): Best-fit
 * verticals plus shared topic words decide the fit.
 */
export interface SiteFitContext {
  site: string;
  vertical?: string;
  topics: string[];
}

export interface RankedAuthor {
  author: AuthorRecord;
  fit: AuthorFit;
  /** Exclusive to other sites: may be assigned by hand only, after a confirm. */
  exclusiveElsewhere: boolean;
}

const FILLER = new Set(["and", "the", "for", "with", "news", "tips", "guide", "guides", "best", "your", "from", "about", "more", "all", "new"]);

function words(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    for (const raw of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || FILLER.has(raw)) continue;
      out.add(raw.length > 4 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
    }
  }
  return out;
}

export function fitOf(a: Pick<AuthorRecord, "beats" | "verticals" | "tagline">, ctx: SiteFitContext): AuthorFit {
  const vertical = ctx.vertical?.trim().toLowerCase();
  const verticalHit = !!vertical && (a.verticals ?? []).some((v) => v.toLowerCase() === vertical);
  const topicWords = words(ctx.topics);
  const shared = [...words([...a.beats, a.tagline])].some((w) => topicWords.has(w));
  if (verticalHit && shared) return "strong";
  return verticalHit || shared ? "close" : "none";
}

const FIT_ORDER: Record<AuthorFit, number> = { strong: 0, close: 1, none: 2 };

export function rankForSite(authors: AuthorRecord[], ctx: SiteFitContext, assigned: string[]): RankedAuthor[] {
  const taken = new Set(assigned);
  return authors
    .filter((a) => !taken.has(a.id))
    .map((author) => ({
      author,
      fit: fitOf(author, ctx),
      exclusiveElsewhere: author.exclusive_sites.length > 0 && !author.exclusive_sites.includes(ctx.site),
    }))
    .sort((x, y) => FIT_ORDER[x.fit] - FIT_ORDER[y.fit] || Number(x.exclusiveElsewhere) - Number(y.exclusiveElsewhere) || x.author.name.localeCompare(y.author.name));
}

function shuffled<T>(list: T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * D3: topics an author already has stay with them (spelled as the site spells them; topics the site dropped are
 * removed); every topic nobody has goes to one author, round-robin over a shuffled order. Saved, so stable.
 */
export function distributeTopics(assignments: SiteAuthor[], siteTopics: string[], rng: () => number = Math.random): SiteAuthor[] {
  if (assignments.length === 0) return [];
  const known = new Map(siteTopics.map((t) => [t.toLowerCase(), t]));
  const out = assignments.map((a) => ({
    id: a.id,
    topics: siteTopics.length === 0
      ? [...a.topics]
      : [...new Set(a.topics.map((t) => known.get(t.toLowerCase())).filter((t): t is string => !!t))],
  }));
  const taken = new Set(out.flatMap((a) => a.topics.map((t) => t.toLowerCase())));
  const free = siteTopics.filter((t) => !taken.has(t.toLowerCase()));
  const order = shuffled(out.map((_, i) => i), rng);
  free.forEach((t, i) => out[order[i % order.length]!]!.topics.push(t));
  return out;
}

export function exclusiveConflicts(assignments: SiteAuthor[], authors: AuthorRecord[], site: string): AuthorRecord[] {
  const byId = new Map(authors.map((a) => [a.id, a]));
  return assignments
    .map((s) => byId.get(s.id))
    .filter((a): a is AuthorRecord => !!a && a.exclusive_sites.length > 0 && !a.exclusive_sites.includes(site));
}

export function normalizeSiteAuthors(raw: unknown): SiteAuthor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteAuthor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, topics } = entry as { id?: unknown; topics?: unknown };
    if (typeof id !== "string" || !AUTHOR_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const clean = Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
    const unique = new Map(clean.map((t) => [t.toLowerCase(), t]));
    out.push({ id, topics: [...unique.values()] });
  }
  return out;
}

export function siteTopicsOf(config: Record<string, unknown> | null | undefined): string[] {
  const brief = (config?.brief ?? {}) as { topics_v2?: unknown; topics?: unknown };
  if (Array.isArray(brief.topics_v2) && brief.topics_v2.length > 0) {
    return brief.topics_v2.map((t) => (t && typeof t === "object" ? (t as { name?: unknown }).name : null)).filter((n): n is string => typeof n === "string" && !!n.trim());
  }
  return Array.isArray(brief.topics) ? brief.topics.filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/dashboard && npx vitest run src/lib/authors/__tests__/assignment.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

---

### Task 4: Save a site's authors (server)

**Files:**
- Create: `services/dashboard/src/lib/authors/site-assignment.ts`
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`, `services/dashboard/src/actions/wizard.ts` (`StagingSiteConfig`, ~line 1008)
- Test: `services/dashboard/src/lib/authors/__tests__/site-assignment.test.ts`

**Interfaces:**
- Consumes: Task 3 `normalizeSiteAuthors`, `exclusiveConflicts`, `distributeTopics`, `siteTopicsOf`; Stage 3 `listAuthors`, `updateAuthor` (`store.ts`).
- Produces: `applySiteAuthors(site: string, raw: unknown, siteTopics: string[], confirmedExclusive: string[], deps?: { listAuthors(): Promise<AuthorRecord[]>; updateAuthor(id: string, input: AuthorInput): Promise<AuthorRecord> }, rng?: () => number): Promise<ApplyResult>` where `ApplyResult = { ok: true; authors: SiteAuthor[] } | { ok: false; status: 400 | 409; error: string; exclusive?: Array<{ id: string; name: string; sites: string[] }> }`. Save body `configUpdates.authors?: SiteAuthor[]`, `configUpdates.confirmedExclusive?: string[]`. Save response `{ status: "ok", authors?: SiteAuthor[] }`; on refusal `{ status: "error", message, exclusive? }` with 400/409.

- [ ] **Step 1: Write the failing test**

```ts
// services/dashboard/src/lib/authors/__tests__/site-assignment.test.ts
import { describe, expect, it, vi } from "vitest";
import { applySiteAuthors } from "../site-assignment";
import type { AuthorRecord } from "../types";

const mk = (id: string, extra: Partial<AuthorRecord> = {}): AuthorRecord => ({
  id, name: id, tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [], created_at: "c", updated_at: "u", ...extra,
});

function deps(lib: AuthorRecord[]) {
  return { listAuthors: vi.fn(async () => lib), updateAuthor: vi.fn(async (id: string, input: Omit<AuthorRecord, "id" | "created_at" | "updated_at">) => ({ ...input, id, created_at: "c", updated_at: "u2" })) };
}

describe("applySiteAuthors", () => {
  it("normalizes and splits the unassigned topics", async () => {
    const d = deps([mk("a"), mk("b")]);
    const out = await applySiteAuthors("journeypeaks", [{ id: "a", topics: ["Hiking"] }, { id: "b", topics: [] }], ["Hiking", "Road Trips"], [], d, () => 0);
    expect(out).toEqual({ ok: true, authors: [{ id: "a", topics: ["Hiking"] }, { id: "b", topics: ["Road Trips"] }] });
  });

  it("refuses an unknown author (400) and an unconfirmed exclusive author (409), writing nothing", async () => {
    const d = deps([mk("ella-hughes", { name: "Ella Hughes", exclusive_sites: ["scoopella"] })]);
    expect(await applySiteAuthors("x", [{ id: "nobody", topics: [] }], [], [], d)).toMatchObject({ ok: false, status: 400 });
    expect(await applySiteAuthors("x", [{ id: "ella-hughes", topics: [] }], [], [], d)).toMatchObject({
      ok: false, status: 409, exclusive: [{ id: "ella-hughes", name: "Ella Hughes", sites: ["scoopella"] }],
    });
    expect(d.updateAuthor).not.toHaveBeenCalled();
  });

  it("a confirmed exclusive author gets this site added to their exclusive list", async () => {
    const d = deps([mk("ella-hughes", { exclusive_sites: ["scoopella"] })]);
    const out = await applySiteAuthors("popstorylab", [{ id: "ella-hughes", topics: [] }], [], ["ella-hughes"], d);
    expect(out.ok).toBe(true);
    expect(d.updateAuthor).toHaveBeenCalledWith("ella-hughes", expect.objectContaining({ exclusive_sites: ["scoopella", "popstorylab"] }));
  });

  it("an empty list clears the site's authors", async () => {
    expect(await applySiteAuthors("x", [], ["A"], [], deps([]))).toEqual({ ok: true, authors: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && npx vitest run src/lib/authors/__tests__/site-assignment.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// services/dashboard/src/lib/authors/site-assignment.ts
import { listAuthors, updateAuthor } from "./store";
import { distributeTopics, exclusiveConflicts, normalizeSiteAuthors } from "./assignment";
import type { AuthorInput, AuthorRecord, SiteAuthor } from "./types";

export type ApplyResult =
  | { ok: true; authors: SiteAuthor[] }
  | { ok: false; status: 400 | 409; error: string; exclusive?: Array<{ id: string; name: string; sites: string[] }> };

interface Deps {
  listAuthors(): Promise<AuthorRecord[]>;
  updateAuthor(id: string, input: AuthorInput): Promise<AuthorRecord>;
}

const inputOf = ({ id: _i, created_at: _c, updated_at: _u, ...rest }: AuthorRecord): AuthorInput => rest;

/**
 * Server side of saving a site's authors: every id must be in the library; an author exclusive to other sites is
 * only accepted when the user confirmed it (D2), and this site is then added to their exclusive list; unassigned
 * topics are split among the authors (D3). Nothing is written when it refuses.
 */
export async function applySiteAuthors(
  site: string,
  raw: unknown,
  siteTopics: string[],
  confirmedExclusive: string[],
  deps: Deps = { listAuthors, updateAuthor },
  rng: () => number = Math.random,
): Promise<ApplyResult> {
  const wanted = normalizeSiteAuthors(raw);
  if (wanted.length === 0) return { ok: true, authors: [] };
  const library = await deps.listAuthors();
  const known = new Set(library.map((a) => a.id));
  const unknown = wanted.filter((w) => !known.has(w.id)).map((w) => w.id);
  if (unknown.length > 0) return { ok: false, status: 400, error: `Unknown author: ${unknown.join(", ")}` };
  const conflicts = exclusiveConflicts(wanted, library, site);
  const unconfirmed = conflicts.filter((a) => !confirmedExclusive.includes(a.id));
  if (unconfirmed.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `${unconfirmed.map((a) => a.name).join(", ")} ${unconfirmed.length === 1 ? "is" : "are"} exclusive to other sites. Confirm to assign.`,
      exclusive: unconfirmed.map((a) => ({ id: a.id, name: a.name, sites: a.exclusive_sites })),
    };
  }
  for (const a of conflicts) await deps.updateAuthor(a.id, { ...inputOf(a), exclusive_sites: [...a.exclusive_sites, site] });
  return { ok: true, authors: distributeTopics(wanted, siteTopics, rng) };
}
```

`actions/wizard.ts` — in `StagingSiteConfig` add:

```ts
  /** Site authors (Content Agent tab Authors section). Validated and topic-split by the save route. */
  authors?: Array<{ id: string; topics: string[] }>;
  /** Author ids the user confirmed assigning although they're exclusive to other sites (D2). */
  confirmedExclusive?: string[];
```

`app/api/sites/save/route.ts`:
- Imports: `import { applySiteAuthors } from "@/lib/authors/site-assignment";`, `import { siteTopicsOf } from "@/lib/authors/assignment";`, `import type { SiteAuthor } from "@/lib/authors/types";`.
- Declare `let savedAuthors: SiteAuthor[] | undefined;` before the `configUpdates` handling.
- Directly before the line that serializes the config (`stringifyYaml(existing, { lineWidth: 0 })`, ~line 350), add:

```ts
    // Authors last, so topics changed in this same request are what gets split among them.
    if (configUpdates?.authors !== undefined) {
      const applied = await applySiteAuthors(domain, configUpdates.authors, siteTopicsOf(existing), configUpdates.confirmedExclusive ?? []);
      if (!applied.ok) {
        return NextResponse.json({ status: "error", message: applied.error, exclusive: applied.exclusive }, { status: applied.status });
      }
      if (applied.authors.length > 0) existing.authors = applied.authors;
      else delete existing.authors;
      savedAuthors = applied.authors;
    }
```

- Change the final success response to `return NextResponse.json({ status: "ok", ...(savedAuthors ? { authors: savedAuthors } : {}) });`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/dashboard && npx vitest run src/lib/authors && pnpm typecheck`
Expected: PASS, typecheck clean.

---

### Task 5: Content Agent tab: Authors section (with "Create author for this site")

**Files:**
- Create: `services/dashboard/src/lib/authors/site-author-flow.ts`
- Create: `services/dashboard/src/components/site-detail/SiteAuthorsSection.tsx`
- Modify: `services/dashboard/src/components/site-detail/ContentAgentTab.tsx` (lines ~133-134, ~511, ~531, ~639, ~669-671)
- Test: `services/dashboard/src/lib/authors/__tests__/site-author-flow.test.ts`, `services/dashboard/src/components/site-detail/__tests__/SiteAuthorsSection.test.tsx`

**Interfaces:**
- Consumes: Task 3 `rankForSite`, `normalizeSiteAuthors`; Task 2 `ALL_PARTS`, `runParts` (with `verticalOptions`, `portraitStyle`); Stage 3 `GET /api/authors` → `{ authors: AuthorListItem[] }`, `POST /api/authors` `{ author: AuthorInput }` → 201 `{ author: AuthorRecord }`; Task 4 save body/response.
- Produces:
  - `interface SiteForAuthor { domain: string; siteName: string; vertical?: string; topics: string[]; tone?: string }`
  - `generateSiteAuthor(site: SiteForAuthor, taken: { names: string[]; ids: string[] }, verticalOptions: string[], onPart?: (part: AuthorPart) => void, fetchFn?: typeof fetch): Promise<AuthorInput | null>` — a complete new author **exclusive to `site.domain`** (option A), not saved.
  - `<SiteAuthorsSection domain siteName vertical? topics tone? initial legacyAuthor? />`.

- [ ] **Step 1: Write the failing tests**

```ts
// services/dashboard/src/lib/authors/__tests__/site-author-flow.test.ts
import { describe, expect, it, vi } from "vitest";
import { generateSiteAuthor } from "../site-author-flow";

const VALUES: Record<string, unknown> = {
  name: "Nia Okafor", tagline: "Travel writer", bio: "Bio.", beats: ["Hiking", "Trails"], verticals: ["Travel"],
  portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" },
};

describe("generateSiteAuthor", () => {
  it("builds a complete author exclusive to the site, using the site as context and avoiding taken names", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as Record<string, unknown>;
      bodies.push(b);
      return new Response(JSON.stringify({ status: "ok", value: VALUES[b.part as string] }), { status: 200 });
    });
    const out = await generateSiteAuthor({ domain: "journeypeaks", siteName: "Journey Peaks", vertical: "Travel", topics: ["Hiking"] }, { names: ["Ella Hughes"], ids: ["ella-hughes"] }, ["Travel"], undefined, fetchFn as unknown as typeof fetch);
    expect(out).toMatchObject({ name: "Nia Okafor", verticals: ["Travel"], exclusive_sites: ["journeypeaks"], portrait: { kind: "generated" } });
    expect(bodies.map((b) => b.part)).toEqual(["name", "tagline", "bio", "beats", "verticals", "portrait"]);
    expect(bodies[0]).toMatchObject({ siteContext: { site: "journeypeaks", siteName: "Journey Peaks", category: "Travel", topics: ["Hiking"] }, takenNames: ["Ella Hughes"] });
    expect(bodies[5]).toMatchObject({ portraitStyle: "realistic", authorId: "nia-okafor" });
  });

  it("no name generated → null (nothing to save); no category list → the verticals part is skipped", async () => {
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      return part === "name"
        ? new Response(JSON.stringify({ status: "error", message: "nope" }), { status: 422 })
        : new Response(JSON.stringify({ status: "ok", value: VALUES[part] }), { status: 200 });
    });
    expect(await generateSiteAuthor({ domain: "x", siteName: "X", topics: [] }, { names: [], ids: [] }, [], undefined, fetchFn as unknown as typeof fetch)).toBeNull();
    expect(fetchFn.mock.calls.map(([, i]) => (JSON.parse(String(i!.body)) as { part: string }).part)).not.toContain("verticals");
  });
});
```

```tsx
// services/dashboard/src/components/site-detail/__tests__/SiteAuthorsSection.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/reference-data", () => ({ getVerticals: async () => [{ id: "1", name: "Travel", iab_code: "" }] }));

import { SiteAuthorsSection } from "../SiteAuthorsSection";
import type { AuthorListItem } from "@/lib/authors/types";

const mk = (id: string, name: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({
  id, name, tagline: `${name} tagline`, bio: "b", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [],
  created_at: "", updated_at: "", sites: [], ...extra,
});
const LIB = [
  mk("maya-ortiz", "Maya Ortiz", { verticals: ["Travel"], beats: ["Hiking"] }),
  mk("ella-hughes", "Ella Hughes", { exclusive_sites: ["scoopella"], beats: ["Royals"] }),
  mk("ben-foster", "Ben Foster", { beats: ["Celebrities"] }),
];
const saves: Array<Record<string, unknown>> = [];
const created: Array<Record<string, unknown>> = [];

function server(): void {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/authors" && !init?.method) return new Response(JSON.stringify({ authors: LIB }), { status: 200 });
    if (u === "/api/authors" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { author: Record<string, unknown> };
      created.push(body.author);
      return new Response(JSON.stringify({ author: { ...body.author, id: "nia-okafor" } }), { status: 201 });
    }
    if (u === "/api/authors/generate") {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      const value = { name: "Nia Okafor", tagline: "Travel writer", bio: "Bio.", beats: ["Hiking", "Trails"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" } }[part];
      return new Response(JSON.stringify({ status: "ok", value }), { status: 200 });
    }
    if (u === "/api/sites/save") {
      const body = JSON.parse(String(init!.body)) as { configUpdates: { authors: Array<{ id: string; topics: string[] }> } };
      saves.push(body.configUpdates as unknown as Record<string, unknown>);
      return new Response(JSON.stringify({ status: "ok", authors: body.configUpdates.authors.map((a) => ({ ...a, topics: a.topics.length ? a.topics : ["Hiking Trails"] })) }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

const props = { domain: "journeypeaks", siteName: "Journey Peaks", vertical: "Travel", topics: ["Hiking Trails", "Road Trips"], initial: [] as Array<{ id: string; topics: string[] }>, legacyAuthor: "Ryan Rivera" };

beforeEach(() => { saves.length = 0; created.length = 0; toast.mockClear(); server(); });
afterEach(cleanup);

describe("SiteAuthorsSection", () => {
  it("with no authors it says who articles are credited to", async () => {
    render(<SiteAuthorsSection {...props} />);
    expect(await screen.findByText(/credited to Ryan Rivera/)).toBeTruthy();
  });

  it("Add author lists the best fits first with a hint; adding one and saving sends it and shows the split topics", async () => {
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add author" }));
    const options = within(screen.getByRole("listbox", { name: "Library authors" })).getAllByRole("option");
    expect(options[0]!.textContent).toMatch(/Maya Ortiz.*Good fit/);
    await userEvent.click(options[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ authors: [{ id: "maya-ortiz", topics: [] }], confirmedExclusive: [] });
    expect(await screen.findByText("Hiking Trails")).toBeTruthy();
  });

  it("an exclusive author needs a confirm, and the confirm is sent with the save", async () => {
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add author" }));
    await userEvent.click(screen.getByRole("option", { name: /Ella Hughes/ }));
    const dialog = screen.getByRole("dialog", { name: "Assign an exclusive author?" });
    expect(dialog.textContent).toMatch(/exclusive to scoopella/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(saves[0]).toMatchObject({ confirmedExclusive: ["ella-hughes"] }));
  });

  it("Create author for this site makes a dedicated author, shown as unsaved; Save creates it first, exclusive to the site", async () => {
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create author for this site" }));
    expect(await screen.findByText("Nia Okafor", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/New, saved with the site/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: "Nia Okafor", verticals: ["Travel"], exclusive_sites: ["journeypeaks"] });
    expect((saves[0]!.authors as Array<{ id: string }>).map((a) => a.id)).toEqual(["nia-okafor"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/dashboard && npx vitest run src/lib/authors/__tests__/site-author-flow.test.ts src/components/site-detail/__tests__/SiteAuthorsSection.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the generation helper**

```ts
// services/dashboard/src/lib/authors/site-author-flow.ts
import { ALL_PARTS, runParts } from "./generate-flow";
import { authorIdFromName } from "./record";
import type { AuthorInput, AuthorPart } from "./types";

export interface SiteForAuthor {
  domain: string;
  siteName: string;
  vertical?: string;
  topics: string[];
  tone?: string;
}

/**
 * Option A (one author per site): a complete new author written for this site and exclusive to it, generated part
 * by part in the browser (each part is its own short request). Not saved; null when no name could be generated.
 */
export async function generateSiteAuthor(
  site: SiteForAuthor,
  taken: { names: string[]; ids: string[] },
  verticalOptions: string[],
  onPart?: (part: AuthorPart) => void,
  fetchFn: typeof fetch = fetch,
): Promise<AuthorInput | null> {
  let draft: AuthorInput = { name: "", tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [site.domain] };
  await runParts(
    ALL_PARTS.filter((p) => p !== "verticals" || verticalOptions.length > 0),
    draft,
    {
      authorIdFor: (d) => authorIdFromName(d.name || "author", taken.ids),
      context: { site: site.domain, siteName: site.siteName, category: site.vertical, topics: site.topics, tone: site.tone },
      takenNames: taken.names,
      verticalOptions,
      portraitStyle: "realistic",
      onPatch: (patch) => { draft = { ...draft, ...patch }; },
    },
    (part, status) => { if (status === "running") onPart?.(part); },
    fetchFn,
  );
  return draft.name.trim() ? draft : null;
}
```

- [ ] **Step 4: Implement the section**

```tsx
// services/dashboard/src/components/site-detail/SiteAuthorsSection.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ChipMultiSelect } from "@/components/config/grid/ChipMultiSelect";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import { rankForSite, type RankedAuthor } from "@/lib/authors/assignment";
import { generateSiteAuthor } from "@/lib/authors/site-author-flow";
import { getVerticals } from "@/lib/reference-data";
import type { AuthorInput, AuthorListItem, AuthorRecord, SiteAuthor } from "@/lib/authors/types";

interface SiteAuthorsSectionProps {
  domain: string;
  siteName: string;
  vertical?: string;
  topics: string[];
  tone?: string;
  initial: SiteAuthor[];
  /** site.yaml `author:` — what new articles are credited to while the site has no authors. */
  legacyAuthor?: string;
}

/** A row: a library author, or a new author that is created when the site is saved. */
interface Row extends SiteAuthor {
  pending?: AuthorInput;
}

const NEW_PREFIX = "new-";

function fitLabel(r: RankedAuthor, vertical?: string): string {
  if (r.fit === "strong") return `Good fit${vertical ? ` · ${vertical}` : ""}`;
  return r.fit === "close" ? "Close fit" : "";
}

/** Content Agent tab → Authors: who writes for this site and which topics each covers (replaces "Default Author"). */
export function SiteAuthorsSection({ domain, siteName, vertical, topics, tone, initial, legacyAuthor }: SiteAuthorsSectionProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [library, setLibrary] = useState<AuthorListItem[] | null>(null);
  const [rows, setRows] = useState<Row[]>(initial);
  const [saved, setSaved] = useState<SiteAuthor[]>(initial);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmFor, setConfirmFor] = useState<AuthorRecord | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/authors")
      .then((r) => r.json() as Promise<{ authors?: AuthorListItem[] }>)
      .then((d) => setLibrary(d.authors ?? []))
      .catch(() => setLibrary([]));
  }, []);

  const byId = useMemo(() => new Map((library ?? []).map((a) => [a.id, a])), [library]);
  const ranked = useMemo(
    () => rankForSite(library ?? [], { site: domain, vertical, topics }, rows.map((r) => r.id))
      .filter((r) => !query.trim() || `${r.author.name} ${r.author.tagline} ${r.author.beats.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())),
    [library, rows, query, domain, vertical, topics],
  );
  const dirty = JSON.stringify(rows.map(({ id, topics: t }) => ({ id, topics: t }))) !== JSON.stringify(saved) || rows.some((r) => r.pending);
  const assignedTopics = new Set(rows.flatMap((r) => r.topics.map((t) => t.toLowerCase())));
  const unassigned = topics.filter((t) => !assignedTopics.has(t.toLowerCase()));

  function add(a: AuthorRecord, confirmedExclusive = false): void {
    setRows((r) => [...r, { id: a.id, topics: [] }]);
    if (confirmedExclusive) setConfirmed((c) => [...c, a.id]);
    setAdding(false);
    setQuery("");
  }

  function choose(r: RankedAuthor): void {
    if (r.exclusiveElsewhere) setConfirmFor(r.author);
    else add(r.author);
  }

  async function createForSite(): Promise<void> {
    setCreating("Creating an author for this site…");
    const verticalOptions = (await getVerticals().catch(() => [])).map((v) => v.name);
    const draft = await generateSiteAuthor(
      { domain, siteName, vertical, topics, tone },
      { names: [...(library ?? []).map((a) => a.name), ...rows.flatMap((r) => (r.pending ? [r.pending.name] : []))], ids: (library ?? []).map((a) => a.id) },
      verticalOptions,
      (part) => setCreating(`Creating an author for this site (${part})…`),
    );
    setCreating(null);
    if (draft) setRows((r) => [...r, { id: `${NEW_PREFIX}${Date.now()}`, topics: [], pending: draft }]);
    else toast("Couldn't create an author. Try again.", "error");
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const final: SiteAuthor[] = [];
      for (const r of rows) {
        if (!r.pending) { final.push({ id: r.id, topics: r.topics }); continue; }
        const res = await fetch("/api/authors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: r.pending }) });
        const out = (await res.json()) as { author?: AuthorRecord; error?: string };
        if (!res.ok || !out.author) throw new Error(out.error ?? "Couldn't create the new author");
        final.push({ id: out.author.id, topics: r.topics });
      }
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, logoBase64: null, faviconBase64: null, configUpdates: { authors: final, confirmedExclusive: confirmed } }),
      });
      const out = (await res.json()) as { status: string; message?: string; authors?: SiteAuthor[] };
      if (!res.ok || out.status !== "ok") throw new Error(out.message ?? "Couldn't save the authors");
      const stored = out.authors ?? final;
      setRows(stored);
      setSaved(stored);
      setConfirmed([]);
      toast("Authors saved", "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the authors", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="site-authors-heading" className="space-y-4 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Authors</p>
          <h3 id="site-authors-heading" className="text-sm font-semibold text-[var(--text-primary)]">Who writes for {siteName || domain}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" disabled={!library || !!creating} loading={!!creating} onClick={(): void => { void createForSite(); }}>Create author for this site</Button>
          <Button variant="secondary" className="min-h-11" disabled={!library} aria-expanded={adding} onClick={(): void => setAdding((v) => !v)}>Add author</Button>
        </div>
      </div>

      {creating && <p role="status" className="text-xs text-[var(--text-secondary)]">{creating} This takes about a minute.</p>}

      {rows.length === 0 && !creating && (
        <p className="text-sm text-[var(--text-secondary)]">
          No authors yet.{legacyAuthor ? ` New articles are credited to ${legacyAuthor} until you add authors.` : ""}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-[var(--border-secondary)]" aria-label="Site authors">
          {rows.map((r) => {
            const a = byId.get(r.id);
            const name = r.pending?.name ?? a?.name ?? r.id;
            return (
              <li key={r.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <AuthorAvatar name={name} portrait={r.pending?.portrait ?? a?.portrait ?? null} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{name}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{r.pending ? "New, saved with the site" : a?.tagline || (a ? "" : "Not in the library")}</p>
                  </div>
                </div>
                <div className="md:w-1/2">
                  <ChipMultiSelect
                    label={`Topics for ${name}`}
                    addLabel="+ Topic"
                    value={r.topics}
                    options={topics.map((t) => ({ value: t, label: t }))}
                    onChange={(next): void => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, topics: next } : x)))}
                    emptyText="Any topic"
                  />
                </div>
                <Button variant="ghost" size="sm" aria-label={`Remove ${name}`} onClick={(): void => { setRows((rs) => rs.filter((x) => x.id !== r.id)); setConfirmed((c) => c.filter((id) => id !== r.id)); }}>Remove</Button>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && unassigned.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">{unassigned.map((t) => `"${t}"`).join(", ")} {unassigned.length === 1 ? "isn't" : "aren't"} assigned. On save {unassigned.length === 1 ? "it goes" : "they go"} to one of these authors at random.</p>
      )}

      {adding && (
        <div className="space-y-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3">
          <input type="search" aria-label="Search library authors" placeholder="Search authors…" value={query} onChange={(e): void => setQuery(e.target.value)} className="w-full min-h-11 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)]" />
          <ul role="listbox" aria-label="Library authors" className="max-h-72 overflow-auto">
            {ranked.length === 0 && <li className="px-2 py-3 text-xs text-[var(--text-muted)]">No more authors in the library.</li>}
            {ranked.map((r) => (
              <li key={r.author.id} role="option" aria-selected="false" tabIndex={0}
                onClick={(): void => choose(r)}
                onKeyDown={(e): void => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(r); } }}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60">
                <AuthorAvatar name={r.author.name} portrait={r.author.portrait} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text-primary)]">{r.author.name}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">{r.author.tagline}</span>
                </span>
                {fitLabel(r, vertical) && <span className="shrink-0 text-xs font-medium text-cyan">{fitLabel(r, vertical)}</span>}
                {r.exclusiveElsewhere && <span className="shrink-0 rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Exclusive to {r.author.exclusive_sites.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" className="min-h-11" disabled={!dirty || !!creating} loading={saving} onClick={(): void => { void save(); }}>Save authors</Button>
      </div>

      {confirmFor && (
        <Modal open onClose={(): void => setConfirmFor(null)} title="Assign an exclusive author?" size="sm">
          <div role="dialog" aria-label="Assign an exclusive author?">
            <p className="text-sm text-[var(--text-secondary)]">{confirmFor.name} is exclusive to {confirmFor.exclusive_sites.join(", ")}. Assigning them here makes them exclusive to this site too.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={(): void => setConfirmFor(null)}>Cancel</Button>
              <Button variant="primary" onClick={(): void => { add(confirmFor, true); setConfirmFor(null); }}>Assign</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Wire it into ContentAgentTab**

In `ContentAgentTab.tsx`:
- Remove `const [author, setAuthor] = useState(initAuthor);` (keep `initAuthor`; it becomes `legacyAuthor`).
- Remove `author !== initAuthor ||` from both `hasConfigChanges` (~line 511) and `identityDirty` (~line 639), and remove `author,` from the identity `configUpdates` (~line 531).
- Delete the Default Author block (~lines 669-671):

```tsx
        {!isGrid && (
          <Input label="Default Author" value={author} onChange={(e): void => setAuthor(e.target.value)} placeholder="e.g. Sarah Mitchell" />
        )}
```

- At the end of `identityContent` (just before its outer closing `</div>`), add:

```tsx
      {!isGrid && (
        <SiteAuthorsSection
          domain={domain}
          siteName={initSiteName}
          vertical={(briefRaw?.vertical as string | undefined) || undefined}
          topics={isPerTopic ? (briefRaw?.topics_v2 as Array<{ name: string }>).map((t) => t.name) : initTopics}
          tone={initTone || undefined}
          initial={normalizeSiteAuthors(siteConfig?.authors)}
          legacyAuthor={initAuthor || undefined}
        />
      )}
```

  with imports `import { SiteAuthorsSection } from "./SiteAuthorsSection";` and `import { normalizeSiteAuthors } from "@/lib/authors/assignment";`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/dashboard && npx vitest run src/components/site-detail src/lib/authors && pnpm typecheck`
Expected: PASS (existing ContentAgentTab tests included), typecheck clean. If an existing ContentAgentTab test asserted on "Default Author", change it to assert the Authors section heading and ledger it.

---

### Task 6: "Give every site an author" (bulk, option A)

**Files:**
- Create: `services/dashboard/src/components/authors/useAssignAllRun.ts`, `services/dashboard/src/components/authors/AssignAllModal.tsx`
- Modify: `services/dashboard/src/components/authors/AuthorsPageClient.tsx`, `services/dashboard/src/app/authors/page.tsx`
- Test: `services/dashboard/src/components/authors/__tests__/AssignAll.test.tsx`

**Interfaces:**
- Consumes: Task 5 `generateSiteAuthor`; Task 3 `normalizeSiteAuthors`, `siteTopicsOf`; `GET /api/sites/site-config?domain=<site>` → `{ config, inheritance }`; `POST /api/authors`; Task 4 `POST /api/sites/save`.
- Produces: `useAssignAllRun(): { progress: AssignAllProgress | null; start(sites: AssignableSite[]): void }` with `AssignableSite { domain: string; vertical?: string }` and `AssignAllProgress { done: number; skipped: number; failed: number; total: number; current: string }`; `<AssignAllModal open onClose onStart sites />`; `AuthorsPageClient` prop `sites: Array<{ domain: string; vertical?: string; status?: string }>`.

Behaviour: the Authors page gets a **Give every site an author** button. Its dialog lists the network's sites (not deleted), all ticked, so test sites can be unticked. The run goes one site at a time:
1. Read the site's config.
2. Skip the site if it already has authors or is a Grid site (`theme.template === "grid"`).
3. Otherwise generate a dedicated author (Task 5), create it in the library, and save it as the site's author.

Like "Generate missing profiles", the run keeps going after the dialog closes. The button is disabled while it runs, a status line counts progress, and the library refreshes after each site.

- [ ] **Step 1: Write the failing test**

```tsx
// services/dashboard/src/components/authors/__tests__/AssignAll.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/authors",
}));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/reference-data", () => ({ getVerticals: async () => [{ id: "1", name: "Travel", iab_code: "" }] }));

import { AuthorsPageClient } from "../AuthorsPageClient";

afterEach(() => { cleanup(); refresh.mockClear(); toast.mockClear(); });

const CONFIGS: Record<string, Record<string, unknown>> = {
  journeypeaks: { site_name: "Journey Peaks", brief: { vertical: "Travel", topics: ["Hiking"] } },
  scoopella: { site_name: "Scoopella", authors: [{ id: "ella-hughes", topics: [] }] },
  gridsite: { site_name: "Grid", theme: { template: "grid" } },
};

describe("Give every site an author", () => {
  it("creates one dedicated author per site without authors, skips the rest, and keeps going after the dialog closes", async () => {
    const createdFor: string[] = [];
    const saved: Array<{ domain: string; authors: unknown }> = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("/api/sites/site-config")) {
        const d = new URL(u, "http://x").searchParams.get("domain")!;
        return new Response(JSON.stringify({ config: CONFIGS[d] }), { status: 200 });
      }
      if (u === "/api/authors/generate") {
        const b = JSON.parse(String(init!.body)) as { part: string };
        const v = { name: "Nia Okafor", tagline: "t", bio: "b", beats: ["A", "B"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" } }[b.part];
        return new Response(JSON.stringify({ status: "ok", value: v }), { status: 200 });
      }
      if (u === "/api/authors" && init?.method === "POST") {
        const a = (JSON.parse(String(init.body)) as { author: { exclusive_sites: string[] } }).author;
        createdFor.push(a.exclusive_sites[0]!);
        return new Response(JSON.stringify({ author: { id: "nia-okafor" } }), { status: 201 });
      }
      if (u === "/api/sites/save") {
        const b = JSON.parse(String(init!.body)) as { domain: string; configUpdates: { authors: unknown } };
        saved.push({ domain: b.domain, authors: b.configUpdates.authors });
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    render(<AuthorsPageClient authors={[]} sites={[{ domain: "journeypeaks", vertical: "Travel" }, { domain: "scoopella" }, { domain: "gridsite" }, { domain: "oldsite", status: "deleted" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Give every site an author" }));
    expect(screen.queryByRole("checkbox", { name: "oldsite" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start (3 sites)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("button", { name: "Give every site an author" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors created for 1 site. 2 skipped (already had authors or Grid).", "success"));
    expect(createdFor).toEqual(["journeypeaks"]);
    expect(saved).toEqual([{ domain: "journeypeaks", authors: [{ id: "nia-okafor", topics: [] }] }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && npx vitest run src/components/authors/__tests__/AssignAll.test.tsx`
Expected: FAIL (no such button).

- [ ] **Step 3: Implement**

```ts
// services/dashboard/src/components/authors/useAssignAllRun.ts
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { normalizeSiteAuthors, siteTopicsOf } from "@/lib/authors/assignment";
import { generateSiteAuthor } from "@/lib/authors/site-author-flow";
import { getVerticals } from "@/lib/reference-data";
import type { AuthorRecord } from "@/lib/authors/types";

export interface AssignableSite {
  domain: string;
  vertical?: string;
}

export interface AssignAllProgress {
  done: number;
  skipped: number;
  failed: number;
  total: number;
  current: string;
}

/**
 * Option A in bulk: every chosen site without authors gets one new author written for it and exclusive to it.
 * One site at a time (each step is a short request); skips sites that already have authors and Grid sites.
 */
export function useAssignAllRun(): { progress: AssignAllProgress | null; start: (sites: AssignableSite[]) => void } {
  const router = useRouter();
  const { toast } = useToast();
  const [progress, setProgress] = useState<AssignAllProgress | null>(null);
  const active = useRef(false);

  async function run(sites: AssignableSite[]): Promise<void> {
    const verticalOptions = (await getVerticals().catch(() => [])).map((v) => v.name);
    const library = await fetch("/api/authors").then((r) => r.json() as Promise<{ authors?: AuthorRecord[] }>).catch(() => ({ authors: [] as AuthorRecord[] }));
    const taken = { names: (library.authors ?? []).map((a) => a.name), ids: (library.authors ?? []).map((a) => a.id) };
    let done = 0;
    let skipped = 0;
    let failed = 0;
    for (const s of sites) {
      setProgress({ done, skipped, failed, total: sites.length, current: s.domain });
      try {
        const cfgRes = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(s.domain)}`);
        const config = ((await cfgRes.json()) as { config?: Record<string, unknown> }).config;
        const theme = (config?.theme ?? {}) as { template?: unknown };
        if (!config || normalizeSiteAuthors(config.authors).length > 0 || theme.template === "grid") { skipped++; continue; }
        const brief = (config.brief ?? {}) as { vertical?: unknown; tone?: unknown };
        const draft = await generateSiteAuthor(
          {
            domain: s.domain,
            siteName: typeof config.site_name === "string" ? config.site_name : s.domain,
            vertical: typeof brief.vertical === "string" && brief.vertical ? brief.vertical : s.vertical,
            topics: siteTopicsOf(config),
            tone: typeof brief.tone === "string" ? brief.tone : undefined,
          },
          taken,
          verticalOptions,
        );
        if (!draft) { failed++; continue; }
        const created = await fetch("/api/authors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: draft }) });
        const author = ((await created.json()) as { author?: { id: string } }).author;
        if (!created.ok || !author) { failed++; continue; }
        taken.names.push(draft.name);
        taken.ids.push(author.id);
        const save = await fetch("/api/sites/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: s.domain, logoBase64: null, faviconBase64: null, configUpdates: { authors: [{ id: author.id, topics: [] }] } }),
        });
        if (save.ok) done++; else failed++;
      } catch {
        failed++;
      }
      router.refresh();
    }
    setProgress(null);
    const site = (n: number): string => `${n} site${n === 1 ? "" : "s"}`;
    toast(
      `Authors created for ${site(done)}.${skipped ? ` ${skipped} skipped (already had authors or Grid).` : ""}${failed ? ` ${failed} need another try.` : ""}`,
      failed ? "info" : "success",
    );
  }

  function start(sites: AssignableSite[]): void {
    if (active.current || sites.length === 0) return;
    active.current = true;
    void run(sites).finally(() => { active.current = false; });
  }

  return { progress, start };
}
```

```tsx
// services/dashboard/src/components/authors/AssignAllModal.tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { AssignableSite } from "./useAssignAllRun";

interface AssignAllModalProps {
  open: boolean;
  onClose: () => void;
  onStart: (sites: AssignableSite[]) => void;
  sites: AssignableSite[];
}

/** Confirmation for "Give every site an author": pick the sites (all ticked; untick test sites). */
export function AssignAllModal({ open, onClose, onStart, sites }: AssignAllModalProps): React.ReactElement {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(sites.map((s) => s.domain)));
  const picked = sites.filter((s) => chosen.has(s.domain));
  return (
    <Modal open={open} onClose={onClose} title="Give every site an author" size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">Each ticked site without authors gets one new author written for it, with a bio, Best fit and a realistic portrait, exclusive to that site. Sites that already have authors, and Grid sites, are skipped. About a minute per site; you can close this and keep working in this tab.</p>
        <ul className="max-h-64 overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)] text-sm">
          {sites.map((s) => (
            <li key={s.domain}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <input type="checkbox" aria-label={s.domain} checked={chosen.has(s.domain)} onChange={(e): void => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(s.domain); else n.delete(s.domain); return n; })} />
                <span className="flex-1 text-[var(--text-primary)]">{s.domain}</span>
                {s.vertical && <span className="text-xs text-[var(--text-muted)]">{s.vertical}</span>}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={(): void => { onStart(picked); onClose(); }}>Start ({picked.length} site{picked.length === 1 ? "" : "s"})</Button>
        </div>
      </div>
    </Modal>
  );
}
```

`AuthorsPageClient.tsx`:
- Props become `{ authors: AuthorListItem[]; sites: Array<{ domain: string; vertical?: string; status?: string }> }`.
- Add `const assignAll = useAssignAllRun(); const [assignOpen, setAssignOpen] = useState(false); const assignable = useMemo(() => sites.filter((s) => (s.status ?? "").toLowerCase() !== "deleted").map((s) => ({ domain: s.domain, vertical: s.vertical })), [sites]);`.
- In `actions`, before the other buttons:

```tsx
            {assignAll.progress && (
              <p role="status" aria-live="polite" className="text-sm text-[var(--text-secondary)]">
                Creating an author for {assignAll.progress.current}… <span className="tabular-nums text-[var(--text-muted)]">{assignAll.progress.done + assignAll.progress.skipped + assignAll.progress.failed} / {assignAll.progress.total}</span>
              </p>
            )}
            <Button variant="secondary" disabled={!!assignAll.progress} onClick={(): void => setAssignOpen(true)}>Give every site an author</Button>
```

- After the other modals: `{assignOpen && <AssignAllModal open onClose={(): void => setAssignOpen(false)} onStart={(list): void => assignAll.start(list)} sites={assignable} />}`.
- If the page also shows the "Generate missing profiles" status line, both can show; they are independent runs.

`src/app/authors/page.tsx`: pass `sites={index.sites.map((s) => ({ domain: s.domain, vertical: s.vertical || undefined, status: s.status }))}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/dashboard && npx vitest run src/components/authors && pnpm typecheck`
Expected: PASS (incl. the existing `AuthorsPageClient.test.tsx`), typecheck clean.

---

### Task 7: Pipeline: article bylines from the site's authors

**Files:**
- Create: `services/content-pipeline/src/authors/bylines.ts`, `src/authors/byline-reader.ts`
- Modify: `src/types.ts` (`SiteConfig`, `ArticleFrontmatter`), `src/lib/site-brief.ts`, `src/agents/content-generation/agent.ts`, `src/agents/content-generation/dedicated-agent.ts`, `src/agents/scheduled-publisher/index.ts` (~line 267), `src/queue/content-generation.ts` (~line 63)
- Test: `services/content-pipeline/src/authors/__tests__/bylines.test.ts`

**Interfaces:**
- Produces:
  - `interface SiteAuthor { id: string; topics: string[] }`, `interface Byline { name: string; authorId?: string }`, `type BylineResolver = (topic?: string) => Promise<Byline>`
  - `normalizeSiteAuthors(raw: unknown): SiteAuthor[]`
  - `pickArticleAuthor(siteAuthors: SiteAuthor[], topic: string | undefined, turn: number): SiteAuthor[]` — candidates in the order to try (the chosen one first)
  - `authorNameFromYaml(raw: string | null): string | null`
  - `nextAuthorTurn(siteDomain: string): Promise<number>` (Mongo `site_stats.authorRotation.nextIndex`, atomic `$inc`)
  - `createBylineResolver(deps: { siteDomain: string; siteAuthors: SiteAuthor[]; legacyAuthor?: string; readAuthorFile(id: string): Promise<string | null>; nextTurn?(siteDomain: string): Promise<number> }): BylineResolver`
  - `authorFileReader(config: AgentConfig): (id: string) => Promise<string | null>` (in `byline-reader.ts`)
  - `SiteBriefData.authors?: SiteAuthor[]`; `ArticleFrontmatter.author_id?: string`; `processItem` opts `{ source; bylineFor?: BylineResolver }`.

- [ ] **Step 1: Write the failing test**

```ts
// services/content-pipeline/src/authors/__tests__/bylines.test.ts
import { describe, expect, it, vi } from "vitest";
import { authorNameFromYaml, createBylineResolver, normalizeSiteAuthors, pickArticleAuthor } from "../bylines.js";

const AUTHORS = [{ id: "maya-ortiz", topics: ["Hiking"] }, { id: "ben-foster", topics: ["Road Trips"] }, { id: "nia-okafor", topics: [] }];

describe("pickArticleAuthor", () => {
  it("the author with the article's topic first (any case); otherwise rotation over all", () => {
    expect(pickArticleAuthor(AUTHORS, "road trips", 0)[0]!.id).toBe("ben-foster");
    expect(pickArticleAuthor(AUTHORS, undefined, 0)[0]!.id).toBe("maya-ortiz");
    expect(pickArticleAuthor(AUTHORS, undefined, 4)[0]!.id).toBe("ben-foster");
    expect(pickArticleAuthor(AUTHORS, "Unknown topic", 2)[0]!.id).toBe("nia-okafor");
  });
  it("returns every author once, chosen first, so a missing profile can fall through", () => {
    expect(pickArticleAuthor(AUTHORS, "Hiking", 1).map((a) => a.id).sort()).toEqual(["ben-foster", "maya-ortiz", "nia-okafor"]);
    expect(pickArticleAuthor([], "Hiking", 0)).toEqual([]);
  });
});

describe("authorNameFromYaml / normalizeSiteAuthors", () => {
  it("reads the name; broken or nameless files give null", () => {
    expect(authorNameFromYaml("id: a\nname: Maya Ortiz\n")).toBe("Maya Ortiz");
    expect(authorNameFromYaml("name: [oops")).toBeNull();
    expect(authorNameFromYaml(null)).toBeNull();
  });
  it("keeps valid ids once", () => {
    expect(normalizeSiteAuthors([{ id: "a", topics: ["X"] }, { id: "a" }, { id: "Bad Id" }])).toEqual([{ id: "a", topics: ["X"] }]);
  });
});

describe("createBylineResolver", () => {
  const files: Record<string, string> = { "maya-ortiz": "id: maya-ortiz\nname: Maya Ortiz\n", "ben-foster": "name: [broken" };
  const read = vi.fn(async (id: string) => files[id] ?? null);

  it("uses the topic author with author_id; reads each profile once", async () => {
    const bylineFor = createBylineResolver({ siteDomain: "s", siteAuthors: AUTHORS, legacyAuthor: "Old Name", readAuthorFile: read, nextTurn: async () => 0 });
    expect(await bylineFor("Hiking")).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    expect(await bylineFor("Hiking")).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("skips authors whose profile is missing or broken; none usable → the legacy name without an id", async () => {
    const bylineFor = createBylineResolver({ siteDomain: "s", siteAuthors: AUTHORS, legacyAuthor: "Old Name", readAuthorFile: read, nextTurn: async () => 1 });
    expect(await bylineFor("Road Trips")).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    const none = createBylineResolver({ siteDomain: "s", siteAuthors: [{ id: "ghost", topics: [] }], legacyAuthor: "Old Name", readAuthorFile: read, nextTurn: async () => 0 });
    expect(await none()).toEqual({ name: "Old Name" });
  });

  it("a site without authors keeps its legacy name, else Editorial Team; a rotation failure still gives a byline", async () => {
    expect(await createBylineResolver({ siteDomain: "s", siteAuthors: [], legacyAuthor: "Old Name", readAuthorFile: read })()).toEqual({ name: "Old Name" });
    expect(await createBylineResolver({ siteDomain: "s", siteAuthors: [], readAuthorFile: read })()).toEqual({ name: "Editorial Team" });
    const flaky = createBylineResolver({ siteDomain: "s", siteAuthors: AUTHORS, readAuthorFile: read, nextTurn: async () => { throw new Error("mongo down"); } });
    expect((await flaky("Hiking")).authorId).toBe("maya-ortiz");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && npx vitest run src/authors/__tests__/bylines.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
// services/content-pipeline/src/authors/bylines.ts
import { parse as parseYaml } from "yaml";
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "../stats/types.js";

/**
 * Which library author a new article is credited to. The author whose topics include the article's topic, else
 * the next in the site's rotation (Mongo site_stats.authorRotation); authors whose profile can't be read are
 * skipped. A site without `authors` keeps its legacy `author:` name.
 */
export interface SiteAuthor {
  id: string;
  topics: string[];
}

export interface Byline {
  name: string;
  /** Set only when the name comes from a library author assigned to the site. */
  authorId?: string;
}

export type BylineResolver = (topic?: string) => Promise<Byline>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSiteAuthors(raw: unknown): SiteAuthor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteAuthor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, topics } = entry as { id?: unknown; topics?: unknown };
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim()) : [] });
  }
  return out;
}

/** Every author once, in the order to try: topic owners rotated by `turn`, then the rest rotated by `turn`. */
export function pickArticleAuthor(siteAuthors: SiteAuthor[], topic: string | undefined, turn: number): SiteAuthor[] {
  if (siteAuthors.length === 0) return [];
  const t = topic?.trim().toLowerCase();
  const owners = t ? siteAuthors.filter((a) => a.topics.some((x) => x.toLowerCase() === t)) : [];
  const rest = siteAuthors.filter((a) => !owners.includes(a));
  const rotate = (list: SiteAuthor[]): SiteAuthor[] => {
    if (list.length === 0) return list;
    const start = ((turn % list.length) + list.length) % list.length;
    return [...list.slice(start), ...list.slice(0, start)];
  };
  return [...rotate(owners), ...rotate(rest)];
}

export function authorNameFromYaml(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const doc = parseYaml(raw) as { name?: unknown } | null;
    return doc && typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : null;
  } catch {
    return null;
  }
}

/** Atomic per-site counter; each call returns the turn to use and advances it. */
export async function nextAuthorTurn(siteDomain: string): Promise<number> {
  const db = await getMongoDb();
  const before = await db.collection<{ _id: string; authorRotation?: { nextIndex?: number } }>(COLLECTIONS.siteStats).findOneAndUpdate(
    { _id: siteDomain },
    { $inc: { "authorRotation.nextIndex": 1 }, $set: { "authorRotation.updatedAt": new Date() } },
    { upsert: true, returnDocument: "before" },
  );
  return before?.authorRotation?.nextIndex ?? 0;
}

export function createBylineResolver(deps: {
  siteDomain: string;
  siteAuthors: SiteAuthor[];
  legacyAuthor?: string;
  readAuthorFile(id: string): Promise<string | null>;
  nextTurn?(siteDomain: string): Promise<number>;
}): BylineResolver {
  const names = new Map<string, Promise<string | null>>();
  const fallback: Byline = { name: deps.legacyAuthor?.trim() || "Editorial Team" };
  const nameOf = (id: string): Promise<string | null> => {
    if (!names.has(id)) names.set(id, deps.readAuthorFile(id).then(authorNameFromYaml, () => null));
    return names.get(id)!;
  };
  return async (topic?: string): Promise<Byline> => {
    if (deps.siteAuthors.length === 0) return fallback;
    const turn = await (deps.nextTurn ?? nextAuthorTurn)(deps.siteDomain).catch(() => Math.floor(Math.random() * 1000));
    for (const candidate of pickArticleAuthor(deps.siteAuthors, topic, turn)) {
      const name = await nameOf(candidate.id);
      if (name) return { name, authorId: candidate.id };
      console.warn(`[bylines] ${deps.siteDomain}: author ${candidate.id} has no readable profile; skipping`);
    }
    return fallback;
  };
}
```

(Check the Mongo helper path first: `grep -n "export async function getMongoDb" src/lib/mongo.ts`; `topic-rotation.ts` imports it from `../lib/mongo.js`, so `src/authors/bylines.ts` uses `../lib/mongo.js` too.)

```ts
// services/content-pipeline/src/authors/byline-reader.ts
import { readFile as readFs } from "node:fs/promises";
import path from "node:path";
import type { AgentConfig } from "../lib/config.js";
import { createOctokit, readFile } from "../lib/github.js";

/** Reads `authors/<id>.yaml` from the network repo `main` (local checkout when LOCAL_NETWORK_PATH is set). */
export function authorFileReader(config: AgentConfig): (id: string) => Promise<string | null> {
  if (config.localNetworkPath) {
    return (id) => readFs(path.join(config.localNetworkPath!, "authors", `${id}.yaml`), "utf8").catch(() => null);
  }
  const octokit = createOctokit(config.github);
  return (id) => readFile(octokit, config.networkRepo, `authors/${id}.yaml`, "main").catch(() => null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && npx vitest run src/authors/__tests__/bylines.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the site's authors to the writers**

- `src/types.ts`: `SiteConfig` gains `/** Library authors writing for this site (site.yaml authors:). */ authors?: Array<{ id: string; topics: string[] }>;`; `ArticleFrontmatter` gains `/** Library author id (authors/<id>.yaml). */ author_id?: string;`.
- `src/lib/site-brief.ts`: `SiteBriefData` gains `authors?: SiteAuthor[];` (import type from `../authors/bylines.js`); `readSiteBrief` returns `authors: normalizeSiteAuthors(config.authors),`.
- `agent.ts`:
  - `ContentGenerationParams.preloadedBrief` gains `authors?: Array<{ id: string; topics: string[] }>;`.
  - The local brief loader's return (~line 526) gains `authors: normalizeSiteAuthors(siteConfig.authors),`.
  - `processItem` opts type becomes `opts: { source: GenerationSource; bylineFor?: BylineResolver } = { source: "dashboard" }`. Before the `frontmatter` literal (~line 777):

```ts
  const byline = opts.bylineFor ? await opts.bylineFor(topicsArray?.[0]) : { name: author || "Editorial Team" };
```

    and in the literal replace `author: author || "Editorial Team",` with `author: byline.name,` and add `...(byline.authorId ? { author_id: byline.authorId } : {}),` right after it.
  - `runContentGeneration`: change the destructure to `const { siteName, author: siteAuthor, authors: siteAuthors, brief } = await getSiteBrief(...)` and right after it:

```ts
    const bylineFor = createBylineResolver({ siteDomain, siteAuthors: siteAuthors ?? [], legacyAuthor: siteAuthor, readAuthorFile: authorFileReader(config) });
```

  - Pass `bylineFor` into `runPerTopicGeneration({ …, author: siteAuthor, bylineFor, … })` (add `bylineFor?: BylineResolver;` to its `args` type) and into both `processItem` calls: the legacy one (~line 1177) as `{ source: params.source ?? "dashboard", bylineFor }`, the per-topic one (~line 1522) as `{ source: args.source ?? "dashboard", bylineFor: args.bylineFor }`.
- `dedicated-agent.ts` (~line 141): destructure `authors` too; before the frontmatter literal:

```ts
  const byline = await createBylineResolver({ siteDomain, siteAuthors: siteBriefData.authors ?? [], legacyAuthor: author, readAuthorFile: authorFileReader(config) })();
```

  replace `author: author || "Editorial Team",` with `author: byline.name, ...(byline.authorId ? { author_id: byline.authorId } : {}),`. (Use the variable names the function already has for the site domain and config — `grep -n "siteDomain\|config" src/agents/content-generation/dedicated-agent.ts | head`.)
- `scheduled-publisher/index.ts` (~line 267): add `authors: briefData.authors,` next to `author: briefData.author,`.
- `queue/content-generation.ts` (~line 63): add `authors: parsed.authors,` next to `author: parsed.author,`.

- [ ] **Step 6: Run the pipeline suite**

Run: `cd services/content-pipeline && npx vitest run && pnpm typecheck`
Expected: all pass, typecheck clean.

---

### Task 8: Migration: Ella Hughes + fix the bad bylines

Option A (Asaf, 2026-10-12): the generated default names are **not** migrated, and old articles keep their names. The migration does two things only:
1. **Ella Hughes** becomes a library author exclusive to scoopella and scoopella's site author.
2. **Bad bylines are re-credited.** Articles credited to `admin`, `Editorial Team` or an "… AI …" name (about 260) get the site's first assigned author. In the article header only the `author:` line changes, and `author_id:` is added.

It runs **after** "Give every site an author" (Task 6) has run in production. Sites still without authors are reported, not changed.

**Files:**
- Create: `services/content-pipeline/src/scripts/migrate-authors-lib.ts`, `src/scripts/migrate-authors.ts`
- Test: `services/content-pipeline/src/__tests__/migrate-authors.test.ts`

**Interfaces:**
- Consumes: Task 7 `SiteAuthor`, `normalizeSiteAuthors`.
- Produces:
  - `isBadByline(name: string): boolean`
  - `slugFor(name: string, taken: Set<string>): string`
  - `interface SiteState { site: string; authors: SiteAuthor[]; badArticles: Array<{ path: string; author: string; ref: "staging" | "main" }> }`
  - `interface LibraryAuthor { id: string; name: string; exclusive_sites: string[] }`
  - `interface MigrationPlan { createAuthors: LibraryAuthor[]; addExclusive: Array<{ id: string; sites: string[] }>; siteAuthors: Array<{ site: string; authors: SiteAuthor[] }>; recredit: Array<{ site: string; ref: "staging" | "main"; path: string; from: string; to: string; authorId: string }>; waiting: Array<{ site: string; articles: number }> }`
  - `PERSONAS: Array<{ name: string; site: string }>` (= Ella Hughes / scoopella)
  - `planMigration(sites: SiteState[], library: LibraryAuthor[]): MigrationPlan`
  - `recreditFrontmatter(text: string, name: string, id: string): string`
  - `authorFileYaml(a: LibraryAuthor, now: string): string`
  - CLI: `npx tsx src/scripts/migrate-authors.ts plan [--out file]`, `… apply --plan file`.

- [ ] **Step 1: Write the failing test**

```ts
// services/content-pipeline/src/__tests__/migrate-authors.test.ts
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { authorFileYaml, isBadByline, planMigration, recreditFrontmatter, slugFor, type SiteState } from "../scripts/migrate-authors-lib.js";

const site = (s: string, extra: Partial<SiteState> = {}): SiteState => ({ site: s, authors: [], badArticles: [], ...extra });

describe("isBadByline / slugFor", () => {
  it.each(["admin", "Editorial Team", "Mimi AI agent", "Alexi AI historian", "staff"])("bad: %s", (n) => expect(isBadByline(n)).toBe(true));
  it.each(["Ella Hughes", "Taylor Winters", "Sapir Lavi", "Aidan Price"])("a person's name stays: %s", (n) => expect(isBadByline(n)).toBe(false));
  it("slugs like the dashboard", () => {
    expect(slugFor("Ella Hughes", new Set())).toBe("ella-hughes");
    expect(slugFor("Ella Hughes", new Set(["ella-hughes"]))).toBe("ella-hughes-2");
  });
});

describe("planMigration", () => {
  const library = [{ id: "nia-okafor", name: "Nia Okafor", exclusive_sites: ["journeypeaks"] }];
  const sites = [
    site("scoopella", { badArticles: [{ path: "sites/scoopella/articles/a.md", author: "admin", ref: "staging" }] }),
    site("journeypeaks", { authors: [{ id: "nia-okafor", topics: [] }], badArticles: [{ path: "sites/journeypeaks/articles/b.md", author: "Editorial Team", ref: "main" }] }),
    site("carsnewsmag", { badArticles: [{ path: "sites/carsnewsmag/articles/c.md", author: "admin", ref: "staging" }] }),
  ];

  it("Ella becomes a library author exclusive to scoopella and scoopella's author; her site's bad bylines go to her", () => {
    const p = planMigration(sites, library);
    expect(p.createAuthors).toEqual([{ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] }]);
    expect(p.siteAuthors).toEqual([{ site: "scoopella", authors: [{ id: "ella-hughes", topics: [] }] }]);
    expect(p.recredit).toContainEqual({ site: "scoopella", ref: "staging", path: "sites/scoopella/articles/a.md", from: "admin", to: "Ella Hughes", authorId: "ella-hughes" });
  });

  it("other sites' bad bylines go to their first author; sites without authors wait", () => {
    const p = planMigration(sites, library);
    expect(p.recredit).toContainEqual({ site: "journeypeaks", ref: "main", path: "sites/journeypeaks/articles/b.md", from: "Editorial Team", to: "Nia Okafor", authorId: "nia-okafor" });
    expect(p.waiting).toEqual([{ site: "carsnewsmag", articles: 1 }]);
  });

  it("is idempotent: with Ella in place and no bad bylines left there is nothing to do", () => {
    const again = planMigration(
      [site("scoopella", { authors: [{ id: "ella-hughes", topics: [] }] })],
      [{ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] }],
    );
    expect(again).toEqual({ createAuthors: [], addExclusive: [], siteAuthors: [], recredit: [], waiting: [] });
  });

  it("an existing Ella without the exclusive gets it", () => {
    const p = planMigration([site("scoopella", { authors: [{ id: "ella-hughes", topics: [] }] })], [{ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: [] }]);
    expect(p.addExclusive).toEqual([{ id: "ella-hughes", sites: ["scoopella"] }]);
  });
});

describe("recreditFrontmatter", () => {
  const md = "---\ntitle: Hello\nauthor: admin\ntags: [a]\n---\nBody mentions author: admin in text.\n";
  it("changes only the header's author line and adds author_id after it; the body is untouched", () => {
    expect(recreditFrontmatter(md, "Nia Okafor", "nia-okafor")).toBe("---\ntitle: Hello\nauthor: Nia Okafor\nauthor_id: nia-okafor\ntags: [a]\n---\nBody mentions author: admin in text.\n");
  });
  it("replaces an existing author_id instead of adding a second one", () => {
    const withId = "---\nauthor: admin\nauthor_id: old\n---\nx\n";
    expect(recreditFrontmatter(withId, "Nia Okafor", "nia-okafor")).toBe("---\nauthor: Nia Okafor\nauthor_id: nia-okafor\n---\nx\n");
  });
});

describe("authorFileYaml", () => {
  it("writes a file the dashboard store and seed-authors read", () => {
    const doc = parseYaml(authorFileYaml({ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] }, "2026-10-12T00:00:00.000Z")) as Record<string, unknown>;
    expect(doc).toMatchObject({ id: "ella-hughes", name: "Ella Hughes", tagline: "", bio: "", beats: [], verticals: [], links: {}, exclusive_sites: ["scoopella"], created_at: "2026-10-12T00:00:00.000Z" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && npx vitest run src/__tests__/migrate-authors.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the planner**

```ts
// services/content-pipeline/src/scripts/migrate-authors-lib.ts
import { stringify as stringifyYaml } from "yaml";
import type { SiteAuthor } from "../authors/bylines.js";

/** Pure planning for scripts/migrate-authors.ts (Stage 4, option A). */
export interface SiteState {
  site: string;
  /** The site's current site.yaml `authors:`. */
  authors: SiteAuthor[];
  /** Articles whose `author:` is a bad byline, on the staging branch or on main. */
  badArticles: Array<{ path: string; author: string; ref: "staging" | "main" }>;
}

export interface LibraryAuthor {
  id: string;
  name: string;
  exclusive_sites: string[];
}

export interface MigrationPlan {
  createAuthors: LibraryAuthor[];
  addExclusive: Array<{ id: string; sites: string[] }>;
  siteAuthors: Array<{ site: string; authors: SiteAuthor[] }>;
  recredit: Array<{ site: string; ref: "staging" | "main"; path: string; from: string; to: string; authorId: string }>;
  /** Sites with bad bylines but no authors yet: run "Give every site an author" first. */
  waiting: Array<{ site: string; articles: number }>;
}

/** Existing personas that become library authors, exclusive to their site (spec D7). */
export const PERSONAS: Array<{ name: string; site: string }> = [{ name: "Ella Hughes", site: "scoopella" }];

const BAD = /^(admin|administrator|editor|editorial team|staff|team|guest|anonymous)$/i;

export function isBadByline(name: string): boolean {
  const n = name.trim();
  return BAD.test(n) || /\bAI\b/.test(n);
}

export function slugFor(name: string, taken: Set<string>): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "author";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function planMigration(sites: SiteState[], library: LibraryAuthor[]): MigrationPlan {
  const plan: MigrationPlan = { createAuthors: [], addExclusive: [], siteAuthors: [], recredit: [], waiting: [] };
  const all = [...library];
  const taken = new Set(library.map((a) => a.id));
  const effective = new Map(sites.map((s) => [s.site, s.authors]));

  for (const p of PERSONAS) {
    let a = all.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (!a) {
      a = { id: slugFor(p.name, taken), name: p.name, exclusive_sites: [p.site] };
      taken.add(a.id);
      all.push(a);
      plan.createAuthors.push(a);
    } else if (!a.exclusive_sites.includes(p.site)) {
      plan.addExclusive.push({ id: a.id, sites: [p.site] });
    }
    const current = effective.get(p.site);
    if (current && !current.some((x) => x.id === a!.id)) {
      const next = [{ id: a.id, topics: [] }, ...current];
      effective.set(p.site, next);
      plan.siteAuthors.push({ site: p.site, authors: next });
    }
  }

  const nameOf = new Map(all.map((a) => [a.id, a.name]));
  for (const s of sites) {
    if (s.badArticles.length === 0) continue;
    const first = (effective.get(s.site) ?? []).find((x) => nameOf.has(x.id));
    if (!first) { plan.waiting.push({ site: s.site, articles: s.badArticles.length }); continue; }
    for (const art of s.badArticles) {
      plan.recredit.push({ site: s.site, ref: art.ref, path: art.path, from: art.author, to: nameOf.get(first.id)!, authorId: first.id });
    }
  }
  return plan;
}

/** Only the header's `author:` line changes (and `author_id:` is set right after it); the body is never touched. */
export function recreditFrontmatter(text: string, name: string, id: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return text;
  const lines = m[1]!.split("\n").filter((l) => !/^author_id:/.test(l));
  const i = lines.findIndex((l) => /^author:/.test(l));
  if (i < 0) return text;
  lines.splice(i, 1, `author: ${name}`, `author_id: ${id}`);
  return `---\n${lines.join("\n")}\n---\n${text.slice(m[0].length)}`;
}

/** A new library author file: name and exclusivity; "Generate missing profiles" fills the rest. */
export function authorFileYaml(a: LibraryAuthor, now: string): string {
  return stringifyYaml({
    id: a.id, name: a.name, tagline: "", bio: "", beats: [], verticals: [], links: {}, exclusive_sites: a.exclusive_sites,
    created_at: now, updated_at: now,
  }, { lineWidth: 0 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && npx vitest run src/__tests__/migrate-authors.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the CLI (plan / apply)**

```ts
// services/content-pipeline/src/scripts/migrate-authors.ts
/**
 * Stage 4 migration (option A): Ella Hughes into the library (exclusive to scoopella) and bad bylines
 * (admin, Editorial Team, "… AI …") re-credited to the site's first author. Run AFTER "Give every site an author".
 *
 *   npx tsx src/scripts/migrate-authors.ts plan  [--out authors-migration.json]
 *   npx tsx src/scripts/migrate-authors.ts apply --plan authors-migration.json
 *
 * plan  — reads origin/main and every origin/staging/<site> of the network repo (NETWORK_REPO_PATH, default
 *         ../../../atomic-labs-network; `git fetch` there first). Writes the review file (every file it would change)
 *         and prints a summary. Nothing is changed.
 * apply — commits in temporary worktrees: one on main (Ella's file, scoopella's published site.yaml, main's
 *         re-credited articles), one per staging branch. It does NOT push: it prints the push commands, main first.
 * After pushing: sync-authors.yml writes author:ella-hughes; re-seed the changed sites; run backfill-mongo for those
 * sites (site-configs + articles) so production's dashboard shows the new bylines.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import { normalizeSiteAuthors } from "../authors/bylines.js";
import { authorFileYaml, isBadByline, planMigration, recreditFrontmatter, type LibraryAuthor, type MigrationPlan, type SiteState } from "./migrate-authors-lib.js";

const repo = process.env.NETWORK_REPO_PATH ?? path.resolve(process.cwd(), "../../../atomic-labs-network");
const git = (args: string[], cwd = repo): string => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const tryGit = (args: string[]): string | null => { try { return git(args); } catch { return null; } };
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

function badArticles(ref: string, site: string, as: "staging" | "main"): SiteState["badArticles"] {
  const out = tryGit(["grep", "-E", "^author:", ref, "--", `sites/${site}/articles/*.md`]) ?? "";
  const found: SiteState["badArticles"] = [];
  for (const line of out.split("\n")) {
    const m = /^[^:]+:([^:]+):author:\s*(.*)$/.exec(line);
    if (!m) continue;
    const name = m[2]!.replace(/^["']|["']$/g, "").trim();
    if (isBadByline(name)) found.push({ path: m[1]!, author: name, ref: as });
  }
  return found;
}

function collect(): { sites: SiteState[]; library: LibraryAuthor[] } {
  const branches = git(["branch", "-r", "--format=%(refname:short)"]).split("\n").filter((b) => b.startsWith("origin/staging/"));
  const sites: SiteState[] = [];
  for (const b of branches) {
    const site = b.slice("origin/staging/".length);
    const raw = tryGit(["show", `${b}:sites/${site}/site.yaml`]);
    if (!raw) continue;
    const cfg = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    sites.push({ site, authors: normalizeSiteAuthors(cfg.authors), badArticles: [...badArticles(b, site, "staging"), ...badArticles("origin/main", site, "main")] });
  }
  const library: LibraryAuthor[] = (tryGit(["ls-tree", "--name-only", "origin/main", "authors/"]) ?? "")
    .split("\n").filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const doc = (parseYaml(git(["show", `origin/main:${f}`])) ?? {}) as { id?: unknown; name?: unknown; exclusive_sites?: unknown };
      return typeof doc.id === "string" && typeof doc.name === "string"
        ? { id: doc.id, name: doc.name, exclusive_sites: Array.isArray(doc.exclusive_sites) ? doc.exclusive_sites.filter((s): s is string => typeof s === "string") : [] }
        : null;
    })
    .filter((a): a is LibraryAuthor => a !== null);
  return { sites, library };
}

function worktree(ref: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "authors-mig-"));
  git(["worktree", "add", "--detach", dir, ref]);
  return dir;
}

function setSiteAuthors(file: string, authors: MigrationPlan["siteAuthors"][number]["authors"]): void {
  if (!existsSync(file)) return;
  const doc = parseDocument(readFileSync(file, "utf8"));
  doc.set("authors", authors);
  writeFileSync(file, doc.toString({ lineWidth: 0 }));
}

function recredit(dir: string, items: MigrationPlan["recredit"]): void {
  for (const r of items) {
    const f = path.join(dir, r.path);
    if (existsSync(f)) writeFileSync(f, recreditFrontmatter(readFileSync(f, "utf8"), r.to, r.authorId));
  }
}

function commitIfChanged(dir: string, paths: string[], message: string, branch: string, pushes: string[]): void {
  if (!git(["status", "--porcelain"], dir).trim()) { git(["worktree", "remove", "--force", dir]); return; }
  git(["add", "--", ...paths], dir);
  git(["commit", "-m", message], dir);
  pushes.push(`git -C ${dir} push origin HEAD:${branch} && git -C ${repo} worktree remove ${dir}`);
}

function plan(): void {
  const { sites, library } = collect();
  const p = planMigration(sites, library);
  const out = arg("--out") ?? "authors-migration.json";
  writeFileSync(out, JSON.stringify(p, null, 2));
  const by = (k: "from" | "site"): string => Object.entries(p.recredit.reduce<Record<string, number>>((acc, r) => { acc[r[k]] = (acc[r[k]] ?? 0) + 1; return acc; }, {})).map(([n, c]) => `${n} ${c}`).join(", ");
  console.log(`Sites read: ${sites.length}. Library authors: ${library.length}.`);
  console.log(`New library authors: ${p.createAuthors.map((a) => `${a.name} (exclusive to ${a.exclusive_sites.join(", ")})`).join(", ") || "none"}.`);
  console.log(`Articles re-credited: ${p.recredit.length} (by old byline: ${by("from") || "none"}).`);
  console.log(`Sites still without authors (their bad bylines wait): ${p.waiting.map((w) => `${w.site} ${w.articles}`).join(", ") || "none"}.`);
  console.log(`Review ${out}, then: npx tsx src/scripts/migrate-authors.ts apply --plan ${out}`);
}

function apply(): void {
  const file = arg("--plan");
  if (!file) throw new Error("apply needs --plan <file>");
  const p = JSON.parse(readFileSync(file, "utf8")) as MigrationPlan;
  const now = new Date().toISOString();
  const pushes: string[] = [];

  const main = worktree("origin/main");
  for (const a of p.createAuthors) writeFileSync(path.join(main, "authors", `${a.id}.yaml`), authorFileYaml(a, now), { flag: "wx" });
  for (const x of p.addExclusive) {
    const f = path.join(main, "authors", `${x.id}.yaml`);
    const doc = parseDocument(readFileSync(f, "utf8"));
    const cur = (doc.get("exclusive_sites") as { toJSON(): unknown } | undefined)?.toJSON();
    doc.set("exclusive_sites", [...new Set([...(Array.isArray(cur) ? (cur as string[]) : []), ...x.sites])]);
    doc.set("updated_at", now);
    writeFileSync(f, doc.toString({ lineWidth: 0 }));
  }
  for (const s of p.siteAuthors) setSiteAuthors(path.join(main, "sites", s.site, "site.yaml"), s.authors);
  const onMain = p.recredit.filter((r) => r.ref === "main");
  recredit(main, onMain);
  commitIfChanged(main, ["authors", "sites"], "authors: Ella Hughes to the library; re-credit admin/Editorial Team/AI bylines", "main", pushes);

  const stagingSites = [...new Set([...p.siteAuthors.map((s) => s.site), ...p.recredit.filter((r) => r.ref === "staging").map((r) => r.site)])];
  for (const site of stagingSites) {
    const dir = worktree(`origin/staging/${site}`);
    const sa = p.siteAuthors.find((s) => s.site === site);
    if (sa) setSiteAuthors(path.join(dir, "sites", site, "site.yaml"), sa.authors);
    recredit(dir, p.recredit.filter((r) => r.ref === "staging" && r.site === site));
    commitIfChanged(dir, [`sites/${site}`], `authors: ${site} bylines`, `staging/${site}`, pushes);
  }
  console.log(`\nReview the commits, then push (main first):\n${pushes.join("\n")}`);
}

const cmd = process.argv[2];
if (cmd === "plan") plan();
else if (cmd === "apply") apply();
else console.log("usage: migrate-authors.ts plan [--out file] | apply --plan file");
```

- [ ] **Step 6: Dry-run the plan against the real network repo (read-only)**

Run: `cd ../../../atomic-labs-network && git fetch -q origin && cd - && cd services/content-pipeline && npx tsx src/scripts/migrate-authors.ts plan --out /tmp/authors-migration.json`
Expected now, before "Give every site an author" has run: Ella Hughes is a new author (exclusive to scoopella), and scoopella's bad bylines (if any) are re-credited to her. Every other site with bad bylines is listed under "waiting", about 260 articles in total. Record the summary in `docs/test-results/authors-stage4/README.md`. Do **not** run `apply`; that happens in the rollout, after Asaf reviews the plan file.

- [ ] **Step 7: Run the pipeline suite**

Run: `cd services/content-pipeline && npx vitest run && pnpm typecheck`
Expected: all pass, typecheck clean.

---

### Task 9: Guide, local end-to-end, commit after approval

**Files:**
- Modify: `services/dashboard/public/guide/26-authors.md`
- Create: `docs/test-results/authors-stage4/README.md`

- [ ] **Step 1: Guide** — append to `26-authors.md`:

```md
## Best fit
Each author has up to three **Best fit** site categories (the same categories sites use). **Regenerate** suggests them from the author's beats; **Generate everything** and **Generate missing profiles** fill them in too. The profile lists sites in those categories that don't use the author yet under **Good match for**, and the library can be filtered by **Best fit**.

## Authors on a site
Every site has its own author. On a site, **Content Agent → Identity → Authors** sets who writes for it:
- **Create author for this site** writes a new author for the site (bio, Best fit, realistic portrait), exclusive to it. About a minute. It's added to the library when you click **Save authors**.
- **Add author** lists the library with the best fits first ("Good fit", "Close fit"). An author exclusive to another site asks first; assigning them makes them exclusive to this site too.
- A site can have several authors. Give each the topics they cover; topics left unassigned are split among the site's authors when you save, and the split is kept. You can change authors and topics any time.
- New articles are credited to the author who covers the article's topic, otherwise the next author in turn. Older articles keep the name they were published with.
- Until a site has authors, its articles use the site's previous author name.

On the **Authors** screen, **Give every site an author** does this for all sites at once (sites that already have authors and Grid sites are skipped).
```

- [ ] **Step 2: Typecheck and both suites**

Run: `cd services/dashboard && pnpm typecheck && npx vitest run; cd ../content-pipeline && pnpm typecheck && npx vitest run`
Expected: both clean and green.

- [ ] **Step 3: Local end-to-end (grid dev; writes to the real network repo)** — record each in `docs/test-results/authors-stage4/README.md`:
1. Author profile: Best fit Regenerate → 1–3 categories; Save; Good match for lists matching sites; library Best fit filter (URL `?v=`); card shows the categories.
2. A site with no authors (e.g. coffeeactually): Identity → Authors shows the previous-name line; **Create author for this site** → progress → new author row → give it a topic → **Save authors** → the author is in the library, exclusive to the site; reload keeps the authors and the topic split.
3. **Add author** on that site → an author exclusive to another site asks first → Assign → Save → that author's profile shows both sites under Exclusive to. Then remove them again → Save.
4. A second author with its own topics on one site → Save → each keeps its topics; the unassigned-topic line disappears after save.
5. Generate 2 articles on that site → frontmatter has `author` = an assigned author's name and `author_id`.
6. **Give every site an author** with only 2 test sites ticked (one with authors, one without) → one created, one skipped; status line and button state while running.
7. Migration plan (Task 8 Step 6) summary reviewed by Asaf.

- [ ] **Step 4: Commit (after Asaf's approval only)**

```bash
git add services/content-pipeline/src/authors services/content-pipeline/src/types.ts services/content-pipeline/src/lib/site-brief.ts services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/agents/content-generation/dedicated-agent.ts services/content-pipeline/src/agents/scheduled-publisher/index.ts services/content-pipeline/src/queue/content-generation.ts services/content-pipeline/src/scripts/migrate-authors.ts services/content-pipeline/src/scripts/migrate-authors-lib.ts services/content-pipeline/src/__tests__/migrate-authors.test.ts services/dashboard/src/lib/authors services/dashboard/src/components/authors services/dashboard/src/components/site-detail/SiteAuthorsSection.tsx services/dashboard/src/components/site-detail/__tests__/SiteAuthorsSection.test.tsx services/dashboard/src/components/site-detail/ContentAgentTab.tsx services/dashboard/src/app/api/sites/save/route.ts services/dashboard/src/actions/wizard.ts services/dashboard/src/app/authors services/dashboard/public/guide/26-authors.md docs/test-results/authors-stage4 docs/superpowers/plans/2026-10-12-authors-stage4-assignment-bylines-migration.md
git commit -m "feat(authors): best fit, site authors, bylines and migration (stage 4)"
```

---

## Rollout (end of Stage 4, each step with Asaf's OK)

1. Merge `asaf-dev` → `main`; `grid plug` (dashboard + pipeline, Stages 3 and 4).
2. Site worker (Stage 2): `pnpm deploy:staging`, check, `pnpm deploy:production`.
3. Network repo: push `sync-authors.yml` (worktree `scratchpad/net-authors`, branch `ci/sync-authors`) to `main`.
4. Production dashboard → Authors → **Give every site an author** (about 62 sites, roughly a minute each; untick test sites). Production writes go straight to Mongo too, so no backfill is needed for this step.
5. Migration: `plan` → Asaf reviews the JSON (Ella Hughes + about 260 re-credited articles, nothing waiting) → `apply` → review the commits → push main, then the staging branches.
6. `sync-authors.yml` runs on the `authors/**` pushes (KV `author:<id>`); re-seed all sites (`site-config.authors`, re-credited articles); `backfill-mongo` for the migrated sites (site-configs + articles).
