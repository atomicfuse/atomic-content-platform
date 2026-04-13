import { NextResponse } from "next/server";
import { triggerSchedulerRun } from "@/lib/scheduler";

export async function POST(): Promise<NextResponse> {
  try {
    const result = await triggerSchedulerRun();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/scheduler/run-now] error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to trigger scheduler", details: message },
      { status: 502 },
    );
  }
}
