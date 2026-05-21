"use client";

import { useState, useRef, useCallback } from "react";

interface ArticleEditorProps {
  domain: string;
  slug: string;
  branch: string | null;
  initialContent: string;
  title: string;
  featuredImage?: string;
}

/** Split raw article markdown into { frontmatter, body }. */
function splitContent(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: raw };
  return { frontmatter: match[1]!, body: match[2]! };
}

/** Rebuild raw markdown from frontmatter block + body. */
function joinContent(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

/** Replace or add a frontmatter field value. */
function setFrontmatterField(fm: string, field: string, value: string): string {
  const regex = new RegExp(`^${field}:.*$`, "m");
  if (regex.test(fm)) {
    return fm.replace(regex, `${field}: "${value.replace(/"/g, '\\"')}"`);
  }
  return `${fm}\n${field}: "${value.replace(/"/g, '\\"')}"`;
}

export function ArticleEditor({
  domain,
  slug,
  branch,
  initialContent,
  title: initialTitle,
  featuredImage,
}: ArticleEditorProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const { body: initialBody } = splitContent(initialContent);
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [currentImage, setCurrentImage] = useState(featuredImage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      // Rebuild full markdown: update title in frontmatter, keep body
      const { frontmatter } = splitContent(initialContent);
      const updatedFm = setFrontmatterField(frontmatter, "title", title);
      const content = joinContent(updatedFm, body);
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, branch: branch ?? undefined }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Article saved successfully" });
        setEditing(false);
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error ?? "Save failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [title, body, initialContent, domain, slug, branch]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      if (branch) formData.append("branch", branch);
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/image`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentImage(data.imagePath);
        setMessage({ type: "success", text: "Image replaced successfully" });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error ?? "Upload failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Upload failed" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [domain, slug, branch]);

  const handleGenerateImage = useCallback(async (): Promise<void> => {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agent/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, slug, title, branch: branch ?? undefined }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Image generation triggered — may take ~1 minute" });
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: `Failed to trigger image generation: ${(err as { error?: string }).error ?? "unknown error"}` });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to trigger image generation" });
    } finally {
      setGenerating(false);
    }
  }, [domain, slug, title, branch]);

  return (
    <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Article Content</h2>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={(): void => setEditing(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--primary)] text-white hover:opacity-90"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Image section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">
            Featured Image: {currentImage ? <code className="text-[var(--text-secondary)]">{currentImage}</code> : <span className="italic">None</span>}
          </span>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e): void => { void handleImageUpload(e); }}
            />
            <button
              onClick={(): void => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--card-bg)] disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Replace Image"}
            </button>
            <button
              onClick={(): void => { void handleGenerateImage(); }}
              disabled={generating}
              className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--card-bg)] disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate AI Image"}
            </button>
          </div>
        </div>
      </div>

      {/* Toast message */}
      {message && (
        <div className={`text-xs px-3 py-2 rounded ${
          message.type === "success"
            ? "bg-green-500/10 text-green-400"
            : "bg-red-500/10 text-red-400"
        }`}>
          {message.text}
        </div>
      )}

      {/* Article editor / read-only preview */}
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e): void => setTitle(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Content (Markdown)</label>
            <textarea
              value={body}
              onChange={(e): void => setBody(e.target.value)}
              className="w-full h-[500px] p-4 rounded-lg bg-[var(--card-bg)] border border-[var(--border-primary)] text-[var(--text-primary)] font-mono text-sm resize-y focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(): void => { void handleSave(); }}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={(): void => { setEditing(false); setTitle(initialTitle); setBody(initialBody); setMessage(null); }}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--card-bg)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <pre className="w-full max-h-[400px] overflow-auto p-4 rounded-lg bg-[var(--card-bg)] border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm font-mono whitespace-pre-wrap">
          {body}
        </pre>
      )}
    </div>
  );
}
