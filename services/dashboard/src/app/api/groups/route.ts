import { NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import { listNetworkDirectory, readFileContent } from "@/lib/github";

export async function GET(): Promise<NextResponse> {
  try {
    const entries = await listNetworkDirectory("groups");
    const yamlFiles = entries.filter(
      (e) => e.type === "file" && e.name.endsWith(".yaml"),
    );

    const results = await Promise.allSettled(
      yamlFiles.map(async (file) => {
        const content = await readFileContent(file.path);
        if (content === null) return null;
        const parsed = parseYaml(content) as Record<string, unknown>;
        return { id: file.name.replace(/\.yaml$/, ""), ...parsed };
      }),
    );

    const groups: Record<string, unknown>[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        groups.push(r.value);
      }
    }

    return NextResponse.json(groups);
  } catch (error) {
    console.error("[api/groups] list error:", error);
    return NextResponse.json(
      { error: "Failed to list groups" },
      { status: 500 },
    );
  }
}
