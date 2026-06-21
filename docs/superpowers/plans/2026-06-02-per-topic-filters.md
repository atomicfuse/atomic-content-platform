# Per-Topic Content Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **HARD GATE — read this before running any commit step:**
> Asaf tests every chunk locally before committing. **Do NOT run any `git add` / `git commit` / `git push` / `cloudgrid plug` / `wrangler deploy*` / `pnpm deploy:*` step until Asaf explicitly says "ok commit"** for the chunk in question. Tests, typechecks, and `cloudgrid dev` are fine. The commit steps below describe _what_ to commit when the time comes; they are not authorization to commit.

**Goal:** Introduce a per-topic content filter model so each topic (menu section) carries its own filter (raw `category_ids`/`tag_ids` OR a linked aggregator bundle) plus its own schedule. New sites and migrated sites use this model; legacy multi-bundle sites keep working unchanged.

**Architecture:** Presence of `brief.topics_v2` is the model discriminator. Content-pipeline's fetch dispatcher checks for it and either runs the new per-topic fan-out (with cross-topic membership tagging on each article) or falls back to the existing flat-bundle fan-out. The migration screen and the wizard's new Topic Filters step share one component (`PerTopicReviewScreen`) — AI proposes a filter per topic via a Claude-backed endpoint, user reviews/edits, the result writes `topics_v2` directly.

**Tech Stack:** TypeScript strict. Next.js 15 App Router. Vitest. Node 20 + Octokit. Astro 6 (site-worker rendering). `@anthropic-ai/sdk` (content-pipeline) for AI proposals. `@dnd-kit/sortable` (new dep on dashboard) for drag-to-reorder.

**Spec:** [docs/superpowers/specs/2026-06-02-per-topic-filters-design.md](../specs/2026-06-02-per-topic-filters-design.md)

---

## File Map

**Types:**

- [packages/shared-types/src/config.ts](../../../packages/shared-types/src/config.ts) — add `SiteBrief.theme`, `SiteBrief.topics_v2`, `TopicV2`, `TopicV2Source`
- [packages/shared-types/src/article.ts](../../../packages/shared-types/src/article.ts) — add `ArticleFrontmatter.topics?: string[]`
- [services/content-pipeline/src/types.ts](../../../services/content-pipeline/src/types.ts) — mirror

**Server-side:**

- [services/content-pipeline/src/agents/content-generation/index.ts](../../../services/content-pipeline/src/agents/content-generation/index.ts) — new POST `/propose-filter` route
- [services/content-pipeline/src/agents/content-generation/propose-filter.ts](../../../services/content-pipeline/src/agents/content-generation/propose-filter.ts) — new file: Claude call + taxonomy validation
- [services/dashboard/src/app/api/ai/propose-filter/route.ts](../../../services/dashboard/src/app/api/ai/propose-filter/route.ts) — new file: dashboard proxy to content-pipeline
- [services/dashboard/src/app/api/sites/save/route.ts](../../../services/dashboard/src/app/api/sites/save/route.ts) — handle `theme` + `topics_v2`; strip legacy on per-topic save
- [services/dashboard/src/actions/per-topic-migration.ts](../../../services/dashboard/src/actions/per-topic-migration.ts) — new file: `migrateSiteToPerTopic` server action

**Content pipeline (fetch path):**

- [services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts](../../../services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts) — new file: per-topic fetch helpers, schedule eligibility, cross-topic membership
- [services/content-pipeline/src/agents/content-generation/agent.ts](../../../services/content-pipeline/src/agents/content-generation/agent.ts) — dispatcher checks `topics_v2`; on present, calls per-topic path; on absent, takes legacy path

**Site-worker (rendering):**

- [packages/site-worker/src/pages/category/[topic].astro](../../../packages/site-worker/src/pages/category/%5Btopic%5D.astro) — read `frontmatter.topics` array if present, fall back to tag-based filter
- [packages/site-worker/src/pages/[slug]/index.astro](../../../packages/site-worker/src/pages/%5Bslug%5D/index.astro) — same fallback for sidebar category lists

**Dashboard UI — shared:**

- [services/dashboard/src/components/topic-review/PerTopicReviewScreen.tsx](../../../services/dashboard/src/components/topic-review/PerTopicReviewScreen.tsx) — new file: list-of-topics-with-AI-proposals review UI; hosted by both migration page and wizard step

**Dashboard UI — site detail:**

- [services/dashboard/src/components/site-detail/TopicsListPanel.tsx](../../../services/dashboard/src/components/site-detail/TopicsListPanel.tsx) — new file
- [services/dashboard/src/components/site-detail/TopicEditModal.tsx](../../../services/dashboard/src/components/site-detail/TopicEditModal.tsx) — new file
- [services/dashboard/src/components/site-detail/ContentAgentTab.tsx](../../../services/dashboard/src/components/site-detail/ContentAgentTab.tsx) — conditionally render TopicsListPanel when `brief.topics_v2` present

**Dashboard UI — migration:**

- [services/dashboard/src/app/sites/[domain]/migrate-per-topic/page.tsx](../../../services/dashboard/src/app/sites/%5Bdomain%5D/migrate-per-topic/page.tsx) — new file: full-page migration screen
- [services/dashboard/src/components/site-detail/MigrateToPerTopicToggle.tsx](../../../services/dashboard/src/components/site-detail/MigrateToPerTopicToggle.tsx) — new file: toggle on Identity tab (only on legacy sites)

**Dashboard UI — wizard:**

- [services/dashboard/src/components/wizard/StepTopicFilters.tsx](../../../services/dashboard/src/components/wizard/StepTopicFilters.tsx) — new file: replaces StepNicheTargeting
- [services/dashboard/src/components/wizard/StepNicheTargeting.tsx](../../../services/dashboard/src/components/wizard/StepNicheTargeting.tsx) — deleted
- [services/dashboard/src/components/wizard/StepIdentity.tsx](../../../services/dashboard/src/components/wizard/StepIdentity.tsx) — adds Site Theme textarea
- [services/dashboard/src/app/wizard/page.tsx](../../../services/dashboard/src/app/wizard/page.tsx) — step list updated; DEFAULT_FORM updated
- [services/dashboard/src/types/dashboard.ts](../../../services/dashboard/src/types/dashboard.ts) — `WizardFormData` updated (adds `theme`, `topics_v2`; removes `bundleIds`, `starterBundle`, `selectedCategories`, `selectedTags`)
- [services/dashboard/src/actions/wizard.ts](../../../services/dashboard/src/actions/wizard.ts) — `createSiteAndBuildStaging` writes `topics_v2`; never writes legacy bundle fields for new sites

**Tests (new):**

- [services/content-pipeline/src/**tests**/propose-filter.test.ts](../../../services/content-pipeline/src/__tests__/propose-filter.test.ts) — taxonomy validation + Claude mock
- [services/content-pipeline/src/**tests**/per-topic-fetch.test.ts](../../../services/content-pipeline/src/__tests__/per-topic-fetch.test.ts) — schedule eligibility, cross-topic membership, dispatcher
- [services/content-pipeline/src/**tests**/legacy-path-regression.test.ts](../../../services/content-pipeline/src/__tests__/legacy-path-regression.test.ts) — verify legacy sites still go through legacy fan-out unchanged
- [services/dashboard/src/actions/**tests**/per-topic-migration.test.ts](../../../services/dashboard/src/actions/__tests__/per-topic-migration.test.ts) — migration server action

**Docs:**

- [services/dashboard/public/guide/21-per-topic-filters.md](../../../services/dashboard/public/guide/21-per-topic-filters.md) — new guide page
- [services/dashboard/src/app/guide/page.tsx](../../../services/dashboard/src/app/guide/page.tsx) — register new page

---

## Task 1: Types — `theme`, `TopicV2`, `topics_v2`, article `topics[]`

Pure type addition. No logic. Keeps the spec's data model in the type layer first so subsequent tasks compile cleanly.

**Files:**

- Modify: `packages/shared-types/src/config.ts` (insert after the existing `bundle_ids` field on `SiteBrief`)
- Modify: `services/content-pipeline/src/types.ts` (mirror)
- Modify: `packages/shared-types/src/article.ts` (add `topics?: string[]` to `ArticleFrontmatter`)

- [ ] **Step 1.1: Add the TopicV2 types**

Edit `packages/shared-types/src/config.ts`. Find the existing `bundle_ids?: string[]` field on `SiteBrief` (around line 99) and add **after** it (still inside the SiteBrief interface):

```ts
  /** Free-text site theme (1–2 lines). Drives AI proposals in the per-topic model.
   *  Required on sites that have `topics_v2` set. */
  theme?: string;

  /** Per-topic filters — the new editorial model. Presence of this field
   *  switches the site to the per-topic path everywhere (UI, content fetch).
   *  Absence means the site uses the legacy `bundle_ids` model.
   *  Migration is opt-in per site; the two shapes never need to coexist on the
   *  same site (a `topics_v2` save strips `bundle_ids` and the legacy niche
   *  fields). */
  topics_v2?: TopicV2[];
}
```

Then **outside** the `SiteBrief` interface, add the new types. Insert immediately after the closing `}` of `SiteBrief`:

```ts
/** One topic (menu section) in the per-topic model.
 *  Carries its own filter (where to source content from) and its own schedule
 *  (when + how much to publish). */
export interface TopicV2 {
  /** Display name of the topic. Also used as the menu item label on the site
   *  and as a membership key in article frontmatter. Unique per site (case-insensitive). */
  name: string;
  /** Optional 1-line description that helps the AI propose better filters.
   *  Not shown anywhere on the live site. */
  description?: string;
  /** Where this topic pulls its content from. */
  source: TopicV2Source;
  /** Publishing cadence for this topic. */
  schedule: TopicV2Schedule;
}

/** A topic's filter source — either raw categories+tags (default) or a pointer
 *  to a shared aggregator bundle (power-user path). */
export type TopicV2Source =
  | { type: "filter"; category_ids: string[]; tag_ids: string[] }
  | { type: "bundle"; bundle_id: string };

export interface TopicV2Schedule {
  /** Target articles per calendar week. */
  articles_per_week: number;
  /** Days of the week (full names: "Monday"..."Sunday") on which this topic
   *  is eligible to publish. Empty array = never publish. */
  preferred_days: string[];
}
```

- [ ] **Step 1.2: Mirror in content-pipeline**

Edit `services/content-pipeline/src/types.ts`. Find the existing `bundle_ids?: string[]` field on `SiteBrief` (around line 83) and apply the same `theme` + `topics_v2` field additions immediately after. Then add the same three exported types (`TopicV2`, `TopicV2Source`, `TopicV2Schedule`) after the SiteBrief interface closes.

- [ ] **Step 1.3: Add `topics` to ArticleFrontmatter**

Edit `packages/shared-types/src/article.ts`. Find the line:

```ts
  /** Taxonomy tags for categorisation and filtering. */
  tags: string[];
```

(around line 44-45). Insert **after** the `tags` field:

```ts
  /** Topic-membership list (per-topic-filter model). The first entry is the
   *  primary topic (the one the article was fetched against); subsequent
   *  entries are secondary topics whose filters also matched this article.
   *  Absent on legacy-site articles, which are filtered to topic pages via
   *  the `tags` field instead. */
  topics?: string[];
```

- [ ] **Step 1.4: Typecheck both packages**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/shared-types && pnpm typecheck
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm typecheck
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: all three pass with zero errors. The additions are purely optional fields, so no existing call site breaks.

- [ ] **Step 1.5: ~~Commit~~ — DO NOT COMMIT (HARD GATE — wait for Asaf approval).**

---

## Task 2: Content-pipeline `propose-filter` endpoint

A new POST endpoint on the content-pipeline server that calls Claude to propose a filter for a single topic. The dashboard proxies to it (Task 3).

The endpoint receives the site theme + topic name + topic description + the aggregator's full taxonomy (categories + tags) and returns a validated `{category_ids, tag_ids, rationale}` payload. IDs not present in the supplied taxonomy are dropped before returning.

**Files:**

- Create: `services/content-pipeline/src/agents/content-generation/propose-filter.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (add `/propose-filter` route)
- Create: `services/content-pipeline/src/__tests__/propose-filter.test.ts`

- [ ] **Step 2.1: Write the new file `propose-filter.ts`**

Create `services/content-pipeline/src/agents/content-generation/propose-filter.ts` with:

```ts
/**
 * AI Filter Proposal — given a site theme + topic name + description + the
 * aggregator's taxonomy, ask Claude to propose category_ids and tag_ids that
 * fit the topic on this site. Returns a validated payload (unknown IDs are
 * dropped before returning).
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ProposeFilterTaxonomyCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface ProposeFilterTaxonomyTag {
  id: string;
  name: string;
  usage_count?: number;
}

export interface ProposeFilterRequest {
  siteTheme: string;
  topicName: string;
  topicDescription?: string;
  categories: ProposeFilterTaxonomyCategory[];
  tags: ProposeFilterTaxonomyTag[];
}

export interface ProposeFilterResponse {
  category_ids: string[];
  tag_ids: string[];
  rationale: string;
  /** IDs Claude returned that were not found in the supplied taxonomy.
   *  Empty under normal operation; surfaced for diagnostic logging. */
  dropped_unknown_ids: string[];
}

const CLAUDE_MODEL = "claude-opus-4-7";

