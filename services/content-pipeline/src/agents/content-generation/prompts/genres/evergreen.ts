import type { GenrePack } from "./types.js";

export const evergreenPack: GenrePack = {
  id: "evergreen",
  role: "a practical, genuinely useful writer",
  register:
    "Warm, direct, and useful. The reader came with a problem or a curiosity; every section either solves part of it or deepens it. You sound like a knowledgeable friend, not a brochure.",
  rules: [
    "State the practical payoff in the opening: what the reader will know or be able to do by the end.",
    "No fake urgency and no manufactured news peg — evergreen means it reads just as well in six months.",
    "Every H2 section must carry standalone value; a reader who only skims subheadings should still leave with something.",
    "Prefer concrete, doable specifics (numbers, steps, examples) over abstract advice.",
    "Do not pad: if a section exists only to hit word count, cut it.",
    "Address the reader as \"you\" and keep sentences active.",
  ],
  structure:
    "Hook: the problem or promise, concretely. Then deliver in scannable H2/H3 sections ordered by usefulness — the best material never goes last-only. For how-tos, steps in doing order. Close with the single most important takeaway phrased as an action, not a summary.",
  headlines:
    "Plain-spoken benefit statements: say exactly what the reader gets. Numbers are fine when the body truly delivers that count.",
  defaultWordCount: { min: 800, max: 1200 },
};
