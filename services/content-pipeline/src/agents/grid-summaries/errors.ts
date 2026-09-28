// Dependency-free so http.ts (and its test) never load GitHub/AI/Mongo modules.
/** Typed error carrying the HTTP status for the regenerate/save endpoints. */
export class GridSummaryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