export async function proposeFilter(
  req: ProposeFilterRequest,
  apiKey: string,
): Promise<ProposeFilterResponse> {
  if (!req.siteTheme.trim()) {
    throw new Error("siteTheme is required");
  }
  if (!req.topicName.trim()) {
    throw new Error("topicName is required");
  }

  const validCategoryIds = new Set(req.categories.map((c) => c.id));
  const validTagIds = new Set(req.tags.map((t) => t.id));

  const categoriesList = req.categories
    .map((c) => {
      const parent = c.parent_id
        ? (req.categories.find((p) => p.id === c.parent_id)?.name ??
          "(unknown)")
        : "tier-1";
      return `${c.id} | ${c.name} (${parent})`;
    })
    .join("\n");

  // Sort tags by usage_count desc so the most-used ones appear first — gives
  // Claude a soft preference signal without explicit instruction.
  const sortedTags = [...req.tags].sort(
    (a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0),
  );
  const tagsList = sortedTags
    .map((t) =>
      t.usage_count != null
        ? `${t.id} | ${t.name} | uses=${t.usage_count}`
        : `${t.id} | ${t.name}`,
    )
    .join("\n");

  const prompt = `You are proposing a content filter for a topic on an editorial site.

Site theme: ${req.siteTheme}
Topic name: ${req.topicName}
Topic description: ${req.topicDescription || "(none)"}

Available categories (id | name (parent)):
${categoriesList}

Available tags (id | name | uses):
${tagsList}

Constraints:
- Pick ONLY category_ids and tag_ids from the lists above. Never invent IDs.
- If no good match exists for a concept, omit it rather than picking a tangential alternative.
- Prefer tags with higher usage_count when equivalent options exist.
- A good filter has 1–4 category_ids and 3–8 tag_ids, but follow the topic's needs.

Return JSON only, no surrounding prose:
{ "category_ids": [...], "tag_ids": [...], "rationale": "1-2 sentence explanation" }`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("");

  // Extract the JSON object — Claude may wrap it in markdown fences.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude returned no JSON object: ${text.slice(0, 200)}`);
  }
  let parsed: {
    category_ids?: unknown;
    tag_ids?: unknown;
    rationale?: unknown;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(
      `Claude returned invalid JSON: ${jsonMatch[0].slice(0, 200)}`,
    );
  }

  const rawCategoryIds = Array.isArray(parsed.category_ids)
    ? parsed.category_ids
    : [];
  const rawTagIds = Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [];
  const rationale =
    typeof parsed.rationale === "string" ? parsed.rationale : "";

  const validatedCategoryIds: string[] = [];
  const validatedTagIds: string[] = [];
  const droppedUnknownIds: string[] = [];

  for (const id of rawCategoryIds) {
    if (typeof id === "string" && validCategoryIds.has(id)) {
      validatedCategoryIds.push(id);
    } else if (typeof id === "string") {
      droppedUnknownIds.push(id);
    }
  }
  for (const id of rawTagIds) {
    if (typeof id === "string" && validTagIds.has(id)) {
      validatedTagIds.push(id);
    } else if (typeof id === "string") {
      droppedUnknownIds.push(id);
    }
  }

  if (droppedUnknownIds.length > 0) {
    console.warn(
      `[propose-filter] Dropped ${droppedUnknownIds.length} unknown IDs from Claude response:`,
      droppedUnknownIds,
    );
  }

  return {
    category_ids: validatedCategoryIds,
    tag_ids: validatedTagIds,
    rationale,
    dropped_unknown_ids: droppedUnknownIds,
  };
}
```

- [ ] **Step 2.2: Write unit tests for taxonomy validation**

Create `services/content-pipeline/src/__tests__/propose-filter.test.ts`:

````ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK so tests don't make real API calls
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

import Anthropic from "@anthropic-ai/sdk";
import {
  proposeFilter,
  type ProposeFilterRequest,
} from "../agents/content-generation/propose-filter.js";

function makeRequest(
  overrides: Partial<ProposeFilterRequest> = {},
): ProposeFilterRequest {
  return {
    siteTheme: "Travel and eating while traveling",
    topicName: "Wine & Beer",
    topicDescription: "Wine and brewery culture for travelers",
    categories: [
      { id: "cat-travel", name: "Travel", parent_id: null },
      { id: "cat-food", name: "Food & Drink", parent_id: null },
      { id: "cat-alc", name: "Alcoholic Beverages", parent_id: "cat-food" },
    ],
    tags: [
      { id: "tag-wine-tourism", name: "wine-tourism", usage_count: 50 },
      { id: "tag-culinary-travel", name: "culinary-travel", usage_count: 80 },
    ],
    ...overrides,
  };
}

function mockClaudeResponse(jsonStr: string): void {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: jsonStr }],
  });
  vi.mocked(Anthropic).mockImplementation(
    (): unknown =>
      ({
        messages: { create: mockCreate },
      }) as unknown as InstanceType<typeof Anthropic>,
  );
}

describe("proposeFilter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns validated category_ids and tag_ids when Claude returns valid IDs", async () => {
    mockClaudeResponse(
      JSON.stringify({
        category_ids: ["cat-alc"],
        tag_ids: ["tag-wine-tourism", "tag-culinary-travel"],
        rationale: "Wine/beer with travel context",
      }),
    );

    const result = await proposeFilter(makeRequest(), "test-key");

    expect(result.category_ids).toEqual(["cat-alc"]);
    expect(result.tag_ids).toEqual(["tag-wine-tourism", "tag-culinary-travel"]);
    expect(result.rationale).toBe("Wine/beer with travel context");
    expect(result.dropped_unknown_ids).toEqual([]);
  });

  it("drops unknown IDs that Claude hallucinates", async () => {
    mockClaudeResponse(
      JSON.stringify({
        category_ids: ["cat-alc", "cat-doesnt-exist"],
        tag_ids: ["tag-wine-tourism", "tag-fake-hallucination"],
        rationale: "...",
      }),
    );

    const result = await proposeFilter(makeRequest(), "test-key");

    expect(result.category_ids).toEqual(["cat-alc"]);
    expect(result.tag_ids).toEqual(["tag-wine-tourism"]);
    expect(result.dropped_unknown_ids.sort()).toEqual(
      ["cat-doesnt-exist", "tag-fake-hallucination"].sort(),
    );
  });

  it("extracts JSON when Claude wraps it in markdown code fences", async () => {
    mockClaudeResponse(
      "Here's my proposal:\n```json\n" +
        JSON.stringify({
          category_ids: ["cat-alc"],
          tag_ids: [],
          rationale: "...",
        }) +
        "\n```\nHope that helps!",
    );

    const result = await proposeFilter(makeRequest(), "test-key");
    expect(result.category_ids).toEqual(["cat-alc"]);
  });

  it("throws when Claude returns no JSON at all", async () => {
    mockClaudeResponse("Sorry, I cannot help with that request.");
    await expect(proposeFilter(makeRequest(), "test-key")).rejects.toThrow(
      /no JSON/,
    );
  });

  it("throws when Claude returns malformed JSON", async () => {
    mockClaudeResponse('{ "category_ids": [bad json');
    await expect(proposeFilter(makeRequest(), "test-key")).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it("throws when siteTheme is empty", async () => {
    await expect(
      proposeFilter(makeRequest({ siteTheme: "" }), "test-key"),
    ).rejects.toThrow(/siteTheme is required/);
  });
});
````

