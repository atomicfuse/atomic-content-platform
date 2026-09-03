import { getMongoDb } from "../lib/mongo.js";
import { COST_COLLECTIONS } from "./types.js";
import { costFor, normalizeModelId } from "./pricing.js";
import type { GenerationSource } from "../stats/types.js";

/**
 * Build the aggregation pipeline update for the site_costs rollup.
 *
 * WHY a pipeline update instead of $inc / $set with dotted paths:
 *   Model IDs such as "gemini-2.5-flash-image" contain literal dots.
 *   MongoDB interprets dots in $inc/$set path strings as sub-document
 *   separators, so `byModel.gemini-2.5-flash-image.images` would be
 *   stored under byModel["gemini-2"]["5-flash-image"]["images"] instead
 *   of byModel["gemini-2.5-flash-image"]["images"].
 *
 *   Using an aggregation pipeline with $setField + { field: {$literal: model} }
 *   avoids this pitfall — field names are treated literally, preserving dots.
 *   $getField with the same $literal form is used to safely read existing
 *   per-model sub-documents for accumulation.
 *
 * latest-event-wins semantics for the per-model `estimated` flag:
 *   Each call overwrites the flag with the current value. Callers that
 *   receive exact token counts (estimated=false) will win over earlier
 *   estimated events. Image events are always estimated=false.
 */
function buildSiteCostsUpdate(
  model: string,
  inputTokens: number,
  outputTokens: number,
  images: number,
  costUsd: number,
  estimated: boolean,
): object[] {
  // Read the existing model sub-document safely, defaulting all numeric
  // fields to 0 when the model has not been seen before.
  const existingModelDoc = {
    $ifNull: [
      {
        $getField: {
          field: { $literal: model },
          input: { $ifNull: ["$byModel", {}] },
        },
      },
      { inputTokens: 0, outputTokens: 0, images: 0, costUsd: 0 },
    ],
  };

  return [
    {
      $set: {
        totalCostUsd: { $add: [{ $ifNull: ["$totalCostUsd", 0] }, costUsd] },
        updatedAt: "$$NOW",
        byModel: {
          $setField: {
            field: { $literal: model },
            input: { $ifNull: ["$byModel", {}] },
            value: {
              inputTokens: {
                $add: [{ $getField: { field: "inputTokens", input: existingModelDoc } }, inputTokens],
              },
              outputTokens: {
                $add: [{ $getField: { field: "outputTokens", input: existingModelDoc } }, outputTokens],
              },
              images: {
                $add: [{ $getField: { field: "images", input: existingModelDoc } }, images],
              },
              costUsd: {
                $add: [{ $getField: { field: "costUsd", input: existingModelDoc } }, costUsd],
              },
              // latest-event-wins: overwrite estimated flag with the current call's value
              estimated,
            },
          },
        },
      },
    },
  ];
}

/**
 * Records a text-generation cost event and upserts the per-site cost rollup.
 *
 * Failure-isolated: any Mongo error is caught and logged; this function
 * NEVER throws.
 */
export async function recordTextUsage(p: {
  siteDomain: string;
  source: GenerationSource;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}): Promise<void> {
  try {
    const model = normalizeModelId(p.model);
    const { costUsd } = costFor(model, {
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      images: 0,
    });

    const db = await getMongoDb();

    // Insert raw cost event
    await db.collection(COST_COLLECTIONS.costEvents).insertOne({
      siteDomain: p.siteDomain,
      kind: "text" as const,
      model,
      source: p.source,
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      images: 0,
      estimated: p.estimated,
      costUsd,
      at: new Date(),
    });

    // Upsert site-level rollup using aggregation pipeline to handle model
    // names that contain dots (e.g. "gemini-2.5-flash-image").
    await db.collection(COST_COLLECTIONS.siteCosts).updateOne(
      { _id: p.siteDomain as any },
      buildSiteCostsUpdate(model, p.inputTokens, p.outputTokens, 0, costUsd, p.estimated),
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[costs] recordTextUsage failed (non-fatal): ${msg}`);
  }
}

/**
 * Records an image-generation cost event and upserts the per-site cost rollup.
 *
 * Failure-isolated: any Mongo error is caught and logged; this function
 * NEVER throws.
 */
export async function recordImageUsage(p: {
  siteDomain: string;
  source: GenerationSource;
  model: string;
  images: number;
}): Promise<void> {
  try {
    const model = normalizeModelId(p.model);
    const { costUsd } = costFor(model, {
      inputTokens: 0,
      outputTokens: 0,
      images: p.images,
    });

    const db = await getMongoDb();

    // Insert raw cost event (image events are never estimated — per-image
    // pricing is always known)
    await db.collection(COST_COLLECTIONS.costEvents).insertOne({
      siteDomain: p.siteDomain,
      kind: "image" as const,
      model,
      source: p.source,
      inputTokens: 0,
      outputTokens: 0,
      images: p.images,
      estimated: false,
      costUsd,
      at: new Date(),
    });

    // Upsert site-level rollup using aggregation pipeline to handle model
    // names that contain dots (e.g. "gemini-2.5-flash-image").
    // Image events are never estimated=true (latest-event-wins writes false).
    await db.collection(COST_COLLECTIONS.siteCosts).updateOne(
      { _id: p.siteDomain as any },
      buildSiteCostsUpdate(model, 0, 0, p.images, costUsd, false),
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[costs] recordImageUsage failed (non-fatal): ${msg}`);
  }
}
