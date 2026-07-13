import type { GenreId, GenrePack } from "./types.js";
import { newsPack } from "./news.js";
import { evergreenPack } from "./evergreen.js";
import { popCulturePack } from "./pop-culture.js";
import { reviewListiclePack } from "./review-listicle.js";

export type { GenreId, GenrePack } from "./types.js";

export const GENRE_PACKS: Record<GenreId, GenrePack> = {
  news: newsPack,
  evergreen: evergreenPack,
  "pop-culture": popCulturePack,
  "review-listicle": reviewListiclePack,
};