- [ ] **Step 2.3: Run the new tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm test -- propose-filter
```

Expected: 6/6 pass.

- [ ] **Step 2.4: Add the HTTP route**

Edit `services/content-pipeline/src/agents/content-generation/index.ts`. Locate the existing route dispatcher (where `/content-generate` is handled — search for `/content-generate`). Add a sibling route for `/propose-filter` before the catch-all 404. Add this handler function near the top of the file alongside the other handler functions:

```ts
async function handleProposeFilter(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { status: "error", message: "Method not allowed" });
    return;
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 413, { status: "error", message: "Payload too large" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  const p = payload as Record<string, unknown>;
  if (typeof p.siteTheme !== "string" || typeof p.topicName !== "string") {
    sendJson(res, 400, {
      status: "error",
      message: "siteTheme and topicName are required strings",
    });
    return;
  }

  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    sendJson(res, 500, {
      status: "error",
      message: "ANTHROPIC_API_KEY not configured",
    });
    return;
  }

  try {
    const { proposeFilter } = await import("./propose-filter.js");
    const result = await proposeFilter(
      {
        siteTheme: p.siteTheme,
        topicName: p.topicName,
        topicDescription:
          typeof p.topicDescription === "string"
            ? p.topicDescription
            : undefined,
        categories: Array.isArray(p.categories)
          ? (p.categories as Parameters<typeof proposeFilter>[0]["categories"])
          : [],
        tags: Array.isArray(p.tags)
          ? (p.tags as Parameters<typeof proposeFilter>[0]["tags"])
          : [],
      },
      apiKey,
    );
    sendJson(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[propose-filter] Error:", message);
    sendJson(res, 502, { status: "error", message });
  }
}
```

Then in the main `handleRequest` function (or the URL dispatcher — find the block that matches `req.url === "/content-generate"`), add a sibling branch BEFORE the 404 fallback:

```ts
if (req.url === "/propose-filter") {
  await handleProposeFilter(req, res, config);
  return;
}
```

If the existing dispatcher uses early returns, place the new branch at the same nesting level. If it uses a switch, add a `case "/propose-filter":` branch.

- [ ] **Step 2.5: Add `anthropicApiKey` to AgentConfig if it isn't already there**

```bash
grep -n "anthropicApiKey\|ANTHROPIC_API_KEY" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline/src/lib/config.ts
```

If a match appears (the field is already populated from `process.env.ANTHROPIC_API_KEY`), no change is needed. If not, add it to the config interface and `loadConfig()` exactly like the existing `geminiApiKey` field — read from `process.env.ANTHROPIC_API_KEY`.

- [ ] **Step 2.6: Typecheck content-pipeline**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 2.7: Commit (GATED).**

---

## Task 3: Dashboard `/api/ai/propose-filter` proxy

Thin Next.js route that forwards a request to the content-pipeline's `/propose-filter` endpoint. Uses the same `CONTENT_AGENT_URL` + local-dev fallback pattern as `/api/agent/generate`.

**Files:**

- Create: `services/dashboard/src/app/api/ai/propose-filter/route.ts`

- [ ] **Step 3.1: Write the route file**

Create `services/dashboard/src/app/api/ai/propose-filter/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const agentUrl = getAgentUrl();
  try {
    const resp = await fetch(`${agentUrl}/propose-filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach content agent";
    return NextResponse.json(
      { status: "error", message: `Content agent unavailable: ${message}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3.2: Typecheck dashboard**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3.3: Commit (GATED).**

---

## Task 4: Per-topic fetch helpers — schedule eligibility, cross-topic membership

Pure-function helpers extracted into a new file so they're easy to unit-test. The dispatcher and the per-topic fetch path (Task 5) will call into these.

**Files:**

- Create: `services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts`
- Create: `services/content-pipeline/src/__tests__/per-topic-fetch.test.ts`

- [ ] **Step 4.1: Write the helpers file**

Create `services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts`:

```ts
/**
 * Per-topic content fetch helpers.
 *
 * Used when a site's brief carries `topics_v2` (the new per-topic model).
 * The dispatcher in agent.ts checks for this field and calls into the helpers
 * here; legacy sites take the existing flat-bundle path unchanged.
 */

import type { TopicV2, SiteBrief } from "../../types.js";
import type { ContentItem } from "./types.js";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Return the topic's per-run article target.
 *  We don't track week-level budgets across runs; instead each preferred-day
 *  run aims for `ceil(articles_per_week / preferred_days.length)` items. Over
 *  a week the budget is approximately respected. */
export function computePerRunTarget(schedule: TopicV2["schedule"]): number {
  if (!schedule.articles_per_week || schedule.articles_per_week <= 0) return 0;
  const daysCount = schedule.preferred_days.length;
  if (daysCount === 0) return 0;
  return Math.ceil(schedule.articles_per_week / daysCount);
}

/** Check whether the given date falls on one of this topic's preferred days. */
export function isTopicEligibleToday(
  schedule: TopicV2["schedule"],
  now: Date = new Date(),
): boolean {
  if (computePerRunTarget(schedule) === 0) return false;
  const dayName = DAY_NAMES[now.getDay()];
  return schedule.preferred_days.includes(dayName);
}

/** Evaluate whether an article matches a topic's filter rules.
 *
 *  Mirrors the aggregator's bundle filter semantic: OR within each dimension,
 *  AND across dimensions (an item must overlap every non-empty dimension).
 *  Empty dimensions are treated as "no constraint".
 *
 *  For topics with `source.type === "bundle"`, we treat the bundle as opaque:
 *  the article matches iff it was fetched against that bundle id (the caller
 *  passes `wasFetchedFromBundleId` to indicate this). Cross-topic evaluation
 *  against a bundle-source topic without re-querying isn't possible from
 *  metadata alone, so we under-match (false negatives) rather than guess.
 */
export function articleMatchesTopicFilter(
  item: ContentItem,
  topic: TopicV2,
  wasFetchedFromBundleId?: string,
): boolean {
  if (topic.source.type === "bundle") {
    return wasFetchedFromBundleId === topic.source.bundle_id;
  }
  const itemCategoryIds = new Set(item.category_ids ?? []);
  const itemTagIds = new Set(item.tag_ids ?? []);

  const wantCats = topic.source.category_ids;
  const wantTags = topic.source.tag_ids;

  const catsOk =
    wantCats.length === 0 || wantCats.some((id) => itemCategoryIds.has(id));
  const tagsOk =
    wantTags.length === 0 || wantTags.some((id) => itemTagIds.has(id));

  // OR-within / AND-across — both dimensions must be satisfied (or empty).
  // If both dimensions are empty the topic matches everything, which is
  // intentional (an unconfigured filter is effectively "anything"); callers
  // should treat an unset filter as "empty topic, skip" upstream.
  return catsOk && tagsOk;
}

/** For an item fetched as part of `primaryTopic`'s run, find all OTHER topics
 *  on this site whose filters also match it. Returns an ordered list of
 *  topic names: primary first, then secondaries.
 *
 *  Bundle-source topics other than the primary are not evaluated as
 *  secondaries — we can't tell from the item alone whether it belongs to an
 *  arbitrary bundle without an aggregator round-trip. They simply never
 *  receive cross-topic assignments from other topics' fetches.
 */
export function resolveArticleTopics(
  item: ContentItem,
  primaryTopic: TopicV2,
  allTopics: TopicV2[],
  primaryFetchedFromBundleId?: string,
): string[] {
  const result = [primaryTopic.name];
  for (const t of allTopics) {
    if (t.name === primaryTopic.name) continue;
    if (t.source.type === "bundle") continue; // see comment above
    if (articleMatchesTopicFilter(item, t)) {
      result.push(t.name);
    }
  }
  // Suppress the unused-parameter lint by referencing it; the parameter exists
  // for future use (e.g. cross-topic against a known bundle).
  void primaryFetchedFromBundleId;
  return result;
}

/** Discriminator: does this brief use the per-topic model?
 *  Presence (and non-emptiness) of `topics_v2` is the signal. */
export function isPerTopicSite(brief: SiteBrief): boolean {
  return Array.isArray(brief.topics_v2) && brief.topics_v2.length > 0;
}
```

- [ ] **Step 4.2: Write unit tests**

Create `services/content-pipeline/src/__tests__/per-topic-fetch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computePerRunTarget,
  isTopicEligibleToday,
  articleMatchesTopicFilter,
  resolveArticleTopics,
  isPerTopicSite,
} from "../agents/content-generation/per-topic-fetch.js";
import type { TopicV2, SiteBrief } from "../types.js";
import type { ContentItem } from "../agents/content-generation/types.js";

function makeTopic(overrides: Partial<TopicV2> = {}): TopicV2 {
  return {
    name: "Wine & Beer",
    source: {
      type: "filter",
      category_ids: ["cat-alc"],
      tag_ids: ["tag-wine"],
    },
    schedule: { articles_per_week: 1, preferred_days: ["Tuesday"] },
    ...overrides,
  };
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "i1",
    url: "https://example.com/a",
    title: "An article",
    description: "",
    summary: "",
    thumbnail: null,
    content_type: "article",
    vertical: null,
    categories: [],
    tags: [],
    audience_types: [],
    source: { name: "test" },
    published_at: "2026-06-02T00:00:00Z",
    language: "EN",
    category_ids: ["cat-alc"],
    tag_ids: ["tag-wine"],
    ...overrides,
  } as ContentItem;
}

describe("computePerRunTarget", () => {
  it("returns ceil(articles_per_week / preferred_days.length)", () => {
    expect(
      computePerRunTarget({
        articles_per_week: 3,
        preferred_days: ["Mon", "Wed", "Fri"],
      }),
    ).toBe(1);
    expect(
      computePerRunTarget({
        articles_per_week: 2,
        preferred_days: ["Tue", "Thu"],
      }),
    ).toBe(1);
    expect(
      computePerRunTarget({
        articles_per_week: 5,
        preferred_days: ["Mon", "Wed"],
      }),
    ).toBe(3);
  });

  it("returns 0 when articles_per_week is 0", () => {
    expect(
      computePerRunTarget({ articles_per_week: 0, preferred_days: ["Mon"] }),
    ).toBe(0);
  });

  it("returns 0 when preferred_days is empty", () => {
    expect(
      computePerRunTarget({ articles_per_week: 5, preferred_days: [] }),
    ).toBe(0);
  });
});

describe("isTopicEligibleToday", () => {
  // 2026-06-02 is a Tuesday — known fixed date for these tests
  const TUESDAY = new Date("2026-06-02T12:00:00Z");
  const WEDNESDAY = new Date("2026-06-03T12:00:00Z");

  it("returns true when today is in preferred_days", () => {
    expect(
      isTopicEligibleToday(
        { articles_per_week: 1, preferred_days: ["Tuesday"] },
        TUESDAY,
      ),
    ).toBe(true);
  });

  it("returns false when today is not in preferred_days", () => {
    expect(
      isTopicEligibleToday(
        { articles_per_week: 1, preferred_days: ["Tuesday"] },
        WEDNESDAY,
      ),
    ).toBe(false);
  });

  it("returns false when articles_per_week is 0 even on preferred day", () => {
    expect(
      isTopicEligibleToday(
        { articles_per_week: 0, preferred_days: ["Tuesday"] },
        TUESDAY,
      ),
    ).toBe(false);
  });
});

describe("articleMatchesTopicFilter", () => {
  it("matches when item categories include any topic category AND item tags include any topic tag", () => {
    const item = makeItem({
      category_ids: ["cat-alc"],
      tag_ids: ["tag-wine", "tag-other"],
    });
    expect(articleMatchesTopicFilter(item, makeTopic())).toBe(true);
  });

  it("does NOT match when categories overlap but tags don't (AND across)", () => {
    const item = makeItem({
      category_ids: ["cat-alc"],
      tag_ids: ["tag-other"],
    });
    expect(articleMatchesTopicFilter(item, makeTopic())).toBe(false);
  });

  it("does NOT match when tags overlap but categories don't", () => {
    const item = makeItem({
      category_ids: ["cat-other"],
      tag_ids: ["tag-wine"],
    });
    expect(articleMatchesTopicFilter(item, makeTopic())).toBe(false);
  });

  it("ignores empty dimensions (tag_ids empty → no tag constraint)", () => {
    const topic = makeTopic({
      source: { type: "filter", category_ids: ["cat-alc"], tag_ids: [] },
    });
    const item = makeItem({ category_ids: ["cat-alc"], tag_ids: [] });
    expect(articleMatchesTopicFilter(item, topic)).toBe(true);
  });

  it("bundle-source matches only when wasFetchedFromBundleId equals topic's bundle_id", () => {
    const topic = makeTopic({ source: { type: "bundle", bundle_id: "b1" } });
    const item = makeItem();
    expect(articleMatchesTopicFilter(item, topic, "b1")).toBe(true);
    expect(articleMatchesTopicFilter(item, topic, "b2")).toBe(false);
    expect(articleMatchesTopicFilter(item, topic)).toBe(false);
  });
});

describe("resolveArticleTopics", () => {
  it("puts the primary topic first and adds matching secondaries", () => {
    const primary = makeTopic({ name: "Wine & Beer" });
    const allTopics: TopicV2[] = [
      primary,
      {
        name: "Food around the world",
        source: {
          type: "filter",
          category_ids: ["cat-alc", "cat-dining"],
          tag_ids: ["tag-wine", "tag-food"],
        },
        schedule: { articles_per_week: 2, preferred_days: [] },
      },
      {
        name: "Tech News",
        source: {
          type: "filter",
          category_ids: ["cat-tech"],
          tag_ids: ["tag-ai"],
        },
        schedule: { articles_per_week: 1, preferred_days: [] },
      },
    ];
    const item = makeItem({ category_ids: ["cat-alc"], tag_ids: ["tag-wine"] });

    const result = resolveArticleTopics(item, primary, allTopics);
    expect(result).toEqual(["Wine & Beer", "Food around the world"]);
  });

  it("skips bundle-source topics when evaluating secondaries (can't match without round-trip)", () => {
    const primary = makeTopic({ name: "Wine & Beer" });
    const allTopics: TopicV2[] = [
      primary,
      {
        name: "Linked News",
        source: { type: "bundle", bundle_id: "b-news" },
        schedule: { articles_per_week: 1, preferred_days: [] },
      },
    ];
    const item = makeItem();
    const result = resolveArticleTopics(item, primary, allTopics);
    expect(result).toEqual(["Wine & Beer"]);
  });
});

describe("isPerTopicSite", () => {
  it("returns true when topics_v2 is a non-empty array", () => {
    const brief: SiteBrief = {
      audience: "x",
      tone: "x",
      article_types: { standard: 100 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: [] },
      topics_v2: [
        {
          name: "Wine & Beer",
          source: { type: "filter", category_ids: ["c1"], tag_ids: [] },
          schedule: { articles_per_week: 1, preferred_days: ["Tuesday"] },
        },
      ],
    };
    expect(isPerTopicSite(brief)).toBe(true);
  });

  it("returns false when topics_v2 is undefined", () => {
    const brief: SiteBrief = {
      audience: "x",
      tone: "x",
      article_types: { standard: 100 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: [] },
    };
    expect(isPerTopicSite(brief)).toBe(false);
  });

  it("returns false when topics_v2 is an empty array", () => {
    const brief: SiteBrief = {
      audience: "x",
      tone: "x",
      article_types: { standard: 100 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: [] },
      topics_v2: [],
    };
    expect(isPerTopicSite(brief)).toBe(false);
  });
});
```

- [ ] **Step 4.3: Run the new tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm test -- per-topic-fetch
```

Expected: 13/13 pass.

- [ ] **Step 4.4: Typecheck content-pipeline**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4.5: Commit (GATED).**

---

## Task 5: Per-topic fetch path in agent.ts

Wire the per-topic helpers into the content-generation agent. The dispatcher checks `isPerTopicSite(brief)`: if true, run the new path; otherwise fall back to the existing flat-bundle fan-out (untouched).

The new path iterates `brief.topics_v2`. For each eligible topic (today is a preferred day): fetch from the topic's source (raw filter or bundle), respect per-topic target, and after items are picked, call `resolveArticleTopics()` to compute the article's `topics: string[]` frontmatter array (primary + secondaries from cross-topic matching).

**Files:**

- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts`

- [ ] **Step 5.1: Find the dispatcher**

Open `services/content-pipeline/src/agents/content-generation/agent.ts` and locate `runContentGeneration` (search for `export async function runContentGeneration`). Find where the brief is loaded and the existing fan-out begins (around the call to `getSiteBrief` followed by the section that computes `mergedCategoryIds` and then calls `fetchNewItemsUnion`).

- [ ] **Step 5.2: Insert the dispatcher check**

Immediately AFTER the brief is loaded (and the legacy `bundle_id` → `bundle_ids` shim runs at the top of the function) but BEFORE the legacy `mergedCategoryIds` / `fetchNewItemsUnion` block, add:

```ts
// Per-topic dispatcher. When brief.topics_v2 is present, take the new path
// and skip the legacy flat-bundle fan-out entirely. Legacy sites (no topics_v2)
// continue through the existing fan-out below unchanged.
{
  const { isPerTopicSite } = await import("./per-topic-fetch.js");
  if (isPerTopicSite(brief)) {
    return await runPerTopicGeneration({
      siteDomain,
      siteName,
      author: siteAuthor,
      brief,
      branch,
      count,
      jobId,
      config,
      existing,
      tagIds,
    });
  }
}
```

(The destructured names `siteDomain`, `siteName`, `siteAuthor`, `brief`, `branch`, `count`, `jobId`, `config`, `existing`, `tagIds` are the same variable names already in scope at this point of `runContentGeneration`. If any of those names differs in the current code — for example `tagIds` might already have been resolved earlier — adapt to the actual names at hand.)

- [ ] **Step 5.3: Add `runPerTopicGeneration` as a sibling function**

In the same file, add a new function `runPerTopicGeneration` AFTER `runContentGeneration`:

```ts
/** Per-topic generation path. Iterates brief.topics_v2, fetches per topic,
 *  computes cross-topic membership, writes articles with `topics: []` frontmatter. */
async function runPerTopicGeneration(args: {
  siteDomain: string;
  siteName: string;
  author?: string;
  brief: SiteBrief;
  branch?: string;
  count?: number;
  jobId?: string;
  config: AgentConfig;
  existing: { urls: Set<string>; titles: Set<string> };
  tagIds: string[] | undefined;
}): Promise<BatchContentGenerationResult> {
  const { brief, siteDomain, config, existing } = args;
  const topics = brief.topics_v2 ?? [];

  const { isTopicEligibleToday, computePerRunTarget, resolveArticleTopics } =
    await import("./per-topic-fetch.js");

  const settings = await getSettings();

  // Decide which topics run this tick.
  const eligibleTopics = topics.filter((t) => isTopicEligibleToday(t.schedule));

  // Aggregate counters for the batch result.
  let totalSourced = 0;
  let duplicateCount = 0;
  const allResults: ContentGenerationResult[] = [];

  // Per-bundle-call dedupe sets shared across topics in this run so the same
  // item doesn't go to two topics' primary slots.
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  for (const topic of eligibleTopics) {
    const perRunTarget = computePerRunTarget(topic.schedule);
    if (perRunTarget === 0) continue;

    // Fetch per the topic's source.
    let perTopicItems: ContentItem[] = [];
    let fetchedFromBundleId: string | undefined;

    if (topic.source.type === "filter") {
      const PAGE_SIZE = 20;
      const MAX_PAGES = 5;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await getContent({
          limit: PAGE_SIZE,
          page,
          language: brief.language ?? "EN",
          category_ids:
            topic.source.category_ids.length > 0
              ? topic.source.category_ids
              : undefined,
          tag_ids:
            topic.source.tag_ids.length > 0 ? topic.source.tag_ids : undefined,
        });
        totalSourced += response.items.length;
        if (response.items.length === 0) break;
        for (const item of response.items) {
          if (existing.urls.has(normalizeUrl(item.url))) {
            duplicateCount++;
            continue;
          }
          if (existing.titles.has(normalizeTitleKey(item.title))) {
            duplicateCount++;
            continue;
          }
          if (
            seenIds.has(item.id) ||
            seenUrls.has(normalizeUrl(item.url)) ||
            seenTitles.has(normalizeTitleKey(item.title))
          ) {
            duplicateCount++;
            continue;
          }
          seenIds.add(item.id);
          seenUrls.add(normalizeUrl(item.url));
          seenTitles.add(normalizeTitleKey(item.title));
          perTopicItems.push(item);
          if (perTopicItems.length >= perRunTarget) break;
        }
        if (perTopicItems.length >= perRunTarget) break;
        if (page >= (response.total_pages ?? 1)) break;
      }
    } else {
      // bundle source
      fetchedFromBundleId = topic.source.bundle_id;
      const PAGE_SIZE = 20;
      const MAX_PAGES = 5;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await getContent({
          limit: PAGE_SIZE,
          page,
          language: brief.language ?? "EN",
          bundle_id: topic.source.bundle_id,
        });
        totalSourced += response.items.length;
        if (response.items.length === 0) break;
        for (const item of response.items) {
          if (existing.urls.has(normalizeUrl(item.url))) {
            duplicateCount++;
            continue;
          }
          if (existing.titles.has(normalizeTitleKey(item.title))) {
            duplicateCount++;
            continue;
          }
          if (
            seenIds.has(item.id) ||
            seenUrls.has(normalizeUrl(item.url)) ||
            seenTitles.has(normalizeTitleKey(item.title))
          ) {
            duplicateCount++;
            continue;
          }
          seenIds.add(item.id);
          seenUrls.add(normalizeUrl(item.url));
          seenTitles.add(normalizeTitleKey(item.title));
          perTopicItems.push(item);
          if (perTopicItems.length >= perRunTarget) break;
        }
        if (perTopicItems.length >= perRunTarget) break;
        if (page >= (response.total_pages ?? 1)) break;
      }
    }

    if (perTopicItems.length === 0) {
      console.log(
        `[agent] [per-topic] topic="${topic.name}" — no new items this run`,
      );
      continue;
    }

    // Generate articles for each item; tag with cross-topic membership.
    for (const item of perTopicItems) {
      const topicNames = resolveArticleTopics(
        item,
        topic,
        topics,
        fetchedFromBundleId,
      );
      const result = await generateOneArticle({
        item,
        siteDomain,
        siteName: args.siteName,
        author: args.author,
        brief,
        branch: args.branch,
        config,
        settings,
        topicsArray: topicNames,
      });
      allResults.push(result);
    }
  }

  return {
    siteDomain,
    requested:
      args.count ??
      eligibleTopics.reduce((s, t) => s + computePerRunTarget(t.schedule), 0),
    totalSourced,
    duplicateCount,
    availableNew: allResults.length,
    n8nImagesTriggered: 0, // populated by the batch commit downstream
    results: allResults,
  };
}
```

Note: this function calls `generateOneArticle(...)`. That function does not exist yet — it's a refactor of the existing per-item generation logic inside `runContentGeneration`. The implementer should extract the body of the inner loop in `runContentGeneration` (everything that today takes one `ContentItem` and produces a `ContentGenerationResult`, including frontmatter assembly, image request prep, and the optional video embed at line ~705) into a new helper `generateOneArticle(args)` that both `runContentGeneration` and `runPerTopicGeneration` can call. The helper accepts an optional `topicsArray?: string[]`; when present, it writes `topics: topicsArray` into `ArticleFrontmatter`. When absent (legacy path), it does not write the field.

If the extraction is non-trivial, the implementer may instead inline a small adapter: build the frontmatter as today, then if `topicsArray` is provided, set `frontmatter.topics = topicsArray` before serializing.

- [ ] **Step 5.4: Set `frontmatter.topics` in the per-item generation path**

In the per-item generation block (whether refactored into `generateOneArticle` or inlined as in Step 5.3's note), after the frontmatter object is assembled and before the markdown is serialized, add:

```ts
if (topicsArray && topicsArray.length > 0) {
  (frontmatter as ArticleFrontmatterWithExtras & { topics?: string[] }).topics =
    topicsArray;
}
```

- [ ] **Step 5.5: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm typecheck
```

Expected: no errors. If errors appear about missing imports for `SiteBrief`, `AgentConfig`, `ContentItem`, `getContent`, `getSettings`, `normalizeUrl`, `normalizeTitleKey`, etc., add them to the file's existing import list (these are already imported in agent.ts for the legacy path).

- [ ] **Step 5.6: Run all content-pipeline tests** (regression check)

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm test 2>&1 | tail -5
```

Expected: existing tests still pass (the same set that passed before Task 5 — there are some pre-existing failures in `scheduled-publisher.test.ts` and `agent.test.ts` that are not caused by this task; baseline them against the previous run).

- [ ] **Step 5.7: Commit (GATED).**

---

## Task 6: Legacy-path regression guard

A test that proves a site WITHOUT `topics_v2` still goes through the legacy flat-bundle fan-out path. This is the live-sites-must-not-be-touched invariant in code form.

**Files:**

- Create: `services/content-pipeline/src/__tests__/legacy-path-regression.test.ts`

- [ ] **Step 6.1: Write the regression test**

Create the file:

```ts
import { describe, it, expect, vi } from "vitest";
import { isPerTopicSite } from "../agents/content-generation/per-topic-fetch.js";
import type { SiteBrief } from "../types.js";

describe("legacy-path regression — a site without topics_v2 must use the legacy path", () => {
  function legacyBrief(overrides: Partial<SiteBrief> = {}): SiteBrief {
    return {
      audience: "General",
      tone: "informative",
      article_types: { standard: 100 },
      topics: ["Foo"],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: ["Monday"] },
      bundle_ids: ["b1", "b2"],
      vertical: "Travel",
      vertical_id: "v1",
      ...overrides,
    } as SiteBrief;
  }

  it("isPerTopicSite is false for a brief with bundle_ids but no topics_v2", () => {
    expect(isPerTopicSite(legacyBrief())).toBe(false);
  });

  it("isPerTopicSite is false for a brief with neither bundle_ids nor topics_v2", () => {
    expect(isPerTopicSite(legacyBrief({ bundle_ids: undefined }))).toBe(false);
  });

  it("isPerTopicSite is false for a brief with bundle_ids AND empty topics_v2 array", () => {
    expect(isPerTopicSite(legacyBrief({ topics_v2: [] }))).toBe(false);
  });

  it("isPerTopicSite is true ONLY when topics_v2 has at least one element", () => {
    const brief = legacyBrief({
      bundle_ids: undefined,
      topics_v2: [
        {
          name: "X",
          source: { type: "filter", category_ids: ["c1"], tag_ids: [] },
          schedule: { articles_per_week: 1, preferred_days: ["Monday"] },
        },
      ],
    });
    expect(isPerTopicSite(brief)).toBe(true);
  });
});
```

- [ ] **Step 6.2: Run the regression test**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/content-pipeline && pnpm test -- legacy-path-regression
```

Expected: 4/4 pass.

- [ ] **Step 6.3: Commit (GATED).**

---

## Task 7: Site-worker — read `frontmatter.topics` array if present

Update the topic page (and the sidebar category lists on `/[slug]/index.astro`) to prefer the new `frontmatter.topics` array. If absent (legacy site), fall back to today's tag-based slug matching.

**Files:**

- Modify: `packages/site-worker/src/pages/category/[topic].astro` (around line 39)
- Modify: `packages/site-worker/src/pages/[slug]/index.astro` (around line 93)

- [ ] **Step 7.1: Find the topic-page article filter**

```bash
grep -n "filter((a) => a.tags.some" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker/src/pages/category/\[topic\].astro
```

You'll see a line like:

```ts
.filter((a) => a.tags.some((t) => t.toLowerCase().replace(/\s+/g, '-') === topicSlug.toLowerCase()))
```

- [ ] **Step 7.2: Replace with a dual-check helper**

Just above the `.filter(...)` line, add a helper:

```ts
function articleBelongsToTopic(
  a: ArticleIndexEntry,
  slug: string,
  displayName: string,
): boolean {
  // New model: article frontmatter carries an explicit `topics` array.
  if (Array.isArray(a.topics) && a.topics.length > 0) {
    return a.topics.some(
      (n) =>
        n.toLowerCase().replace(/\s+/g, "-") === slug.toLowerCase() ||
        n.toLowerCase() === displayName.toLowerCase(),
    );
  }
  // Legacy model: tag-slug match.
  return a.tags.some(
    (t) => t.toLowerCase().replace(/\s+/g, "-") === slug.toLowerCase(),
  );
}
```

(The `ArticleIndexEntry` type should already be imported. If `topics` doesn't exist on the type, add `topics?: string[]` to it in the appropriate types file — search for `interface ArticleIndexEntry`.)

Then replace the `.filter(...)` line with:

```ts
.filter((a) => articleBelongsToTopic(a, topicSlug, displayName))
```

- [ ] **Step 7.3: Apply the same change to `[slug]/index.astro`**

Find the corresponding filter line (the article list assembled per topic for the sidebar). Replace with the same `articleBelongsToTopic` helper (define it locally or extract to a shared lib file under `packages/site-worker/src/lib/`).

- [ ] **Step 7.4: Add `topics` to `ArticleIndexEntry`**

```bash
grep -rn "interface ArticleIndexEntry" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker/src/ | head -3
```

In the file where `ArticleIndexEntry` is defined, add:

```ts
  /** Per-topic-filter model: explicit topic membership.
   *  Absent on legacy-site articles; renderer falls back to tag matching. */
  topics?: string[];
```

- [ ] **Step 7.5: Update seed-kv to populate `topics` from article frontmatter**

```bash
grep -n "ArticleIndexEntry\|frontmatter.topics\|frontmatter.tags" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker/scripts/seed-kv.ts
```

In `seed-kv.ts`, locate where `ArticleIndexEntry` is constructed from each article's frontmatter. Add:

```ts
  topics: Array.isArray(frontmatter.topics) ? frontmatter.topics : undefined,
```

alongside the existing `tags` extraction.

- [ ] **Step 7.6: Typecheck site-worker**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker && pnpm typecheck
```

Expected: no NEW errors beyond the pre-existing 1 error in `src/lib/config.ts:45` (already known on clean HEAD).

- [ ] **Step 7.7: Run site-worker tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker && pnpm test 2>&1 | tail -5
```

Expected: all existing tests still pass.

- [ ] **Step 7.8: Commit (GATED).**

---

## Task 8: Dashboard save route — accept `theme` + `topics_v2`; strip legacy on per-topic save

When the dashboard sends a save with `topics_v2` populated, the route writes the new shape to `site.yaml` and removes the legacy `bundle_ids` / `category_ids` / `tag_ids` fields. When `theme` is provided (alone or with `topics_v2`), it's persisted on the brief.

**Files:**

- Modify: `services/dashboard/src/app/api/sites/save/route.ts`
- Modify: `services/dashboard/src/actions/wizard.ts` (extend `StagingSiteConfig`)

- [ ] **Step 8.1: Extend `StagingSiteConfig`**

Edit `services/dashboard/src/actions/wizard.ts`. Find the `StagingSiteConfig` interface (around line 1053-1096). Add **inside** the interface:

```ts
  /** Free-text site theme (per-topic model — drives AI proposals). */
  theme?: string;
  /** Per-topic filters list. When provided on save, the site config is
   *  rewritten to the new per-topic shape and legacy bundle_ids/category_ids/
   *  tag_ids are stripped. */
  topics_v2?: import("@atomic-platform/shared-types").TopicV2[];
```

- [ ] **Step 8.2: Update the save route**

Edit `services/dashboard/src/app/api/sites/save/route.ts`. Find the existing `if (configUpdates.bundleIds !== undefined) { ... }` block in the niche-targeting section (around line 220). Add a new block immediately AFTER it:

```ts
// Per-topic-filter model. When topics_v2 is provided (non-empty array),
// this site is on the new model — write `brief.theme` and `brief.topics_v2`
// and strip every legacy niche-targeting field (bundle_ids, category_ids,
// tag_ids, plus the singular legacy bundle_id at top level and brief level).
if (configUpdates.topics_v2 !== undefined) {
  if (configUpdates.topics_v2.length > 0) {
    brief.topics_v2 = configUpdates.topics_v2;
  } else {
    delete (brief as Record<string, unknown>).topics_v2;
  }
  // Legacy fields are out on per-topic sites.
  delete (brief as Record<string, unknown>).bundle_ids;
  delete (brief as Record<string, unknown>).bundle_id;
  delete (brief as Record<string, unknown>).category_ids;
  delete (brief as Record<string, unknown>).tag_ids;
  delete (existing as Record<string, unknown>).bundle_id;
}

if (configUpdates.theme !== undefined) {
  if (configUpdates.theme.trim().length > 0) {
    brief.theme = configUpdates.theme;
  } else {
    delete (brief as Record<string, unknown>).theme;
  }
}
```

- [ ] **Step 8.3: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors. If the `TopicV2` import path is wrong, adjust based on the actual package re-exports — `import type { TopicV2 } from "@atomic-platform/shared-types"` should work, or fall back to `import type { TopicV2 } from "@atomic-platform/shared-types/dist/config"`.

- [ ] **Step 8.4: Run dashboard tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm test 2>&1 | tail -5
```

Expected: all existing 169 dashboard tests still pass.

- [ ] **Step 8.5: Commit (GATED).**

---

## Task 9: Migration server action

A server action `migrateSiteToPerTopic(domain, theme, topics_v2, deleteOrphanBundleIds[])` that:

1. Reads the current site.yaml from the staging branch
2. Writes the new shape (theme + topics_v2; strips bundle_ids/category_ids/tag_ids)
3. Optionally deletes the listed orphan bundles via the aggregator API

**Files:**

- Create: `services/dashboard/src/actions/per-topic-migration.ts`
- Create: `services/dashboard/src/actions/__tests__/per-topic-migration.test.ts`

- [ ] **Step 9.1: Write the server action**

Create `services/dashboard/src/actions/per-topic-migration.ts`:

```ts
"use server";

import { stringify as stringifyYaml } from "yaml";
import type { TopicV2 } from "@atomic-platform/shared-types";
import {
  commitSiteFiles,
  readDashboardIndex,
  readSiteConfig as readSiteConfigFromGit,
} from "@/lib/github";

const RAW_AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";
const AGGREGATOR_URL = RAW_AGGREGATOR_URL.replace(/\/api\/?$/, "");

export interface MigrateSiteToPerTopicArgs {
  domain: string;
  theme: string;
  topics_v2: TopicV2[];
  deleteOrphanBundleIds: string[];
}

export interface MigrateSiteToPerTopicResult {
  status: "ok" | "error";
  message?: string;
  bundlesDeleted: number;
  bundlesFailedToDelete: string[];
}

export async function migrateSiteToPerTopic(
  args: MigrateSiteToPerTopicArgs,
): Promise<MigrateSiteToPerTopicResult> {
  if (!args.theme.trim()) {
    return {
      status: "error",
      message: "Theme is required",
      bundlesDeleted: 0,
      bundlesFailedToDelete: [],
    };
  }
  if (args.topics_v2.length === 0) {
    return {
      status: "error",
      message: "At least one topic is required",
      bundlesDeleted: 0,
      bundlesFailedToDelete: [],
    };
  }

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === args.domain);
  if (!site?.staging_branch) {
    return {
      status: "error",
      message: "No staging branch for this site",
      bundlesDeleted: 0,
      bundlesFailedToDelete: [],
    };
  }

  const existing = await readSiteConfigFromGit(
    args.domain,
    site.staging_branch,
  );
  if (!existing) {
    return {
      status: "error",
      message: "Could not read site config",
      bundlesDeleted: 0,
      bundlesFailedToDelete: [],
    };
  }

  // Rewrite the brief to the new shape.
  const brief = (existing.brief ?? {}) as Record<string, unknown>;
  brief.theme = args.theme;
  brief.topics_v2 = args.topics_v2;
  delete brief.bundle_ids;
  delete brief.bundle_id;
  delete brief.category_ids;
  delete brief.tag_ids;
  (existing as Record<string, unknown>).brief = brief;
  delete (existing as Record<string, unknown>).bundle_id;

  // Commit the site.yaml change.
  const yamlContent = stringifyYaml(existing);
  await commitSiteFiles(
    args.domain,
    [{ path: `sites/${args.domain}/site.yaml`, content: yamlContent }],
    `feat: migrate ${args.domain} to per-topic filters`,
    site.staging_branch,
  );

  // Best-effort delete orphan bundles on the aggregator.
  let bundlesDeleted = 0;
  const bundlesFailedToDelete: string[] = [];
  for (const bundleId of args.deleteOrphanBundleIds) {
    try {
      const res = await fetch(`${AGGREGATOR_URL}/api/bundles/${bundleId}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 404) {
        bundlesDeleted++;
      } else {
        bundlesFailedToDelete.push(bundleId);
        console.warn(
          `[migrate] DELETE /api/bundles/${bundleId} -> ${res.status}`,
        );
      }
    } catch (err) {
      bundlesFailedToDelete.push(bundleId);
      console.warn(`[migrate] DELETE /api/bundles/${bundleId} threw:`, err);
    }
  }

  return { status: "ok", bundlesDeleted, bundlesFailedToDelete };
}
```

- [ ] **Step 9.2: Write tests**

Create `services/dashboard/src/actions/__tests__/per-topic-migration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  readDashboardIndex: vi.fn(),
  readSiteConfig: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { migrateSiteToPerTopic } from "../per-topic-migration";
