import { NextResponse } from "next/server";
import { flushAllCaches } from "@/lib/github";

export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  flushAllCaches();
  return NextResponse.json({ flushed: true });
}
