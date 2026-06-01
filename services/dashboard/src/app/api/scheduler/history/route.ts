import { NextResponse } from "next/server";
import { readFileContent } from "@/lib/github";

const HISTORY_PATH = "scheduler/history.json";

export async function GET(): Promise<NextResponse> {
  try {
    const raw = await readFileContent(HISTORY_PATH, "main");
    if (raw === null) {
      return NextResponse.json([]);
    }
    const entries = JSON.parse(raw) as unknown[];
    return NextResponse.json(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to read scheduler history: ${message}` },
      { status: 500 },
    );
  }
}