import {
  commitSiteFiles,
  readDashboardIndex,
  readSiteConfig,
} from "@/lib/github";

const SITE_INDEX = {
  sites: [
    {
      domain: "travelnights",
      staging_branch: "staging/travelnights",
      status: "Live",
    },
  ],
};

const LEGACY_CONFIG = {
  domain: "travelnights",
  site_name: "Travel Nights",
  brief: {
    audience: "Travelers",
    tone: "informative",
    bundle_ids: ["b1", "b2"],
    category_ids: ["cat-1"],
    tag_ids: ["tag-1"],
    topics: ["Destinations", "Wine & Beer"],
  },
};

const TOPICS_V2 = [
  {
    name: "Destinations",
    source: {
      type: "filter" as const,
      category_ids: ["cat-travel"],
      tag_ids: ["tag-dest"],
    },
    schedule: {
      articles_per_week: 3,
      preferred_days: ["Monday", "Wednesday", "Friday"],
    },
  },
  {
    name: "Wine & Beer",
    source: {
      type: "filter" as const,
      category_ids: ["cat-alc"],
      tag_ids: ["tag-wine"],
    },
    schedule: { articles_per_week: 1, preferred_days: ["Tuesday"] },
  },
];

describe("migrateSiteToPerTopic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDashboardIndex).mockResolvedValue(
      SITE_INDEX as unknown as Awaited<ReturnType<typeof readDashboardIndex>>,
    );
    vi.mocked(readSiteConfig).mockResolvedValue(
      JSON.parse(JSON.stringify(LEGACY_CONFIG)),
    );
  });

  it("writes topics_v2 + theme and strips legacy fields", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and eating while traveling",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("ok");

    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0]!;
    const files = commitCall[1] as Array<{ path: string; content: string }>;
    expect(files[0]!.path).toBe("sites/travelnights/site.yaml");

    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(files[0]!.content) as {
      brief: Record<string, unknown>;
    };
    expect(parsed.brief.theme).toBe("Travel and eating while traveling");
    expect(parsed.brief.topics_v2).toEqual(TOPICS_V2);
    expect(parsed.brief.bundle_ids).toBeUndefined();
    expect(parsed.brief.category_ids).toBeUndefined();
    expect(parsed.brief.tag_ids).toBeUndefined();
  });

  it("deletes orphan bundles on the aggregator (best-effort)", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and food",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: ["b1", "b2"],
    });

    expect(result.status).toBe("ok");
    expect(result.bundlesDeleted).toBe(2);
    expect(result.bundlesFailedToDelete).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("counts 404 as a successful delete (bundle already gone)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 } as Response);

    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and food",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: ["b-gone"],
    });

    expect(result.status).toBe("ok");
    expect(result.bundlesDeleted).toBe(1);
  });

  it("tracks bundles that failed to delete", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and food",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: ["b1", "b-fail"],
    });

    expect(result.status).toBe("ok");
    expect(result.bundlesDeleted).toBe(1);
    expect(result.bundlesFailedToDelete).toEqual(["b-fail"]);
  });

  it("rejects when theme is empty", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "   ",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/Theme is required/);
  });

  it("rejects when topics_v2 is empty", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel",
      topics_v2: [],
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/at least one topic/i);
  });
});
```

- [ ] **Step 9.3: Run the new tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm test -- per-topic-migration
```

