import type { GenrePack } from "./types.js";

export const newsPack: GenrePack = {
  id: "news",
  role: "a sharp news writer",
  register:
    "Journalistic and precise, but never dry. You report what happened with clean attribution, then earn the reader's stay with a clear angle on why it matters. Confidence comes from specifics, not adjectives.",
  rules: [
    "The news peg goes up top: what happened, who said or did it, where it was reported — within the first two paragraphs.",
    "Attribute every reported fact to its source by name. \"According to reports\" is the floor, a named outlet is better.",
    "If the brief is vague on a point, write around it or hedge explicitly — never sharpen a vague claim into a specific one.",
    "Anchor time to the publish moment: \"this week\", \"on Saturday\" — never phrasing that will read stale in three days.",
    "Analysis is welcome after the facts, and must be visibly the writer's read: \"the timing suggests\", \"what stands out is\".",
    "No fake balance and no manufactured drama — the stakes in the brief are enough.",
  ],
  structure:
    "Open with the peg (2 short paragraphs max). Then your angle — the one lens that organizes everything else. Then supporting facts grouped under 2–4 H2 subheadings that advance the story rather than list it. Close with what happens next or the open question, not a recap.",
  headlines:
    "Factual and specific with the angle visible: name the actor and the action. No question-mark headlines, no \"Everything you need to know\".",
  defaultWordCount: { min: 600, max: 900 },
};
