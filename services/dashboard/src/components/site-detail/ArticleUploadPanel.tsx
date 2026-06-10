// services/dashboard/src/components/site-detail/ArticleUploadPanel.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface ArticleUploadPanelProps {
  domain: string;
  stagingBranch: string | null;
}

interface ParsedPreview {
  title: string;
  slug: string;
  status: string;
  tags: string[];
  description: string;
  hasBody: boolean;
  wordCount: number;
}

type UploadState = "idle" | "uploading" | "success" | "error";

/** Client-side preview only — uses simple regex extraction for common
 *  single-line YAML values. Multi-line values and inline arrays won't parse.
 *  The server does full YAML parsing via the `yaml` package. */
function parsePreview(text: string): ParsedPreview | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const yaml = match[1] ?? "";
  const body = match[2] ?? "";

  const get = (key: string): string => {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1]!.replace(/^["']|["']$/g, "").trim() : "";
  };

  const tagsMatch = yaml.match(/^tags:\s*\n((?:\s+-\s+.+\n?)*)/m);
  const tags = tagsMatch
    ? tagsMatch[1]!.split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean)
    : [];

  const wordCount = body.split(/\s+/).filter(Boolean).length;

  return {
    title: get("title"),
    slug: get("slug"),
    status: get("status") || "draft",
    tags,
    description: get("description"),
    hasBody: body.trim().length > 0,
    wordCount,
  };
}

export function ArticleUploadPanel({
  domain,
  stagingBranch,
}: ArticleUploadPanelProps): React.ReactElement {
  const [mdFile, setMdFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [result, setResult] = useState<{
    slug: string;
    path: string;
    imagePath: string | null;
    warnings: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mdInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleMdSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setMdFile(file);
    setPreview(null);
    setParseError(null);
    setResult(null);
    setErrorMsg(null);
    setUploadState("idle");

    if (!file) return;

    if (!file.name.endsWith(".md")) {
      setParseError("File must be a .md markdown file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev): void => {
      const text = ev.target?.result as string;
      const parsed = parsePreview(text);
      if (!parsed) {
        setParseError("Could not parse frontmatter. File must start with --- delimiters.");
        return;
      }
      if (!parsed.title && !parsed.slug) {
        setParseError("Frontmatter must contain at least a title and slug field.");
        return;
      }
      setPreview(parsed);
    };
    reader.readAsText(file);
  }, []);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setImageFile(e.target.files?.[0] ?? null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!mdFile) return;

    setUploadState("uploading");
    setErrorMsg(null);

    const form = new FormData();
    form.append("markdown", mdFile);
    form.append("domain", domain);
    if (stagingBranch) form.append("branch", stagingBranch);
    if (imageFile) form.append("image", imageFile);

    try {
      const res = await fetch("/api/articles/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        const msg = data.details
          ? `${data.error}: ${(data.details as string[]).join(", ")}`
          : data.error ?? "Upload failed";
        setUploadState("error");
        setErrorMsg(msg);
        toast(msg, "error");
        return;
      }

      setUploadState("success");
      setResult({
        slug: data.slug,
        path: data.path,
        imagePath: data.imagePath,
        warnings: data.warnings ?? [],
      });
      toast(`Article "${preview?.title || data.slug}" uploaded`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadState("error");
      setErrorMsg(msg);
      toast(msg, "error");
    }
  }, [mdFile, imageFile, domain, stagingBranch, preview, toast]);

  const handleReset = useCallback(() => {
    setMdFile(null);
    setImageFile(null);
    setPreview(null);
    setParseError(null);
    setResult(null);
    setErrorMsg(null);
    setUploadState("idle");
    if (mdInputRef.current) mdInputRef.current.value = "";
    if (imgInputRef.current) imgInputRef.current.value = "";
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Upload Article</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Upload a markdown file with a featured image as an article
          </p>
        </div>
        {(mdFile || result) && (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Clear
          </Button>
        )}
      </div>

      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
        {/* Markdown file picker */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Markdown File</label>
          <input
            ref={mdInputRef}
            type="file"
            accept=".md"
            onChange={handleMdSelect}
            disabled={uploadState === "uploading"}
            className="block text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-cyan/10 file:text-cyan hover:file:bg-cyan/20 disabled:opacity-50"
          />
          {parseError && (
            <p className="text-xs text-red-400 mt-1">{parseError}</p>
          )}
        </div>

        {/* Frontmatter preview */}
        {preview && (
          <div className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border-secondary)] p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{preview.title || "(no title)"}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                preview.status === "approved" || preview.status === "published"
                  ? "bg-green-500/10 text-green-400"
                  : preview.status === "review"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-zinc-500/10 text-zinc-400"
              }`}>
                {preview.status === "published" || preview.status === "approved" ? "Approved" : preview.status}
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <div>Slug: <code className="text-cyan">{preview.slug || "(missing)"}</code></div>
              {preview.description && <div>Description: {preview.description}</div>}
              <div>Body: {preview.wordCount.toLocaleString()} words</div>
              {preview.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {preview.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Image file picker */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Featured Image <span className="text-red-400 font-normal">*</span>
          </label>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleImageSelect}
            disabled={uploadState === "uploading"}
            className="block text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-500/10 file:text-violet-400 hover:file:bg-violet-500/20 disabled:opacity-50"
          />
          {imageFile && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>

        {/* Upload button */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleUpload}
            disabled={!mdFile || !preview || !imageFile || uploadState === "uploading"}
          >
            {uploadState === "uploading" ? (
              <>
                <svg className="w-4 h-4 mr-2 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Upload Article{imageFile ? " + Image" : ""}
              </>
            )}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            Commits to{" "}
            <code className="text-cyan text-[10px]">
              {stagingBranch ?? `staging/${domain}`}
            </code>
          </p>
        </div>

        {/* Error */}
        {uploadState === "error" && errorMsg && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {errorMsg}
          </div>
        )}

        {/* Success */}
        {uploadState === "success" && result && (
          <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Article uploaded
            </div>
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <div>Path: <code className="text-cyan">{result.path}</code></div>
              {result.imagePath && <div>Image: <code className="text-violet-400">{result.imagePath}</code></div>}
              {result.warnings.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="text-amber-400">Warning: {w}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
