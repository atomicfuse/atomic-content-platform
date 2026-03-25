/**
 * Content Generation Agent
 *
 * Generates new articles for sites based on their content brief.
 *
 * Flow:
 * 1. Select target site (based on schedule or CLI arg)
 * 2. Read site brief from network repo
 * 3. Select article type using weighted random from brief.article_types
 * 4. Load article template from platform repo
 * 5. Generate article via Claude API
 * 6. Set status (published or review based on brief.review_percentage)
 * 7. Commit .md to network repo
 * 8. Notify if article sent to review
 *
 * Usage:
 *   pnpm agent:content-generation
 *   # or with specific site:
 *   SITE_DOMAIN=coolnews.dev pnpm agent:content-generation
 */

// TODO: Implement content generation agent

export class ContentGenerationAgent {
  // TODO: implement
}
