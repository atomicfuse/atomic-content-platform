/**
 * Content Quality Agent — scores generated articles against configurable criteria.
 *
 * Uses Claude to evaluate articles on SEO quality, tone match, content length,
 * factual accuracy, and keyword relevance. The weighted score determines whether
 * an article is auto-published or flagged for human review.
 */

import type { SiteBrief, QualityWeights, QualityScoreBreakdown } from "@atomic-platform/shared-types";
import { generateContent } from "../../lib/ai.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityResult {
  /** Overall weighted score 0-100. */
  overallScore: number;
  /** Per-criterion breakdown. */
  breakdown: QualityScoreBreakdown;
  /** One-sentence reasoning note. */
  note: string;
}

export interface ArticleToScore {
  title: string;
  description: string;
  body: string;
  tags: string[];
  type: string;
}

// ---------------------------------------------------------------------------
// Default weights — equal distribution
// ---------------------------------------------------------------------------

export const DEFAULT_QUALITY_WEIGHTS: Required<QualityWeights> = {
  seo_quality: 20,
  tone_match: 20,
  content_length: 20,
  factual_accuracy: 20,
  keyword_relevance: 20,
};

const DEFAULT_THRESHOLD = 75;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildQualityScoringPrompt(
  article: ArticleToScore,
  siteName: string,
  brief: SiteBrief,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a content quality evaluator for ${siteName}. Your job is to score articles on a 0-100 scale across five criteria.

## Site Context
- Audience: ${brief.audience}
- Tone: ${brief.tone}
- Topics: ${brief.topics.join(", ")}
- SEO Keywords: ${brief.seo_keywords_focus.join(", ")}
- Content Guidelines: ${Array.isArray(brief.content_guidelines) ? brief.content_guidelines.join("; ") : brief.content_guidelines}

## Scoring Criteria

1. **seo_quality** (0-100): Evaluate the title (compelling, good length 50-60 chars), meta description (informative, 120-160 chars), heading structure (uses H2/H3), keyword integration (natural, not stuffed).

2. **tone_match** (0-100): How well the writing matches "${brief.tone}" tone for "${brief.audience}" audience. Consider vocabulary, sentence structure, formality level, and engagement style.

3. **content_length** (0-100): Target is ~1000 words. Score 100 for 900-1100 words. Penalize: <500 words gets ≤40, 500-700 gets ≤60, 700-900 gets ≤80. Over 1500 words gets ≤70 (too long).

4. **factual_accuracy** (0-100): Check for obvious hallucinations, fabricated statistics, contradictory statements, or unsupported claims. Score 100 if no issues detected. Deduct heavily for any fabricated data.

5. **keyword_relevance** (0-100): How well the article covers the site's topics (${brief.topics.join(", ")}) and SEO keywords (${brief.seo_keywords_focus.join(", ")}). Check title, body, and tags.

## Output Format
Respond ONLY with a valid JSON object (no markdown fences):
{
  "seo_quality": <number 0-100>,
  "tone_match": <number 0-100>,
  "content_length": <number 0-100>,
  "factual_accuracy": <number 0-100>,
  "keyword_relevance": <number 0-100>,
  "note": "<one sentence explaining the overall quality assessment>"
}`;

  const wordCount = article.body.split(/\s+/).filter(Boolean).length;

  const userPrompt = `## Article to Evaluate

**Title:** ${article.title}
**Description:** ${article.description}
**Type:** ${article.type}
**Tags:** ${article.tags.join(", ")}
**Word Count:** ${wordCount}

## Article Body
${article.body}

Score this article on all five criteria.`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface ClaudeScoreResponse {
  seo_quality: number;
  tone_match: number;
  content_length: number;
  factual_accuracy: number;
  keyword_relevance: number;
  note: string;
}

function parseScoreResponse(raw: string): ClaudeScoreResponse {
  // Handle markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cleaned = fenceMatch ? fenceMatch[1]! : raw;
  return JSON.parse(cleaned.trim()) as ClaudeScoreResponse;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Resolve quality weights, filling in defaults for any missing criteria.
 */
export function resolveWeights(weights?: QualityWeights): Required<QualityWeights> {
  if (!weights) return { ...DEFAULT_QUALITY_WEIGHTS };

  return {
    seo_quality: weights.seo_quality ?? DEFAULT_QUALITY_WEIGHTS.seo_quality,
    tone_match: weights.tone_match ?? DEFAULT_QUALITY_WEIGHTS.tone_match,
    content_length: weights.content_length ?? DEFAULT_QUALITY_WEIGHTS.content_length,
    factual_accuracy: weights.factual_accuracy ?? DEFAULT_QUALITY_WEIGHTS.factual_accuracy,
    keyword_relevance: weights.keyword_relevance ?? DEFAULT_QUALITY_WEIGHTS.keyword_relevance,
  };
}

/**
 * Calculate the weighted overall score from sub-scores and weights.
 */
export function calculateWeightedScore(
  breakdown: QualityScoreBreakdown,
  weights: Required<QualityWeights>,
): number {
  const totalWeight =
    weights.seo_quality +
    weights.tone_match +
    weights.content_length +
    weights.factual_accuracy +
    weights.keyword_relevance;

  // Avoid division by zero
  if (totalWeight === 0) return 0;

  const weightedSum =
    breakdown.seo_quality * weights.seo_quality +
    breakdown.tone_match * weights.tone_match +
    breakdown.content_length * weights.content_length +
    breakdown.factual_accuracy * weights.factual_accuracy +
    breakdown.keyword_relevance * weights.keyword_relevance;

  return Math.round(weightedSum / totalWeight);
}

/**
 * Score an article using Claude.
 */
export async function scoreArticle(
  article: ArticleToScore,
  siteName: string,
  brief: SiteBrief,
  weights?: QualityWeights,
): Promise<QualityResult> {
  const resolvedWeights = resolveWeights(weights);
  const { systemPrompt, userPrompt } = buildQualityScoringPrompt(article, siteName, brief);

  // Retry once on failure (rate limits, transient errors)
  let rawResponse: string;
  try {
    rawResponse = await generateContent({
      systemPrompt,
      userPrompt,
      maxTokens: 512,
    });
  } catch (firstErr) {
    console.warn(
      `[scorer] First attempt failed, retrying in 3s:`,
      firstErr instanceof Error ? firstErr.message : firstErr,
    );
    await new Promise((r) => setTimeout(r, 3000));
    rawResponse = await generateContent({
      systemPrompt,
      userPrompt,
      maxTokens: 512,
    });
  }

  const parsed = parseScoreResponse(rawResponse);

  const breakdown: QualityScoreBreakdown = {
    seo_quality: clampScore(parsed.seo_quality),
    tone_match: clampScore(parsed.tone_match),
    content_length: clampScore(parsed.content_length),
    factual_accuracy: clampScore(parsed.factual_accuracy),
    keyword_relevance: clampScore(parsed.keyword_relevance),
  };

  const overallScore = calculateWeightedScore(breakdown, resolvedWeights);

  return {
    overallScore,
    breakdown,
    note: parsed.note || "No quality note provided.",
  };
}

/**
 * Determine article status based on quality score and threshold.
 */
export function resolveStatus(
  overallScore: number,
  threshold?: number,
): "published" | "review" {
  const t = threshold ?? DEFAULT_THRESHOLD;
  return overallScore >= t ? "published" : "review";
}
