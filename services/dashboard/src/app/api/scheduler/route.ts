import { NextRequest, NextResponse } from "next/server";
import {
  readSchedulerConfig,
  writeSchedulerConfig,
  type SchedulerConfig,
} from "@/lib/scheduler";

export async function GET(): Promise<NextResponse> {
  try {
    const config = await readSchedulerConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[api/scheduler] read error:", error);
    return NextResponse.json(
      { error: "Failed to read scheduler config" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<SchedulerConfig>;
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled (boolean) is required" },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(body.run_at_hours) ||
      body.run_at_hours.length === 0 ||
      !body.run_at_hours.every(
        (h) => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23,
      )
    ) {
      return NextResponse.json(
        { error: "run_at_hours must be a non-empty array of integers 0-23" },
        { status: 400 },
      );
    }
    const VALID_TIMEZONES = ["UTC", "EST", "PST", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"];
    if (
      typeof body.timezone !== "string" ||
      body.timezone.length === 0 ||
      !VALID_TIMEZONES.includes(body.timezone)
    ) {
      return NextResponse.json(
        { error: `timezone must be one of: ${VALID_TIMEZONES.join(", ")}` },
        { status: 400 },
      );
    }
    await writeSchedulerConfig({
      enabled: body.enabled,
      run_at_hours: [...new Set(body.run_at_hours)].sort((a, b) => a - b),
      timezone: body.timezone,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/scheduler] write error:", error);
    return NextResponse.json(
      { error: "Failed to update scheduler config" },
      { status: 500 },
    );
  }
}
