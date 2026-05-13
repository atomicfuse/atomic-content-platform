"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

/** Mirrors @atomic-platform/shared-types ArticleScript */
type ArticleScriptPosition =
  | "head"
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

interface ArticleScript {
  id: string;
  name: string;
  position: ArticleScriptPosition;
  content: string;
}

interface ArticleScriptsPanelProps {
  domain: string;
  slug: string;
  stagingBranch: string | null;
  initialScripts: ArticleScript[];
}

type FormMode = { kind: "closed" } | { kind: "add" } | { kind: "edit"; id: string };

const POSITION_OPTIONS = [
  { value: "head", label: "Page Head" },
  { value: "before-content", label: "Before Article" },
  { value: "after-content", label: "After Article" },
  { value: "after-paragraph", label: "After Paragraph..." },
] as const;

function positionLabel(pos: string): string {
  if (pos === "head") return "Head";
  if (pos === "before-content") return "Before Article";
  if (pos === "after-content") return "After Article";
  const match = /^after-paragraph-(\d+)$/.exec(pos);
  if (match) return `After Paragraph ${match[1]}`;
  return pos;
}

function positionColor(pos: string): string {
  if (pos === "head") return "bg-cyan/10 text-cyan";
  if (pos === "before-content" || pos === "after-content") return "bg-violet-500/10 text-violet-400";
  return "bg-amber-500/10 text-amber-400";
}

export function ArticleScriptsPanel({
  domain,
  slug,
  stagingBranch,
  initialScripts,
}: ArticleScriptsPanelProps): React.ReactElement {
  const [scripts, setScripts] = useState<ArticleScript[]>(initialScripts);
  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formPositionType, setFormPositionType] = useState("head");
  const [formParagraphN, setFormParagraphN] = useState(1);
  const [formContent, setFormContent] = useState("");

  const { toast } = useToast();

  const resolvedPosition = formPositionType === "after-paragraph"
    ? `after-paragraph-${formParagraphN}`
    : formPositionType;

  const resetForm = useCallback((): void => {
    setFormName("");
    setFormPositionType("head");
    setFormParagraphN(1);
    setFormContent("");
    setFormMode({ kind: "closed" });
  }, []);

  const openAdd = useCallback((): void => {
    resetForm();
    setFormMode({ kind: "add" });
  }, [resetForm]);

  const openEdit = useCallback((script: ArticleScript): void => {
    setFormName(script.name);
    setFormContent(script.content);
    const pMatch = /^after-paragraph-(\d+)$/.exec(script.position);
    if (pMatch) {
      setFormPositionType("after-paragraph");
      setFormParagraphN(Number.parseInt(pMatch[1]!, 10));
    } else {
      setFormPositionType(script.position);
    }
    setFormMode({ kind: "edit", id: script.id });
  }, []);

  const saveScripts = useCallback(async (updated: ArticleScript[]): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/scripts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripts: updated }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.details
          ? `${data.error}: ${(data.details as string[]).join(", ")}`
          : data.error ?? "Save failed";
        toast(msg, "error");
        return false;
      }
      setScripts(updated);
      toast("Scripts saved", "success");
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [domain, slug, toast]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!formName.trim() || !formContent.trim()) return;

    const entry: ArticleScript = {
      id: formMode.kind === "edit" ? formMode.id : crypto.randomUUID(),
      name: formName.trim(),
      position: resolvedPosition as ArticleScriptPosition,
      content: formContent,
    };

    let updated: ArticleScript[];
    if (formMode.kind === "edit") {
      updated = scripts.map((s) => (s.id === formMode.id ? entry : s));
    } else {
      updated = [...scripts, entry];
    }

    const ok = await saveScripts(updated);
    if (ok) resetForm();
  }, [formName, formContent, resolvedPosition, formMode, scripts, saveScripts, resetForm]);

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    const updated = scripts.filter((s) => s.id !== id);
    await saveScripts(updated);
  }, [scripts, saveScripts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Scripts</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Inject tracking, widgets, or other scripts into this article
          </p>
        </div>
        {formMode.kind === "closed" && (
          <Button variant="ghost" size="sm" onClick={openAdd}>
            + Add Script
          </Button>
        )}
      </div>

      {/* Scripts list */}
      {scripts.length === 0 && formMode.kind === "closed" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No scripts attached to this article.
          </p>
          <Button variant="ghost" size="sm" onClick={openAdd} className="mt-2">
            + Add Script
          </Button>
        </div>
      )}

      {scripts.length > 0 && (
        <div className="space-y-2">
          {scripts.map((s) => (
            <div
              key={s.id}
              className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${positionColor(s.position)}`}>
                    {positionLabel(s.position)}
                  </span>
                </div>
                <pre className="text-xs text-[var(--text-muted)] mt-1 truncate font-mono max-w-md">
                  {s.content.slice(0, 80)}{s.content.length > 80 ? "..." : ""}
                </pre>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(): void => openEdit(s)}
                  disabled={saving}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(): void => { void handleDelete(s.id); }}
                  disabled={saving}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {formMode.kind !== "closed" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-cyan/20 p-6 space-y-4">
          <h4 className="text-sm font-semibold">
            {formMode.kind === "add" ? "Add Script" : "Edit Script"}
          </h4>

          <Input
            label="Name"
            value={formName}
            onChange={(e): void => setFormName(e.target.value)}
            placeholder="e.g. Campaign Pixel, Quiz Widget"
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

          <div>
            <label className="block text-sm font-medium mb-1.5">Script Content</label>
            <textarea
              value={formContent}
              onChange={(e): void => setFormContent(e.target.value)}
              placeholder={'<script src="https://example.com/widget.js"></script>'}
              disabled={saving}
              rows={6}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono resize-y"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={(): void => { void handleSave(); }}
              disabled={saving || !formName.trim() || !formContent.trim()}
            >
              {saving ? "Saving..." : "Save Script"}
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