Expected: 6/6 pass.

- [ ] **Step 9.4: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 9.5: Commit (GATED).**

---

## Task 10: `PerTopicReviewScreen` shared component

A reusable React component that drives both the migration screen and the wizard's Topic Filters step. Given a site theme + a list of topic names, it kicks off N parallel `/api/ai/propose-filter` calls and renders a per-topic review card with editable filter rules + schedule. The parent owns the save action.

Length warning: this component is ~250 lines. The full code is in this task because the implementer needs it verbatim.

**Files:**

- Create: `services/dashboard/src/components/topic-review/PerTopicReviewScreen.tsx`

- [ ] **Step 10.1: Write the component**

Create `services/dashboard/src/components/topic-review/PerTopicReviewScreen.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  TopicV2,
  TopicV2Schedule,
  TopicV2Source,
} from "@atomic-platform/shared-types";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAllCategories, useTags } from "@/hooks/useReferenceData";

const DEFAULT_PREFERRED_DAYS = ["Monday", "Wednesday", "Friday"];
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export interface PerTopicReviewItem {
  /** The user-facing topic name. */
  name: string;
  /** Optional description that's passed to the AI proposer. */
  description?: string;
  /** Filter state (loaded from AI proposal or starts empty). */
  source: TopicV2Source;
  /** Schedule state. */
  schedule: TopicV2Schedule;
  /** AI rationale text, if a proposal has been run. */
  rationale?: string;
  /** AI proposal loading state. */
  loading: boolean;
  /** AI proposal error message, if any. */
  error?: string;
}

export interface PerTopicReviewScreenProps {
  siteTheme: string;
  /** Initial topic names. The component creates one PerTopicReviewItem per name,
   *  empty filter + default schedule, and kicks off AI proposals on mount. */
  initialTopicNames: string[];
  /** Default schedule applied to each topic before AI proposes. */
  defaultSchedule: TopicV2Schedule;
  onSave: (topics: TopicV2[]) => Promise<void> | void;
  saveLabel?: string;
  onCancel?: () => void;
  /** Heading shown at the top of the screen. */
  title?: string;
  /** Optional banner text under the title (e.g. migration warning). */
  banner?: React.ReactNode;
}

export function PerTopicReviewScreen({
  siteTheme,
  initialTopicNames,
  defaultSchedule,
  onSave,
  saveLabel = "Save",
  onCancel,
  title = "Topic Filters",
  banner,
}: PerTopicReviewScreenProps): React.ReactElement {
  const { categories: allCategories } = useAllCategories();
  const { tags: allTags } = useTags();

  const [items, setItems] = useState<PerTopicReviewItem[]>(() =>
    initialTopicNames.map((name) => ({
      name,
      source: { type: "filter", category_ids: [], tag_ids: [] },
      schedule: { ...defaultSchedule },
      loading: true,
    })),
  );
  const [saving, setSaving] = useState(false);

  const proposeForIndex = useCallback(
    async (idx: number) => {
      const topicName = items[idx]?.name;
      const topicDescription = items[idx]?.description;
      if (!topicName) return;
      setItems((prev) =>
        prev.map((p, i) =>
          i === idx ? { ...p, loading: true, error: undefined } : p,
        ),
      );
      try {
        const res = await fetch("/api/ai/propose-filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteTheme,
            topicName,
            topicDescription,
            categories: allCategories.map((c) => ({
              id: c.id,
              name: c.name,
              parent_id: c.parent_id,
            })),
            tags: allTags.map((t) => ({
              id: t.id,
              name: t.name,
              usage_count: t.usage_count,
            })),
          }),
        });
        if (!res.ok) throw new Error(`Propose-filter returned ${res.status}`);
        const data = (await res.json()) as {
          category_ids?: string[];
          tag_ids?: string[];
          rationale?: string;
        };
        setItems((prev) =>
          prev.map((p, i) =>
            i === idx
              ? {
                  ...p,
                  source: {
                    type: "filter",
                    category_ids: data.category_ids ?? [],
                    tag_ids: data.tag_ids ?? [],
                  },
                  rationale: data.rationale,
                  loading: false,
                  error: undefined,
                }
              : p,
          ),
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((p, i) =>
            i === idx
              ? {
                  ...p,
                  loading: false,
                  error: err instanceof Error ? err.message : "Proposal failed",
                }
              : p,
          ),
        );
      }
    },
    [items, siteTheme, allCategories, allTags],
  );

  // Initial AI proposals — kick off once when categories + tags have loaded.
  const [didInitialPropose, setDidInitialPropose] = useState(false);
  useEffect(() => {
    if (didInitialPropose) return;
    if (allCategories.length === 0 || allTags.length === 0) return;
    if (!siteTheme.trim()) return;
    setDidInitialPropose(true);
    for (let i = 0; i < items.length; i++) {
      void proposeForIndex(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allCategories.length,
    allTags.length,
    siteTheme,
    didInitialPropose,
    items.length,
  ]);

  function updateItem(idx: number, patch: Partial<PerTopicReviewItem>): void {
    setItems((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  }

  function toggleDay(idx: number, day: string): void {
    const item = items[idx];
    if (!item) return;
    const next = item.schedule.preferred_days.includes(day)
      ? item.schedule.preferred_days.filter((d) => d !== day)
      : [...item.schedule.preferred_days, day];
    updateItem(idx, { schedule: { ...item.schedule, preferred_days: next } });
  }

  function removeFilterId(
    idx: number,
    kind: "category_ids" | "tag_ids",
    id: string,
  ): void {
    const item = items[idx];
    if (!item || item.source.type !== "filter") return;
    const next = item.source[kind].filter((x) => x !== id);
    updateItem(idx, { source: { ...item.source, [kind]: next } });
  }

  function nameForCategory(id: string): string {
    return allCategories.find((c) => c.id === id)?.name ?? id;
  }
  function nameForTag(id: string): string {
    return allTags.find((t) => t.id === id)?.name ?? id;
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const topics: TopicV2[] = items.map((it) => ({
        name: it.name,
        description: it.description,
        source: it.source,
        schedule: it.schedule,
      }));
      await onSave(topics);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-6">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        {banner && <div className="mt-3">{banner}</div>}
        <p className="text-sm text-[var(--text-muted)] mt-2">
          AI proposed a filter for each topic based on this site's theme. Review
          and edit before saving.
        </p>
      </header>

      <div className="space-y-3">
        {items.map((item, idx) => (
          <div
            key={`${idx}-${item.name}`}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3"
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">{item.name}</h3>
              {item.loading && (
                <span className="text-xs text-[var(--text-muted)]">
                  Proposing filter…
                </span>
              )}
            </div>

            {item.error && (
              <p className="text-xs text-red-400">
                AI proposal failed: {item.error}.{" "}
                <button
                  type="button"
                  onClick={(): void => void proposeForIndex(idx)}
                  className="underline"
                >
                  Retry
                </button>
              </p>
            )}

            {item.source.type === "filter" && (
              <>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Categories ({item.source.category_ids.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.source.category_ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 text-violet-400 px-2 py-0.5 text-xs font-semibold"
                      >
                        {nameForCategory(id)}
                        <button
                          type="button"
                          onClick={(): void =>
                            removeFilterId(idx, "category_ids", id)
                          }
                          className="hover:text-red-400"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Tags ({item.source.tag_ids.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.source.tag_ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                      >
                        {nameForTag(id)}
                        <button
                          type="button"
                          onClick={(): void =>
                            removeFilterId(idx, "tag_ids", id)
                          }
                          className="hover:text-red-400"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {item.rationale && (
                  <div className="rounded border-l-2 border-cyan/50 pl-3 py-1 text-xs text-[var(--text-muted)] italic">
                    ✨ {item.rationale}
                  </div>
                )}

                <Button
                  variant="ghost"
                  onClick={(): void => void proposeForIndex(idx)}
                >
                  ✨ Re-propose with AI
                </Button>
              </>
            )}

            <div className="flex items-end gap-4 pt-2 border-t border-[var(--border-primary)]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                  Articles / week
                </div>
                <Input
                  type="number"
                  min="0"
                  value={String(item.schedule.articles_per_week)}
                  onChange={(e): void =>
                    updateItem(idx, {
                      schedule: {
                        ...item.schedule,
                        articles_per_week: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      },
                    })
                  }
                  style={{ width: "70px", textAlign: "center" }}
                />
              </div>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                  Preferred days
                </div>
                <div className="flex gap-1">
                  {DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={(): void => toggleDay(idx, day)}
                      className={`px-2 py-1 rounded text-[11px] font-medium border ${
                        item.schedule.preferred_days.includes(day)
                          ? "bg-cyan/20 border-cyan text-cyan"
                          : "bg-[var(--bg-surface)] border-[var(--border-primary)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border-primary)]">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={(): void => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}

// Unused-warning suppression for the default constant.
void DEFAULT_PREFERRED_DAYS;
```

- [ ] **Step 10.2: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 10.3: Commit (GATED).**

---

## Task 11: Migration page

A full-page Next.js route at `/sites/[domain]/migrate-per-topic`. Hosts `PerTopicReviewScreen` in migration mode. On save, calls `migrateSiteToPerTopic` and redirects back to the site detail.

**Files:**

- Create: `services/dashboard/src/app/sites/[domain]/migrate-per-topic/page.tsx`

- [ ] **Step 11.1: Write the page**

Create the file:

```tsx
"use client";

import { useRouter, useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { PerTopicReviewScreen } from "@/components/topic-review/PerTopicReviewScreen";
import { migrateSiteToPerTopic } from "@/actions/per-topic-migration";
import { useToast } from "@/components/ui/Toast";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { TopicV2 } from "@atomic-platform/shared-types";

interface SiteSummary {
  topics: string[];
  bundle_ids: string[];
  /** Subset of bundle_ids that are only used by this site (safe to delete). */
  orphan_bundle_ids: string[];
}

export default function MigratePerTopicPage(): React.ReactElement {
  const router = useRouter();
  const params = useParams<{ domain: string }>();
  const { toast } = useToast();
  const domain = params.domain;

  const [theme, setTheme] = useState("");
  const [step, setStep] = useState<"theme" | "review">("theme");
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [deleteOrphans, setDeleteOrphans] = useState(true);

  // Load the site's topics + bundles for the migration flow.
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/sites/migration-summary?domain=${domain}`);
      if (res.ok) setSummary((await res.json()) as SiteSummary);
    })();
  }, [domain]);

  async function handleSave(topics: TopicV2[]): Promise<void> {
    const result = await migrateSiteToPerTopic({
      domain,
      theme,
      topics_v2: topics,
      deleteOrphanBundleIds: deleteOrphans
        ? (summary?.orphan_bundle_ids ?? [])
        : [],
    });
    if (result.status === "ok") {
      toast(
        "Migration complete — next scheduled run will use per-topic filters",
        "success",
      );
      router.push(`/sites/${domain}`);
    } else {
      toast(result.message ?? "Migration failed", "error");
    }
  }

  if (step === "theme") {
    return (
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Migrate to per-topic filters</h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Step 1 of 2 — describe the site's editorial theme in 1–2 lines. The
            AI uses this to propose a filter for each topic.
          </p>
        </header>
        <textarea
          placeholder="Travel and eating while traveling — destinations, food tourism, wine routes."
          value={theme}
          onChange={(e): void => setTheme(e.target.value)}
          className="w-full min-h-[80px] rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={(): void => router.push(`/sites/${domain}`)}
          >
            Cancel
          </Button>
          <Button
            onClick={(): void => setStep("review")}
            disabled={!theme.trim() || !summary}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  if (!summary) return <div className="p-6">Loading…</div>;

  return (
    <PerTopicReviewScreen
      siteTheme={theme}
      initialTopicNames={summary.topics}
      defaultSchedule={{
        articles_per_week: Math.max(
          1,
          Math.ceil(7 / Math.max(1, summary.topics.length)),
        ),
        preferred_days: ["Monday", "Wednesday", "Friday"],
      }}
      onSave={handleSave}
      saveLabel="Confirm migration"
      onCancel={(): void => router.push(`/sites/${domain}`)}
      title={`Migrate ${domain} to per-topic filters`}
      banner={
        summary.orphan_bundle_ids.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteOrphans}
                onChange={(e): void => setDeleteOrphans(e.target.checked)}
              />
              <span>
                Also delete this site's{" "}
                <strong>{summary.orphan_bundle_ids.length}</strong> orphan
                bundles on the aggregator
              </span>
            </label>
          </div>
        )
      }
    />
  );
}
```

- [ ] **Step 11.2: Add the migration-summary API route**

Create `services/dashboard/src/app/api/sites/migration-summary/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex, readSiteConfig } from "@/lib/github";

const RAW_AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";
const AGGREGATOR_URL = RAW_AGGREGATOR_URL.replace(/\/api\/?$/, "");

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain)
    return NextResponse.json({ error: "domain required" }, { status: 400 });

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch)
    return NextResponse.json({ error: "no staging branch" }, { status: 404 });

  const config = await readSiteConfig(domain, site.staging_branch);
  const brief = (config?.brief ?? {}) as Record<string, unknown>;
  const topics = Array.isArray(brief.topics) ? (brief.topics as string[]) : [];
  const bundle_ids = Array.isArray(brief.bundle_ids)
    ? (brief.bundle_ids as string[])
    : [];

  // Determine which bundles are only used by this site by reading every other
  // site's brief.bundle_ids.
  const otherSitesBundleIds = new Set<string>();
  for (const otherSite of index.sites) {
    if (otherSite.domain === domain) continue;
    if (!otherSite.staging_branch) continue;
    try {
      const otherConfig = await readSiteConfig(
        otherSite.domain,
        otherSite.staging_branch,
      );
      const otherBundleIds = (
        otherConfig?.brief as Record<string, unknown> | undefined
      )?.bundle_ids;
      if (Array.isArray(otherBundleIds)) {
        for (const id of otherBundleIds) {
          if (typeof id === "string") otherSitesBundleIds.add(id);
        }
      }
    } catch {
      // best-effort
    }
  }

  const orphan_bundle_ids = bundle_ids.filter(
    (id) => !otherSitesBundleIds.has(id),
  );

  // Suppress unused-variable warning for AGGREGATOR_URL — reserved for future use
  // (e.g. hitting aggregator to confirm bundle existence).
  void AGGREGATOR_URL;

  return NextResponse.json({ topics, bundle_ids, orphan_bundle_ids });
}
```

- [ ] **Step 11.3: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 11.4: Commit (GATED).**

---

## Task 12: Identity tab migration toggle

A small toggle on the site detail's Identity panel (only on legacy sites — sites without `brief.topics_v2`). Clicking it navigates to `/sites/{domain}/migrate-per-topic`.

**Files:**

- Create: `services/dashboard/src/components/site-detail/MigrateToPerTopicToggle.tsx`
- Modify: the existing Identity tab/panel to render this toggle

- [ ] **Step 12.1: Write the toggle component**

Create the file:

```tsx
"use client";

import Link from "next/link";

interface Props {
  domain: string;
  /** Whether the site has already been migrated. When true, renders a status
   *  indicator instead of the toggle. */
  isPerTopic: boolean;
}

export function MigrateToPerTopicToggle({
  domain,
  isPerTopic,
}: Props): React.ReactElement {
  if (isPerTopic) {
    return (
      <div className="rounded-lg border border-cyan/30 bg-cyan/5 px-4 py-3 flex items-center gap-2">
        <span className="text-cyan">✓</span>
        <span className="text-sm font-semibold text-cyan">
          Per-topic filters active
        </span>
        <span className="text-xs text-[var(--text-muted)] ml-auto">
          Reverting requires a git revert of the migration commit.
        </span>
      </div>
    );
  }
  return (
    <Link
      href={`/sites/${domain}/migrate-per-topic`}
      className="block rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 hover:border-cyan/50 transition-colors"
    >
      <div className="text-sm font-semibold">
        Migrate to per-topic filters →
      </div>
      <div className="text-xs text-[var(--text-muted)] mt-1">
        Replace the site-level bundle subscriptions with per-topic filters. Each
        topic gets its own filter and schedule. One-way; reverting requires a
        git revert.
      </div>
    </Link>
  );
}
```

- [ ] **Step 12.2: Render the toggle in the Identity panel**

```bash
grep -rn "Identity\|brief.topics\|domain={domain}" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/components/site-detail/ContentAgentTab.tsx | head -10
```

Locate the Identity sub-tab's render block in `ContentAgentTab.tsx` (search for the Identity section, often labeled `identityContent` or wrapped in a `<TabsContent value="identity">`). Near the bottom of that section, add:

```tsx
<MigrateToPerTopicToggle
  domain={domain}
  isPerTopic={
    Array.isArray(
      (siteConfig?.brief as Record<string, unknown> | undefined)?.topics_v2,
    ) &&
    (
      (siteConfig?.brief as Record<string, unknown> | undefined)
        ?.topics_v2 as unknown[]
    )?.length > 0
  }
/>
```

Add the import:

```ts
import { MigrateToPerTopicToggle } from "./MigrateToPerTopicToggle";
```

- [ ] **Step 12.3: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 12.4: Commit (GATED).**

---

## Task 13: TopicEditModal

The modal that opens for + Add Topic and Edit Topic actions on the topics list (TopicsListPanel, next task). Contains topic name + optional description + filter source (default AI-proposed; small "Use shared bundle instead →" link toggles to bundle mode) + schedule.

**Files:**

- Create: `services/dashboard/src/components/site-detail/TopicEditModal.tsx`

- [ ] **Step 13.1: Write the modal**

Create the file. (~200 lines; see [PerTopicReviewScreen](services/dashboard/src/components/topic-review/PerTopicReviewScreen.tsx) for patterns to reuse — the modal is conceptually one card of that screen, plus a "use bundle instead" toggle.)

```tsx
"use client";

import { useState } from "react";
import type {
  TopicV2,
  TopicV2Source,
  TopicV2Schedule,
} from "@atomic-platform/shared-types";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  useAllCategories,
  useTags,
  useTagSearch,
  useBundles,
} from "@/hooks/useReferenceData";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface Props {
  /** When provided, edit mode. When undefined, add-new mode. */
  initial?: TopicV2;
  /** Site theme — passed to AI for proposals. */
  siteTheme: string;
  /** List of existing topic names on the site, for uniqueness validation. */
  existingNames: string[];
  onClose: () => void;
  onSave: (topic: TopicV2) => void;
}

export function TopicEditModal({
  initial,
  siteTheme,
  existingNames,
  onClose,
  onSave,
}: Props): React.ReactElement {
  const { categories: allCategories } = useAllCategories();
  const { tags: allTags } = useTags();
  const { bundles } = useBundles();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [source, setSource] = useState<TopicV2Source>(
    initial?.source ?? { type: "filter", category_ids: [], tag_ids: [] },
  );
  const [schedule, setSchedule] = useState<TopicV2Schedule>(
    initial?.schedule ?? { articles_per_week: 1, preferred_days: ["Monday"] },
  );
  const [aiRationale, setAiRationale] = useState<string | undefined>();
  const [aiLoading, setAiLoading] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const { results: tagSearchResults } = useTagSearch(tagSearch);

  function nameForCategory(id: string): string {
    return allCategories.find((c) => c.id === id)?.name ?? id;
  }
  function nameForTag(id: string): string {
    return allTags.find((t) => t.id === id)?.name ?? id;
  }

  async function proposeWithAI(): Promise<void> {
    if (!name.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/propose-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteTheme,
          topicName: name,
          topicDescription: description,
          categories: allCategories.map((c) => ({
            id: c.id,
            name: c.name,
            parent_id: c.parent_id,
          })),
          tags: allTags.map((t) => ({
            id: t.id,
            name: t.name,
            usage_count: t.usage_count,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Propose returned ${res.status}`);
      const data = (await res.json()) as {
        category_ids?: string[];
        tag_ids?: string[];
        rationale?: string;
      };
      setSource({
        type: "filter",
        category_ids: data.category_ids ?? [],
        tag_ids: data.tag_ids ?? [],
      });
      setAiRationale(data.rationale);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  }

  function handleSave(): void {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const lowerName = trimmedName.toLowerCase();
    const conflict = existingNames.some(
      (n) => n.toLowerCase() === lowerName && n !== initial?.name,
    );
    if (conflict) {
      alert(`A topic named "${trimmedName}" already exists on this site.`);
      return;
    }
    if (
      source.type === "filter" &&
      source.category_ids.length === 0 &&
      source.tag_ids.length === 0
    ) {
      // Allowed but warned — empty filter = empty topic. UX-only check.
    }
    onSave({
      name: trimmedName,
      description: description.trim() || undefined,
      source,
      schedule,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e): void => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5 space-y-4"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {initial ? "Edit topic" : "Add topic"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl"
          >
            ×
          </button>
        </header>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Topic name *
          </div>
          <Input
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder="e.g. Wine & Beer"
          />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Brief description (optional — helps AI)
          </div>
          <Input
            value={description}
            onChange={(e): void => setDescription(e.target.value)}
            placeholder="Wine and brewery culture for travelers"
          />
        </div>

        {/* Filter section */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3 space-y-3">
          {source.type === "filter" ? (
            <>
              {source.category_ids.length === 0 &&
                source.tag_ids.length === 0 && (
                  <Button
                    onClick={(): void => void proposeWithAI()}
                    disabled={!name.trim() || aiLoading || !siteTheme.trim()}
                  >
                    {aiLoading ? "Proposing…" : "✨ Propose filter with AI"}
                  </Button>
                )}
              {(source.category_ids.length > 0 ||
                source.tag_ids.length > 0) && (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                      Categories ({source.category_ids.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {source.category_ids.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 text-violet-400 px-2 py-0.5 text-xs font-semibold"
                        >
                          {nameForCategory(id)}
                          <button
                            type="button"
                            onClick={(): void =>
                              setSource({
                                ...source,
                                category_ids: source.category_ids.filter(
                                  (x) => x !== id,
                                ),
                              })
                            }
                            className="hover:text-red-400"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                      Tags ({source.tag_ids.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {source.tag_ids.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                        >
                          {nameForTag(id)}
                          <button
                            type="button"
                            onClick={(): void =>
                              setSource({
                                ...source,
                                tag_ids: source.tag_ids.filter((x) => x !== id),
                              })
                            }
                            className="hover:text-red-400"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 relative">
                      <Input
                        placeholder="Search and add a tag…"
                        value={tagSearch}
                        onChange={(e): void => setTagSearch(e.target.value)}
                      />
                      {tagSearch.trim() && tagSearchResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
                          {tagSearchResults
                            .filter((t) => !source.tag_ids.includes(t.id))
                            .slice(0, 10)
                            .map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={(): void => {
                                  setSource({
                                    ...source,
                                    tag_ids: [...source.tag_ids, t.id],
                                  });
                                  setTagSearch("");
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)]"
                              >
                                {t.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {aiRationale && (
                    <div className="rounded border-l-2 border-cyan/50 pl-3 py-1 text-xs text-[var(--text-muted)] italic">
                      ✨ {aiRationale}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    onClick={(): void => void proposeWithAI()}
                    disabled={aiLoading}
                  >
                    ✨ Re-propose with AI
                  </Button>
                </>
              )}
              <button
                type="button"
                className="text-xs text-cyan hover:underline"
                onClick={(): void =>
                  setSource({ type: "bundle", bundle_id: "" })
                }
              >
                Use a shared bundle instead →
              </button>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                Linked bundle
              </div>
              <select
                value={source.bundle_id}
                onChange={(e): void =>
                  setSource({ type: "bundle", bundle_id: e.target.value })
                }
                className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
              >
                <option value="">— pick a bundle —</option>
                {bundles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.content_count ?? "?"} articles)
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-xs text-cyan hover:underline"
                onClick={(): void =>
                  setSource({ type: "filter", category_ids: [], tag_ids: [] })
                }
              >
                ← Back to AI-proposed filter
              </button>
            </>
          )}
        </div>

        {/* Schedule */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Schedule
          </div>
          <div className="flex items-end gap-4">
            <div>
              <div className="text-[10px] text-[var(--text-muted)] mb-1">
                Articles/week
              </div>
              <Input
                type="number"
                min="0"
                value={String(schedule.articles_per_week)}
                onChange={(e): void =>
                  setSchedule({
                    ...schedule,
                    articles_per_week: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                style={{ width: "70px", textAlign: "center" }}
              />
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-[var(--text-muted)] mb-1">
                Preferred days
              </div>
              <div className="flex gap-1">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={(): void =>
                      setSchedule({
                        ...schedule,
                        preferred_days: schedule.preferred_days.includes(day)
                          ? schedule.preferred_days.filter((d) => d !== day)
                          : [...schedule.preferred_days, day],
                      })
                    }
                    className={`px-2 py-1 rounded text-[11px] font-medium border ${schedule.preferred_days.includes(day) ? "bg-cyan/20 border-cyan text-cyan" : "bg-[var(--bg-surface)] border-[var(--border-primary)] text-[var(--text-secondary)]"}`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--border-primary)]">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {initial ? "Save changes" : "Add topic"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 13.3: Commit (GATED).**

---

## Task 14: TopicsListPanel + ContentAgentTab conditional render

The topics list in Content Brief. Renders one row per topic with name, filter summary, schedule summary, edit/× buttons, drag handle. Above the list: site theme textarea + primary category (read-only display). Below: + Add Topic button. Opens TopicEditModal for add/edit.

**Files:**

- Create: `services/dashboard/src/components/site-detail/TopicsListPanel.tsx`
- Modify: `services/dashboard/src/components/site-detail/ContentAgentTab.tsx` (conditional render)

- [ ] **Step 14.1: Install `@dnd-kit/sortable`**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: package added.

- [ ] **Step 14.2: Write TopicsListPanel**

Create `services/dashboard/src/components/site-detail/TopicsListPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TopicV2 } from "@atomic-platform/shared-types";
import { Button } from "@/components/ui/Button";
import { TopicEditModal } from "./TopicEditModal";
import { useAllCategories } from "@/hooks/useReferenceData";

interface Props {
  topics: TopicV2[];
  siteTheme: string;
  onChange: (next: TopicV2[]) => void;
}

export function TopicsListPanel({
  topics,
  siteTheme,
  onChange,
}: Props): React.ReactElement {
  const { categories: allCategories } = useAllCategories();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = topics.findIndex((t) => t.name === active.id);
    const newIdx = topics.findIndex((t) => t.name === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(topics, oldIdx, newIdx));
  }

  function summarize(t: TopicV2): {
    cats: number;
    tags: number;
    firstFew: string;
  } {
    if (t.source.type === "bundle")
      return { cats: 0, tags: 0, firstFew: `🔗 ${t.source.bundle_id}` };
    const catNames = t.source.category_ids
      .slice(0, 3)
      .map((id) => allCategories.find((c) => c.id === id)?.name ?? id)
      .join(", ");
    return {
      cats: t.source.category_ids.length,
      tags: t.source.tag_ids.length,
      firstFew: catNames,
    };
  }

  function isEmptyFilter(t: TopicV2): boolean {
    return (
      t.source.type === "filter" &&
      t.source.category_ids.length === 0 &&
      t.source.tag_ids.length === 0
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
          Topics ({topics.length})
        </h3>
        <Button variant="ghost" onClick={(): void => setAddingNew(true)}>
          + Add Topic
        </Button>
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={topics.map((t) => t.name)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {topics.map((t, idx) => (
              <SortableTopicRow
                key={t.name}
                topic={t}
                summary={summarize(t)}
                isEmpty={isEmptyFilter(t)}
                onEdit={(): void => setEditingIdx(idx)}
                onRemove={(): void => {
                  if (confirm(`Remove topic "${t.name}"?`)) {
                    onChange(topics.filter((_, i) => i !== idx));
                  }
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {addingNew && (
        <TopicEditModal
          siteTheme={siteTheme}
          existingNames={topics.map((t) => t.name)}
          onClose={(): void => setAddingNew(false)}
          onSave={(topic): void => {
            onChange([...topics, topic]);
            setAddingNew(false);
          }}
        />
      )}
      {editingIdx !== null && topics[editingIdx] && (
        <TopicEditModal
          initial={topics[editingIdx]}
          siteTheme={siteTheme}
          existingNames={topics.map((t) => t.name)}
          onClose={(): void => setEditingIdx(null)}
          onSave={(topic): void => {
            onChange(topics.map((t, i) => (i === editingIdx ? topic : t)));
            setEditingIdx(null);
          }}
        />
      )}
    </div>
  );
}

function SortableTopicRow({
  topic,
  summary,
  isEmpty,
  onEdit,
  onRemove,
}: {
  topic: TopicV2;
  summary: { cats: number; tags: number; firstFew: string };
  isEmpty: boolean;
  onEdit: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: topic.name });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 rounded-lg border ${isEmpty ? "border-amber-500/40 bg-amber-500/5" : "border-[var(--border-primary)] bg-[var(--bg-elevated)]"} px-3 py-2`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-[var(--text-muted)] cursor-grab pt-1"
        title="Drag to reorder"
      >
        ⠿
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">
          {topic.name}
          {isEmpty && (
            <span className="ml-2 text-[10px] text-amber-400 font-normal">
              ⚠ filter not set
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-1">
          {!isEmpty && (
            <>
              <span className="bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded text-[10px] mr-1">
                {summary.cats} cats
              </span>
              <span className="bg-cyan/10 text-cyan px-1.5 py-0.5 rounded text-[10px]">
                {summary.tags} tags
              </span>
              <span className="ml-2">
                {topic.schedule.articles_per_week}/week ·{" "}
                {topic.schedule.preferred_days
                  .map((d) => d.slice(0, 3))
                  .join(", ")}
              </span>
            </>
          )}
          {isEmpty && (
            <span>Topic has no filter — no articles will be fetched.</span>
          )}
        </div>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] hover:border-cyan"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-[var(--text-muted)] hover:text-red-400 px-1"
        >
          ×
        </button>
      </div>
    </li>
  );
}
```

- [ ] **Step 14.3: Render TopicsListPanel in ContentAgentTab when topics_v2 exists**

Edit `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`. Find the Content Brief sub-tab's render section (the `contentBriefContent` variable). At the very top of that section, add a conditional:

```tsx
const isPerTopic =
  Array.isArray(briefRaw?.topics_v2) &&
  (briefRaw?.topics_v2 as unknown[])?.length > 0;
```

Where `briefRaw` is the existing reference to the brief object. Then wrap the existing legacy Content Brief content (Niche Targeting + BundleSubscriptionsPanel + Tags + everything) in `{!isPerTopic && (...)}`. Above that legacy block (still inside `contentBriefContent`), add:

```tsx
{
  isPerTopic && (
    <PerTopicContentBriefSection
      domain={domain}
      initialTheme={(briefRaw?.theme as string | undefined) ?? ""}
      initialTopics={(briefRaw?.topics_v2 as TopicV2[] | undefined) ?? []}
    />
  );
}
```

Then in the same file, define the `PerTopicContentBriefSection` component (or extract it to its own file `PerTopicContentBriefSection.tsx`). It holds local state for theme + topics, renders the theme textarea, the Primary Category indicator, the TopicsListPanel, and a Save button that POSTs to `/api/sites/save` with `configUpdates: { theme, topics_v2 }`.

```tsx
function PerTopicContentBriefSection({
  domain,
  initialTheme,
  initialTopics,
}: {
  domain: string;
  initialTheme: string;
  initialTopics: TopicV2[];
}): React.ReactElement {
  const [theme, setTheme] = useState(initialTheme);
  const [topics, setTopics] = useState<TopicV2[]>(initialTopics);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: { theme, topics_v2: topics },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") toast("Saved", "success");
      else toast(data.message ?? "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
          Site Theme
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          1–2 lines describing the editorial angle. Used by AI to propose
          filters for new topics.
        </p>
        <textarea
          value={theme}
          onChange={(e): void => setTheme(e.target.value)}
          className="w-full min-h-[64px] rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 text-sm"
        />
      </div>
      <TopicsListPanel topics={topics} siteTheme={theme} onChange={setTopics} />
      <div className="flex justify-end">
        <Button onClick={(): void => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
```

Add the imports: `import { TopicsListPanel } from "./TopicsListPanel";` and `import type { TopicV2 } from "@atomic-platform/shared-types";`.

- [ ] **Step 14.4: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 14.5: Run dashboard tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm test 2>&1 | tail -5
```

Expected: all existing tests still pass.

- [ ] **Step 14.6: Commit (GATED).**

---

## Task 15: Wizard — `WizardFormData` reshape

The wizard's form data drops the legacy bundle fields and gains `theme` + `topics_v2`. DEFAULT_FORM is updated. This task touches types only — UI changes follow in Task 16.

**Files:**

- Modify: `services/dashboard/src/types/dashboard.ts` (WizardFormData)
- Modify: `services/dashboard/src/app/wizard/page.tsx` (DEFAULT_FORM)

- [ ] **Step 15.1: Update `WizardFormData`**

Edit `services/dashboard/src/types/dashboard.ts`. Find the `WizardFormData` interface. Remove these fields:

```ts
  bundleIds: string[];
  starterBundle: { enabled: boolean; name: string };
  selectedCategories: Array<{ id: string; name: string; iabCode: string }>;
  selectedTags: Array<{ id: string; name: string }>;
```

Replace with:

```ts
  /** Free-text site theme — drives AI proposals in the Topic Filters step. */
  theme: string;
  /** Topic filters built up in the Topic Filters step. */
  topics_v2: import("@atomic-platform/shared-types").TopicV2[];
```

Keep all other fields intact.

- [ ] **Step 15.2: Update DEFAULT_FORM**

Edit `services/dashboard/src/app/wizard/page.tsx`. Find the DEFAULT_FORM constant. Remove these lines:

```ts
  selectedCategories: [],
  selectedTags: [],
  bundleIds: [],
  starterBundle: { enabled: false, name: "" },
```

Add in their place:

```ts
  theme: "",
  topics_v2: [],
```

- [ ] **Step 15.3: Typecheck — expect errors in the old StepNicheTargeting and wizard.ts**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: errors in `StepNicheTargeting.tsx` and `actions/wizard.ts` (both reference the removed fields). These are fixed in Tasks 16 and 17.

- [ ] **Step 15.4: DO NOT COMMIT this task alone** — it leaves typecheck broken. Stage the changes; they'll commit together with Tasks 16 and 17.

---

## Task 16: Wizard — StepIdentity adds theme; replace StepNicheTargeting with StepTopicFilters

The wizard's existing Identity step (where site name, audiences, tone are collected) gains a "Site Theme" textarea. Then `StepNicheTargeting.tsx` is deleted and replaced with `StepTopicFilters.tsx`, which hosts `PerTopicReviewScreen` in wizard mode.

**Files:**

- Modify: `services/dashboard/src/components/wizard/StepIdentity.tsx` (add theme field)
- Delete: `services/dashboard/src/components/wizard/StepNicheTargeting.tsx`
- Create: `services/dashboard/src/components/wizard/StepTopicFilters.tsx`
- Modify: `services/dashboard/src/app/wizard/page.tsx` (swap step in the step list)

- [ ] **Step 16.1: Find StepIdentity and add the theme field**

```bash
ls /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/components/wizard/
```

The Identity step file may be named `StepIdentity.tsx`, `StepCreateSite.tsx`, or similar. Find the step that collects `siteName`, `siteTagline`, `audiences`, `tone`. Add a textarea bound to `data.theme`:

```tsx
<div className="space-y-1.5">
  <label className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
    Site theme *
  </label>
  <p className="text-xs text-[var(--text-muted)]">
    1–2 lines describing the editorial angle. AI uses this to propose filters
    for each topic.
  </p>
  <textarea
    value={data.theme}
    onChange={(e): void => onChange({ theme: e.target.value })}
    placeholder="Travel and eating while traveling — destinations, food tourism, wine routes."
    className="w-full min-h-[64px] rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 text-sm"
  />
</div>
```

Add `theme` to the step's `canProceed` check (require non-empty trimmed value).

- [ ] **Step 16.2: Create StepTopicFilters**

Create `services/dashboard/src/components/wizard/StepTopicFilters.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/Button";
import { PerTopicReviewScreen } from "@/components/topic-review/PerTopicReviewScreen";
import type { WizardFormData } from "@/types/dashboard";
import type { TopicV2 } from "@atomic-platform/shared-types";

interface Props {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepTopicFilters({
  data,
  onChange,
  onNext,
  onBack,
}: Props): React.ReactElement {
  // The wizard collects topics in an earlier step (or here we may need to ask
  // first). We assume `data.topics` (a string[] of topic names) is populated.
  const topicNames = data.topics ?? [];

  function handleSave(topics: TopicV2[]): void {
    onChange({ topics_v2: topics });
    onNext();
  }

  if (topicNames.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Topic Filters</h2>
        <p className="text-sm text-[var(--text-muted)]">
          No topics defined yet. Go back and add topics first.
        </p>
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
      </div>
    );
  }

  return (
    <PerTopicReviewScreen
      siteTheme={data.theme}
      initialTopicNames={topicNames}
      defaultSchedule={{
        articles_per_week: Math.max(
          1,
          Math.ceil(7 / Math.max(1, topicNames.length)),
        ),
        preferred_days: data.preferredDays?.length
          ? data.preferredDays
          : ["Monday", "Wednesday", "Friday"],
      }}
      onSave={async (topics): Promise<void> => handleSave(topics)}
      saveLabel="Next →"
      onCancel={onBack}
      title="Topic Filters"
    />
  );
}
```

- [ ] **Step 16.3: Update the wizard step list**

Edit `services/dashboard/src/app/wizard/page.tsx`. Find where the wizard steps are listed (an array of step components or a switch on a `step` value). Replace `StepNicheTargeting` with `StepTopicFilters` in the import + step ordering.

- [ ] **Step 16.4: Delete StepNicheTargeting**

```bash
rm /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/components/wizard/StepNicheTargeting.tsx
```

- [ ] **Step 16.5: Typecheck — expect errors only in `actions/wizard.ts`**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Errors in `actions/wizard.ts` (still references removed fields) are expected. Task 17 fixes them.

- [ ] **Step 16.6: DO NOT COMMIT this task alone** — wait for Task 17.

---

## Task 17: Rewrite `createSiteAndBuildStaging` for per-topic; update tests

`createSiteAndBuildStaging` is rewritten to write `theme` + `topics_v2` directly into `site.yaml`. The legacy bundle creation logic is removed. The existing `wizard-bundle.test.ts` is rewritten (or partially deleted) since the per-topic wizard no longer creates bundles.

**Files:**

- Modify: `services/dashboard/src/actions/wizard.ts`
- Modify or partially rewrite: `services/dashboard/src/actions/__tests__/wizard-bundle.test.ts`

- [ ] **Step 17.1: Rewrite the niche-targeting block in `createSiteAndBuildStaging`**

Edit `services/dashboard/src/actions/wizard.ts`. Locate the block in `createSiteAndBuildStaging` that resolves niche targeting (the section starting `// 0. Resolve niche targeting…`). Replace the entire block (down to and including the assignments to `categoryIds`/`tagIds` and the starter-bundle creation if-statement) with:

```ts
// 0. Per-topic model — the wizard writes brief.topics_v2 directly.
// No bundle is created from the wizard anymore; topics carry raw filters.
const topics_v2 = data.topics_v2;
const iabCategoryCodes: string[] = []; // No subcategory picks at site level on per-topic sites.
const categoryIds: string[] = [];
const tagIds: string[] = [];
```

Then find the `siteConfig` object literal and update its `brief: {…}` block:

```ts
    brief: {
      audiences: data.audiences,
      audience_type_ids: data.audienceIds.length > 0 ? data.audienceIds : undefined,
      tone: data.tone,
      article_types: {
        listicle: 40,
        standard: 30,
        "how-to": 20,
        review: 10,
      },
      topics: data.topics,
      theme: data.theme || undefined,
      topics_v2: topics_v2.length > 0 ? topics_v2 : undefined,
      seo_keywords_focus: [],
      content_guidelines: data.contentGuidelines
        ? data.contentGuidelines.split("\n").filter(Boolean)
        : [],
      image_guidelines: data.imageGuidelines
        ? data.imageGuidelines.split("\n").filter(Boolean)
        : undefined,
      vertical: data.vertical || undefined,
      vertical_id: data.verticalId || undefined,
      review_percentage: 5,
      schedule: {
        articles_per_day: data.articlesPerDay,
        preferred_days: data.preferredDays,
        preferred_time: "10:00",
      },
    },
```

Remove `bundle_id`, `category_ids`, `tag_ids` from the brief — they're not on per-topic sites. Remove the top-level `bundle_id` from siteConfig.

Remove the `createBundle` helper function and its `createBundleForSite` export — they're no longer used. Also remove the `createBundleForSite` import wherever it appears in non-wizard call sites (if it's no longer used elsewhere). Verify with:

```bash
grep -rn "createBundle\|createBundleForSite" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/ | grep -v "\.test\."
```

- [ ] **Step 17.2: Rewrite wizard-bundle tests**

The existing wizard-bundle.test.ts tested the bundle-creation flow that no longer exists. Replace with `wizard-per-topic.test.ts` that verifies the new shape is written:

```bash
mv /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/actions/__tests__/wizard-bundle.test.ts /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/actions/__tests__/wizard-per-topic.test.ts
```

Then open the moved file and replace its content with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WizardFormData } from "@/types/dashboard";

vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  readDashboardIndex: vi.fn().mockResolvedValue({ sites: [] }),
  writeDashboardIndex: vi.fn().mockResolvedValue(undefined),
  readSiteConfig: vi.fn(),
  updateSiteInIndex: vi.fn().mockResolvedValue(undefined),
  addSitesToIndex: vi.fn().mockResolvedValue(undefined),
  createBranch: vi.fn().mockResolvedValue(undefined),
  mergeBranchToMain: vi.fn(),
  deleteBranch: vi.fn(),
  branchExists: vi.fn().mockResolvedValue(false),
  triggerWorkflowViaPush: vi.fn().mockResolvedValue(undefined),
  readFileBase64: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({
  listZones: vi.fn(),
  registerWorkerCustomDomain: vi.fn(),
  deregisterWorkerCustomDomain: vi.fn(),
  putKVEntry: vi.fn(),
  deleteKVEntry: vi.fn(),
  getKVEntry: vi.fn(),
  listKVKeys: vi.fn(),
  bulkPutKV: vi.fn(),
}));
vi.mock("@/lib/constants", () => ({
  workerPreviewUrl: vi.fn(
    (f: string) => `https://staging.workers.dev/?_atl_site=${f}`,
  ),
  KV_NAMESPACE_PROD: "prod",
  KV_NAMESPACE_STAGING: "staging",
}));
vi.mock("@/lib/remove-background", () => ({ removeBackground: vi.fn() }));
vi.mock("@/lib/favicon-extractor", () => ({ extractFaviconFromLogo: vi.fn() }));
vi.mock("@/lib/email-routing", () => ({
  enableEmailRouting: vi.fn(),
  createEmailRoutingRule: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createSiteAndBuildStaging } from "../wizard";

function makeFormData(overrides: Partial<WizardFormData> = {}): WizardFormData {
  return {
    domain: "testsite.com",
    pagesProjectName: "testsite",
    siteName: "Test Site",
    siteTagline: "A test",
    company: "ATL",
    vertical: "Travel",
    verticalId: "v1",
    iabVerticalCode: "IAB20",
    groups: [],
    themePreset: "default",
    themeColors: {},
    themeLayout: {
      hero: { enabled: true, count: 3 },
      must_reads: { enabled: true, count: 4 },
      whats_new: { enabled: true, count: 4 },
      more_on: { enabled: true, page_size: 8 },
      sidebar_topics: { auto: true, explicit: [] },
      load_more: { page_size: 12 },
    },
    audiences: ["Travelers"],
    audienceIds: [],
    theme: "Travel and food tourism",
    topics_v2: [
      {
        name: "Destinations",
        source: { type: "filter", category_ids: ["c1"], tag_ids: ["t1"] },
        schedule: { articles_per_week: 2, preferred_days: ["Mon"] },
      },
    ],
    tone: "informative",
    topics: ["Destinations"],
    articlesPerDay: 1,
    preferredDays: ["Monday"],
    contentGuidelines: "",
    imageGuidelines: "",
    primaryColor: "#000",
    accentColor: "#fff",
    fontHeading: "Inter",
    fontBody: "Inter",
    scriptsVars: {},
    ...overrides,
  };
}

describe("createSiteAndBuildStaging — per-topic wizard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes brief.theme + brief.topics_v2 to site.yaml and never writes bundle_ids", async () => {
    const data = makeFormData();
    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    const { commitSiteFiles } = await import("@/lib/github");
    const files = vi.mocked(commitSiteFiles).mock.calls[0]![1] as Array<{
      path: string;
      content: string;
    }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    expect(siteYaml).toBeDefined();

    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as {
      brief: Record<string, unknown>;
      bundle_id?: string;
    };
    expect(parsed.brief.theme).toBe("Travel and food tourism");
    expect(parsed.brief.topics_v2).toBeDefined();
    expect((parsed.brief.topics_v2 as unknown[]).length).toBe(1);
    expect(parsed.brief.bundle_ids).toBeUndefined();
    expect(parsed.brief.bundle_id).toBeUndefined();
    expect(parsed.bundle_id).toBeUndefined();
  });

  it("omits brief.topics_v2 when the wizard passes an empty topics_v2", async () => {
    const data = makeFormData({ topics_v2: [] });
    await createSiteAndBuildStaging(data);
    const { commitSiteFiles } = await import("@/lib/github");
    const files = vi.mocked(commitSiteFiles).mock.calls[0]![1] as Array<{
      path: string;
      content: string;
    }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as {
      brief: Record<string, unknown>;
    };
    expect(parsed.brief.topics_v2).toBeUndefined();
  });
});
```

- [ ] **Step 17.3: Run all dashboard tests**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm test 2>&1 | tail -8
```

Expected: the new per-topic tests pass. Existing tests outside the wizard-bundle file still pass (the dashboard's 169-test baseline minus the 15 removed wizard-bundle tests plus 2 new per-topic tests = ~156 tests).

- [ ] **Step 17.4: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 17.5: Commit (GATED) — Tasks 15, 16, 17 commit together as one logical chunk** (wizard rewrite).

---

## Task 18: Guide page

Add an in-app guide page covering the per-topic model and migration.

**Files:**

- Create: `services/dashboard/public/guide/21-per-topic-filters.md`
- Modify: `services/dashboard/src/app/guide/page.tsx` (register the new page)

- [ ] **Step 18.1: Create the markdown**

Create `services/dashboard/public/guide/21-per-topic-filters.md`:

```markdown
# Per-Topic Content Filters

The per-topic-filters model treats each topic (menu section) as an editorial unit with its own content source and its own schedule. It replaces the older flat "Content Bundles" model on opted-in sites.

## What changes

- **Topic = the editorial unit.** Each topic on the site (Wine & Beer, Destinations, etc.) gets its own filter — either a raw `category_ids` + `tag_ids` selection (AI-proposed by default) or a pointer to a shared bundle on the aggregator.
- **Articles are auto-tagged by topic.** When an article is fetched against a topic's filter, it's tagged with that topic. If the article also matches another topic's filter, it's tagged with that topic too — so it appears on both section pages.
- **Per-topic schedule.** Each topic has its own `articles_per_week` and `preferred_days`. Wine might be 1/week on Tuesday; Destinations might be 3/week on Mon/Wed/Fri.
- **Site theme replaces "Primary Category" for AI context.** The free-text site theme (1–2 lines) is what AI uses to propose filters. Primary Category stays as identification metadata only (drives ads.txt IAB code, dashboard categorization).

## When does this apply?

Only sites with `brief.topics_v2` set in their config use this model. Legacy sites (with `brief.bundle_ids`) continue to work exactly as before, with the existing Content Brief UI. To opt a legacy site into the new model, use the "Migrate to per-topic filters" toggle on Site Settings → Identity.

## Creating new sites

The wizard creates per-topic sites by default. You enter the site theme as part of the Identity step, define topics, and the Topic Filters step uses AI to propose a filter per topic that you can review and edit.

## Migrating an existing site

1. Open the site detail → Site Settings → Identity tab.
2. Click "Migrate to per-topic filters →".
3. Enter the site theme (1–2 lines) if it's not already set.
4. Review the AI-proposed filter for each of the site's existing topics. Edit any that don't look right.
5. Decide whether to delete this site's orphan bundles on the aggregator (default: yes; shared bundles are kept).
6. Click "Confirm migration".

The migration writes the new shape to site.yaml and removes the old bundle subscriptions. Reverting requires a git revert of the migration commit.

## Limitations

- The AI proposes filters using only existing categories and tags on the aggregator — it never invents new ones.
- A topic with no filter set produces no articles for that section. The site renders the section page empty (with no fallback).
- Cross-topic membership is evaluated only against topics with raw filters. Topics that use a linked bundle don't receive cross-topic assignments (we can't tell from an item alone whether it's in an arbitrary bundle without an aggregator round-trip).
```

- [ ] **Step 18.2: Register in the guide index**

```bash
grep -n "GUIDE_PAGES\|content-pipeline\|20-bundles" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/app/guide/page.tsx | head -10
```

Add an entry in the `GUIDE_PAGES` array right after the existing `20-bundles` entry:

```ts
{ slug: "21-per-topic-filters", title: "Per-Topic Filters" },
```

- [ ] **Step 18.3: Typecheck**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: clean.

- [ ] **Step 18.4: Commit (GATED).**

---

## Task 19: Full manual integration verification (user-side)

Asaf executes this; no subagent. Confirms the end-to-end paths work in `cloudgrid dev`.

- [ ] **Step 19.1: Create a new site via the wizard**

`cloudgrid dev` → `http://localhost:3001/wizard`. Walk through identity (filling Site Theme), set topics, reach the Topic Filters step. Confirm AI proposes filters for each topic, edit one, then continue and finish the wizard.

Inspect the resulting site.yaml on the staging branch: expect `brief.theme`, `brief.topics_v2` populated; no `bundle_ids` / `category_ids` / `tag_ids` at the brief level; no top-level `bundle_id`.

- [ ] **Step 19.2: Migrate an existing legacy site**

For a legacy test site (e.g. travelnights staging), Site Settings → Identity → "Migrate to per-topic filters". Type theme, walk through the migration review (verify AI proposals), confirm with the orphan-bundle-delete checkbox checked. Inspect site.yaml: new shape; legacy fields removed.

- [ ] **Step 19.3: Trigger content generation on a per-topic site**

From the dashboard, click Generate articles. Watch the content-pipeline logs (`cloudgrid dev` tail). Expect log lines per topic; expect articles to be assigned to the topic they were fetched from; expect cross-topic secondaries when filters overlap.

- [ ] **Step 19.4: Verify legacy site still works**

For a still-legacy site, trigger generation. Confirm the pipeline takes the legacy bundle fan-out path (no per-topic log lines) and articles are generated as today.

- [ ] **Step 19.5: Sign-off**

Asaf reports green / red. Plan is complete only after Asaf says "ok commit" for each chunk.

---

## Commit chunks (only after Asaf approves each)

When Asaf says "ok commit" for a chunk, batch the commit per the chunks below:

- [ ] **Chunk A: Types** (Task 1)
- [ ] **Chunk B: AI propose-filter endpoint + dashboard proxy** (Tasks 2, 3)
- [ ] **Chunk C: Per-topic fetch helpers + dispatcher + regression guard** (Tasks 4, 5, 6)
- [ ] **Chunk D: Site-worker frontmatter compat** (Task 7)
- [ ] **Chunk E: Save route + migration server action** (Tasks 8, 9)
- [ ] **Chunk F: Shared review component** (Task 10)
- [ ] **Chunk G: Migration page + summary API + Identity toggle** (Tasks 11, 12)
- [ ] **Chunk H: TopicEditModal + TopicsListPanel + ContentAgentTab conditional** (Tasks 13, 14)
- [ ] **Chunk I: Wizard rewrite (form data + steps + action + tests)** (Tasks 15, 16, 17)
- [ ] **Chunk J: Guide doc** (Task 18)

Standard commit syntax (heredoc + Co-Authored-By trailer); see prior plans for exact format.

---

## Out of scope (do not implement)

- Cross-site bundle housekeeping page.
- Manual IAB code override (separate from Primary Category).
- Per-topic article count overrides per run.
- Topic icons.
- Migration reversibility UI.
- Audience-based filtering inside topic filters.
