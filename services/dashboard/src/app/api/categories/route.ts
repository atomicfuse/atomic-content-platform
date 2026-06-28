import { NextRequest, NextResponse } from "next/server";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects CONTENT_AGGREGATOR_URL
// as a platform read-only env pointing to a stale entity URL.
const AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const parentId = searchParams.get("parent_id") ?? "";
    const ids = searchParams.get("ids") ?? "";
    // page_size capped at the documented aggregator max of 100. Callers paginate
    // (page=N) to walk the full taxonomy — requesting 500 here previously risked
    // an upstream 400 / oversized response that silently became an empty list.
    const pageSizeRaw = parseInt(searchParams.get("page_size") ?? "100", 10);
    const pageSize = Math.min(Number.isFinite(pageSizeRaw) ? pageSizeRaw : 100, 100);
    const page = searchParams.get("page") ?? "1";

    const qs = new URLSearchParams();
    if (ids) {
      // id-resolution mode: resolve exact ids regardless of active state.
      qs.set("ids", ids);
    } else {
      if (parentId) qs.set("parent_id", parentId);
      qs.set("active", searchParams.get("active") ?? "true");
    }
    qs.set("page", page);
    qs.set("page_size", String(pageSize));

    const url = `${AGGREGATOR_URL}/api/categories?${qs.toString()}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`[categories] ${res.status} from ${url}`);
      return NextResponse.json({ items: [] }, { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (error) {
    console.error("[categories] error:", error);
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}
