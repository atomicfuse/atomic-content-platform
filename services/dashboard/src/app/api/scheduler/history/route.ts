import { NextResponse } from "next/server";
import { readFileContent } from "@/lib/github";
import { NETWORK_REPO_OWNER, NETWORK_REPO_NAME } from "@/lib/constants";

const HISTORY_PATH = "scheduler/history.json";

export async function GET(): Promise<NextResponse> {
  try {
    // Use the custom-repo overload to bypass the in-memory tree cache
    // (TREE_CACHE_TTL = Infinity). The scheduler writes history.json from
    // the content-pipeline, so the dashboard's cached tree has a stale SHA.
    const raw = await readFileContent(HISTORY_PATH, "main", {
      owner: NETWORK_REPO_OWNER,
      name: NETWORK_REPO_NAME,
    });
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
