/**
 * Extract word count targets from free-form content guidelines.
 *
 * Parses strings like "max 400 words per article", "300-500 words",
 * "at least 800 words", etc. Falls back to caller-supplied defaults
 * when no word-count hint is found.
 */

export interface WordCountTarget {
  min: number;
  max: number;
  /** Human-readable label for prompts, e.g. "240-400 word" */
  label: string;
}

export function parseWordCountFromGuidelines(
  guidelines: string | string[],
  defaultMin: number,
  defaultMax: number,
): WordCountTarget {
  const text = Array.isArray(guidelines) ? guidelines.join(" ") : guidelines;

  // "max 400 words", "up to 1340 words", "no more than 500 words per article"
  const maxMatch = text.match(
    /(?:max(?:imum)?|up\s+to|no\s+more\s+than|under|fewer\s+than|at\s+most)\s+(\d+)\s*words/i,
  );
  if (maxMatch) {
    const max = parseInt(maxMatch[1]!, 10);
    const min = Math.max(Math.round(max * 0.6), 50);
    return { min, max, label: `${min}-${max} word` };
  }

  // "300-500 words", "300 to 500 words"
  const rangeMatch = text.match(/(\d+)\s*[-–—]\s*(\d+)\s*words/i);
  if (rangeMatch) {
    return {
      min: parseInt(rangeMatch[1]!, 10),
      max: parseInt(rangeMatch[2]!, 10),
      label: `${rangeMatch[1]}-${rangeMatch[2]} word`,
    };
  }

  const rangeToMatch = text.match(/(\d+)\s+to\s+(\d+)\s*words/i);
  if (rangeToMatch) {
    return {
      min: parseInt(rangeToMatch[1]!, 10),
      max: parseInt(rangeToMatch[2]!, 10),
      label: `${rangeToMatch[1]}-${rangeToMatch[2]} word`,
    };
  }

  // "min 400 words", "at least 800 words"
  const minMatch = text.match(
    /(?:min(?:imum)?|at\s+least)\s+(\d+)\s*words/i,
  );
  if (minMatch) {
    const min = parseInt(minMatch[1]!, 10);
    const max = Math.round(min * 1.5);
    return { min, max, label: `${min}-${max} word` };
  }

  return { min: defaultMin, max: defaultMax, label: `${defaultMin}-${defaultMax} word` };
}
