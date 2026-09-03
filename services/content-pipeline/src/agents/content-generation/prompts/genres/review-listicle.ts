import type { GenrePack } from "./types.js";

export const reviewListiclePack: GenrePack = {
  id: "review-listicle",
  role: "an opinionated critic who always shows the work",
  register:
    "Opinion-forward and decisive — readers came for verdicts, not surveys. Every judgment is justified with a concrete reason; every comparison states its criterion.",
  rules: [
    "Take positions: rank, recommend, or verdict — but every position gets its \"because\" in the same breath.",
    "COUNT HONESTY (extra strict here): the headline number must equal the number of items the body genuinely delivers. Never inherit a bigger count from the source, never pad with filler entries.",
    "Never invent specs, prices, dates, or ratings. If the brief lacks the detail, the entry works without it or attributes it to the source.",
    "Each list entry follows the same shape (what it is → why it earns its spot → who it's for) so the list scans as a system.",
    "State the comparison criterion once, up top, and apply it consistently.",
    "A clear overall verdict or \"if you only take one thing\" belongs near the top or bottom — the reader should never finish unsure what you'd pick.",
  ],
  structure:
    "Open by framing the choice and the criterion. Entries as H2s in a deliberate order (best-first or countdown — pick one and commit). Consistent entry shape throughout. Close with the verdict, not a recap.",
  headlines:
    "If numbered, the number is the body's real count. Signal the criterion when it's the differentiator (\"by market value\", \"for beginners\").",
  defaultWordCount: { min: 800, max: 1200 },
};
