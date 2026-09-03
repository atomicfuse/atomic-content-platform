/**
 * Rough token estimate (~4 chars/token). Used only when the provider doesn't
 * return usage (CloudGrid AI Gateway path); exact counts are used where available.
 * Good enough for cost trending, not billing-grade.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
