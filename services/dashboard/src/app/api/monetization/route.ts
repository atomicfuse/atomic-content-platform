import { NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import { listNetworkDirectory, readFileContent } from "@/lib/github";

/**
 * GET /api/monetization
 * Returns the list of monetization profiles (one per `monetization/<id>.yaml`).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const entries = await listNetworkDirectory("monetization");
    const yamlFiles = entries.filter(
      (e) => e.type === "file" && e.name.endsWith(".yaml"),
    );

    const results = await Promise.allSettled(
      yamlFiles.map(async (file) => {
        const content = await readFileContent(file.path);
        if (content === null) return null;
        const parsed = (parseYaml(content) ?? {}) as Record<string, unknown>;
        return {
          monetization_id: file.name.replace(/\.yaml$/, ""),
          ...parsed,
        };
      }),
    );

    const profiles: Record<string, unknown>[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        profiles.push(r.value);
      }
    }

    return NextResponse.json(profiles);
  } catch (error) {
    console.error("[api/monetization] list error:", error);
    return NextResponse.json(
      { error: "Failed to list monetization profiles" },
      { status: 500 },
    );
  }
}
