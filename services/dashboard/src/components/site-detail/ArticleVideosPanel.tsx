"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

type ArticleVideoPosition =
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

interface ArticleVideo {
  id: string;
  url: string;
  position: ArticleVideoPosition;
}

interface ArticleVideosPanelProps {
  domain: string;
  slug: string;
  stagingBranch: string | null;
  initialVideos: ArticleVideo[];
}

type FormMode = { kind: "closed" } | { kind: "add" } | { kind: "edit"; id: string };

const POSITION_OPTIONS = [
  { value: "before-content", label: "Before Article" },
  { value: "after-content", label: "After Article" },
  { value: "after-paragraph", label: "After Paragraph..." },
] as const;

function positionLabel(pos: string): string {
  if (pos === "before-content") return "Before Article";
  if (pos === "after-content") return "After Article";
  const match = /^after-paragraph-(\d+)$/.exec(pos);
  if (match) return `After Paragraph ${match[1]}`;
  return pos;
}

function positionColor(pos: string): string {
  if (pos === "before-content" || pos === "after-content") return "bg-violet-500/10 text-violet-400";
  return "bg-amber-500/10 text-amber-400";
}

function extractYouTubeThumbnail(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let videoId: string | null = null;

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      videoId = u.searchParams.get("v");
      if (!videoId) {
        const embedMatch = /^\/embed\/([a-zA-Z0-9_-]+)/.exec(u.pathname);
        if (embedMatch) videoId = embedMatch[1]!;
      }
    } else if (host === "youtu.be") {
      videoId = u.pathname.slice(1).split("/")[0] ?? null;
    }

    return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
  } catch {
    return null;
  }
}

export function ArticleVideosPanel({
  domain,
  slug,
  stagingBranch,
  initialVideos,
}: ArticleVideosPanelProps): React.ReactElement {
  const [videos, setVideos] = useState<ArticleVideo[]>(initialVideos);
  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [saving, setSaving] = useState(false);

  // Form state
  const [formUrl, setFormUrl] = useState("");
  const [formPositionType, setFormPositionType] = useState("after-paragraph");
  const [formParagraphN, setFormParagraphN] = useState(1);

  const { toast } = useToast();

  const resolvedPosition = formPositionType === "after-paragraph"
    ? `after-paragraph-${formParagraphN}`
    : formPositionType;

  const resetForm = useCallback((): void => {
    setFormUrl("");
    setFormPositionType("after-paragraph");
    setFormParagraphN(1);
    setFormMode({ kind: "closed" });
  }, []);

  const openAdd = useCallback((): void => {
    resetForm();
    setFormMode({ kind: "add" });
  }, [resetForm]);

  const openEdit = useCallback((video: ArticleVideo): void => {
    setFormUrl(video.url);
    const pMatch = /^after-paragraph-(\d+)$/.exec(video.position);
    if (pMatch) {
      setFormPositionType("after-paragraph");
      setFormParagraphN(Number.parseInt(pMatch[1]!, 10));
    } else {
      setFormPositionType(video.position);
    }
    setFormMode({ kind: "edit", id: video.id });
  }, []);

  const saveVideos = useCallback(async (updated: ArticleVideo[]): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/videos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: updated }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.details
          ? `${data.error}: ${(data.details as string[]).join(", ")}`
          : data.error ?? "Save failed";
        toast(msg, "error");
        return false;
      }
      setVideos(updated);
      toast("Videos saved", "success");
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [domain, slug, toast]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!formUrl.trim()) return;

    const entry: ArticleVideo = {
      id: formMode.kind === "edit" ? formMode.id : crypto.randomUUID(),
      url: formUrl.trim(),
      position: resolvedPosition as ArticleVideoPosition,
    };

    let updated: ArticleVideo[];
    if (formMode.kind === "edit") {
      updated = videos.map((v) => (v.id === formMode.id ? entry : v));
    } else {
      updated = [...videos, entry];
    }

    const ok = await saveVideos(updated);
    if (ok) resetForm();
  }, [formUrl, resolvedPosition, formMode, videos, saveVideos, resetForm]);

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    const updated = videos.filter((v) => v.id !== id);
    await saveVideos(updated);
  }, [videos, saveVideos]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Videos</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Embed YouTube videos into this article
          </p>
        </div>
        {formMode.kind === "closed" && (
          <Button variant="ghost" size="sm" onClick={openAdd}>
            + Add Video
          </Button>
        )}
      </div>

      {/* Videos list */}
      {videos.length === 0 && formMode.kind === "closed" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No videos embedded in this article.
          </p>
          <Button variant="ghost" size="sm" onClick={openAdd} className="mt-2">
            + Add Video
          </Button>
        </div>
      )}

      {videos.length > 0 && (
        <div className="space-y-2">
          {videos.map((v) => {
            const thumb = extractYouTubeThumbnail(v.url);
            return (
              <div
                key={v.id}
                className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1 flex items-start gap-3">
                  {thumb && (
                    <img
                      src={thumb}
                      alt="Video thumbnail"
                      className="w-24 h-auto rounded shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${positionColor(v.position)}`}>
                        {positionLabel(v.position)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1 truncate font-mono max-w-md">
                      {v.url}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(): void => openEdit(v)}
                    disabled={saving}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(): void => { void handleDelete(v.id); }}
                    disabled={saving}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit form */}
      {formMode.kind !== "closed" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-cyan/20 p-6 space-y-4">
          <h4 className="text-sm font-semibold">
            {formMode.kind === "add" ? "Add Video" : "Edit Video"}
          </h4>

          <Input
            label="YouTube URL"
            value={formUrl}
            onChange={(e): void => setFormUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={saving}
          />

          <div>
            <label className="block text-sm font-medium mb-1.5">Position</label>
            <select
              value={formPositionType}
              onChange={(e): void => setFormPositionType(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
            >
              {POSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {formPositionType === "after-paragraph" && (
            <Input
              label="Paragraph Number"
              type="number"
              min={1}
              value={formParagraphN}
              onChange={(e): void => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1) setFormParagraphN(val);
              }}
              disabled={saving}
              className="w-24"
            />
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={(): void => { void handleSave(); }}
              disabled={saving || !formUrl.trim()}
            >
              {saving ? "Saving..." : "Save Video"}
            </Button>
            <Button variant="ghost" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
