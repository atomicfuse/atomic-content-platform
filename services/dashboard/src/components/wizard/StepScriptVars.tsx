"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface StepScriptVarsProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Wizard step that detects required {{placeholder}} variables from the selected
 * groups' scripts and lets the user fill them in.
 */
export function StepScriptVars({
  data,
  onChange,
  onNext,
  onBack,
}: StepScriptVarsProps): React.ReactElement {
  const [requiredKeys, setRequiredKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch group scripts and detect required placeholders
  useEffect(() => {
    if (data.groups.length === 0) {
      setRequiredKeys([]);
      return;
    }

    async function detectVars(): Promise<void> {
      setLoading(true);
      const allPlaceholders = new Set<string>();

      for (const groupId of data.groups) {
        try {
          const res = await fetch(`/api/groups/${groupId}`);
          if (!res.ok) continue;
          const group = await res.json();

          // Scan scripts for {{placeholder}} patterns
          const scriptsJson = JSON.stringify(group.scripts ?? {});
          const matches = scriptsJson.matchAll(/\{\{(\w+)\}\}/g);
          for (const match of matches) {
            allPlaceholders.add(match[1]);
          }
        } catch {
          // Skip group if fetch fails
        }
      }

      // Remove "domain" — it's auto-resolved
      allPlaceholders.delete("domain");
      setRequiredKeys([...allPlaceholders].sort());
      setLoading(false);
    }

    void detectVars();
  }, [data.groups]);

  function updateVar(key: string, value: string): void {
    onChange({ scriptsVars: { ...data.scriptsVars, [key]: value } });
  }

  const missingKeys = requiredKeys.filter(
    (k) => !data.scriptsVars[k]?.trim(),
  );

  if (data.groups.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Script Variables</h2>
          <p className="mt-1 text-sm text-gray-500">
            No groups selected — no script variables required.
          </p>
        </div>
        <div className="flex justify-between pt-4">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext}>Next</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Script Variables</h2>
        <p className="mt-1 text-sm text-gray-500">
          These variables are used as{" "}
          <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">
            {"{{key}}"}
          </code>{" "}
          placeholders in the selected groups&apos; scripts. Fill in the
          site-specific values.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Detecting required variables...</p>
      ) : requiredKeys.length === 0 ? (
        <p className="text-sm text-gray-500">
          No script variables required by the selected groups.
        </p>
      ) : (
        <div className="space-y-3">
          {requiredKeys.map((key) => (
            <div key={key}>
              <label
                htmlFor={`var-${key}`}
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {key}
                <span className="ml-1 text-red-500">*</span>
              </label>
              <input
                id={`var-${key}`}
                type="text"
                value={data.scriptsVars[key] ?? ""}
                onChange={(e): void => updateVar(key, e.target.value)}
                placeholder={`Value for {{${key}}}`}
                className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                  !data.scriptsVars[key]?.trim()
                    ? "border-red-300 dark:border-red-700"
                    : "border-gray-300 dark:border-gray-600"
                } bg-white dark:bg-gray-900`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          {missingKeys.length > 0
            ? `Next (${missingKeys.length} unfilled)`
            : "Next"}
        </Button>
      </div>
    </div>
  );
}
