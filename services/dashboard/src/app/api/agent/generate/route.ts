// services/dashboard/src/app/api/agent/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { invalidateSiteCaches } from "@/lib/github";
import { revalidatePath } from "next/cache";

const REDIS_URL = process.env.REDIS_URL;

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

/**
 * POST /api/agent/generate
 *
 * If REDIS_URL is configured, enqueues a BullMQ job and waits up to 90s
 * for the result via QueueEvents.waitUntilFinished.
 * Falls back to direct HTTP proxy if queue is not available.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteDomain: string;
    branch?: string | null;
    count?: number | null;
    /** Per-topic override for per-topic sites. Defaults `count` to 1 if unset. */
    topicName?: string | null;
  };

  if (!body.siteDomain) {
    return NextResponse.json(
      { status: "error", message: "siteDomain is required" },
      { status: 400 },
    );
  }

  const topicName =
    typeof body.topicName === "string" && body.topicName.trim().length > 0
      ? body.topicName
      : undefined;
  // For per-topic on-demand generation, default to 1 article unless caller
  // overrode `count`. For legacy/scheduled paths, keep the existing default of 3.
  const defaultCount = topicName ? 1 : 3;

  // ---------- Queue path ----------
  if (REDIS_URL) {
    try {
      const { getGenerateQueue, getGenerateQueueEvents } = await import(
        "@/lib/queue"
      );
      const queue = getGenerateQueue();
      const queueEvents = getGenerateQueueEvents();

      const job = await queue.add("generate", {
        siteDomain: body.siteDomain,
        count: body.count ?? defaultCount,
        branch: body.branch ?? `staging/${body.siteDomain}`,
        triggeredBy: "manual",
        // Manual dashboard trigger: skip the per-topic date eligibility check
        // so users can fire it any day, regardless of preferred_days.
        bypassSchedule: true,
        ...(topicName ? { topicName } : {}),
      });

      try {
        const result = await job.waitUntilFinished(queueEvents, 90_000);
        const branch = body.branch ?? `staging/${body.siteDomain}`;
        invalidateSiteCaches(body.siteDomain, branch);
        revalidatePath(`/sites/${encodeURIComponent(body.siteDomain)}`);
        return NextResponse.json(result as Record<string, unknown>, {
          status: 201,
        });
      } catch {
        // Timed out or job failed — return 202 with jobId for polling
        const state = await job.getState();
        if (state === "failed") {
          return NextResponse.json(
            {
              status: "failed",
              jobId: job.id,
              error: job.failedReason,
            },
            { status: 500 },
          );
        }
        return NextResponse.json(
          {
            status: "accepted",
            jobId: job.id,
            message: "Job is still running. Poll /api/agent/job/{jobId} for status.",
          },
          { status: 202 },
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Queue error";
      console.error("[generate] Queue enqueue failed:", message);
      // Fall through to HTTP proxy
    }
  }

  // ---------- Fallback: direct HTTP proxy ----------
  const agentUrl = getAgentUrl();
  try {
    const agentResponse = await fetch(`${agentUrl}/content-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteDomain: body.siteDomain,
        ...(body.branch ? { branch: body.branch } : {}),
        ...(body.count ? { count: body.count } : topicName ? { count: defaultCount } : {}),
        ...(topicName ? { topicName } : {}),
        bypassSchedule: true,
      }),
    });
    const result = (await agentResponse.json()) as Record<string, unknown>;
    if (agentResponse.ok) {
      const branch = body.branch ?? `staging/${body.siteDomain}`;
      invalidateSiteCaches(body.siteDomain, branch);
      revalidatePath(`/sites/${encodeURIComponent(body.siteDomain)}`);
    }
    return NextResponse.json(result, { status: agentResponse.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running?`,
      },
      { status: 502 },
    );
  }
}
