import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  // With MongoDB reads, no in-memory caches to flush.
  // Revalidate the Next.js page cache so subsequent renders fetch fresh data.
  revalidatePath("/");
  return NextResponse.json({ flushed: true });
}
