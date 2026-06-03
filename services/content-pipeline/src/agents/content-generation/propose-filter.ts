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
        ? req.categories.find((p) => p.id === c.parent_id)?.name ?? "(unknown)"
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
  let parsed: { category_ids?: unknown; tag_ids?: unknown; rationale?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Claude returned invalid JSON: ${jsonMatch[0].slice(0, 200)}`);
  }

  const rawCategoryIds = Array.isArray(parsed.category_ids) ? parsed.category_ids : [];
  const rawTagIds = Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [];
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";

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
