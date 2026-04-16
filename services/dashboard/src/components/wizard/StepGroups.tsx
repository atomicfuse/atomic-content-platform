"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface GroupSummary {
  group_id: string;
  name: string;
  ads_config?: { primary_advertiser?: string; layout?: string };
}

interface StepGroupsProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepGroups({
  data,
  onChange,
  onNext,
  onBack,
}: StepGroupsProps): React.ReactElement {
  const [availableGroups, setAvailableGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll(): Promise<void> {
      try {
        const groupsRes = await fetch("/api/groups");
        if (groupsRes.ok) {
          setAvailableGroups((await groupsRes.json()) as GroupSummary[]);
        }
      } catch {
        // Best effort — allow manual entry if APIs unavailable
      } finally {
        setLoading(false);
      }
    }
    void fetchAll();
  }, []);

  function toggleGroup(groupId: string): void {
    const current = data.groups;
    if (current.includes(groupId)) {
      onChange({ groups: current.filter((g) => g !== groupId) });
    } else {
      onChange({ groups: [...current, groupId] });
    }
  }

  function moveGroup(index: number, direction: -1 | 1): void {
    const newGroups = [...data.groups];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newGroups.length) return;
    [newGroups[index], newGroups[targetIndex]] = [
      newGroups[targetIndex],
      newGroups[index],
    ];
    onChange({ groups: newGroups });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Select Groups</h2>
        <p className="mt-1 text-sm text-gray-500">
          Pick the config groups for this site. Groups supply theme, tracking,
          ad placements, scripts, and legal defaults. Merged left-to-right
          (last group wins conflicts).
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading groups...</p>
      ) : availableGroups.length === 0 ? (
        <p className="text-sm text-gray-400">
          No groups found. You can create groups later in the Groups management
          page.
        </p>
      ) : (
        <div className="space-y-2">
          {availableGroups.map((group) => {
            const selected = data.groups.includes(group.group_id);
            return (
              <button
                key={group.group_id}
                type="button"
                onClick={(): void => toggleGroup(group.group_id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{group.name}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {group.group_id}
                    </span>
                  </div>
                  {selected && (
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      Selected
                    </span>
                  )}
                </div>
                {group.ads_config?.primary_advertiser && (
                  <p className="mt-1 text-xs text-gray-500">
                    Ad network: {group.ads_config.primary_advertiser}
                    {group.ads_config.layout
                      ? ` \u00B7 Layout: ${group.ads_config.layout}`
                      : ""}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {data.groups.length > 1 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Merge order (drag to reorder):
          </p>
          {data.groups.map((groupId, idx) => (
            <div
              key={groupId}
              className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 dark:border-gray-700"
            >
              <span className="text-xs text-gray-400">{idx + 1}.</span>
              <span className="flex-1 text-sm">{groupId}</span>
              <button
                type="button"
                disabled={idx === 0}
                onClick={(): void => moveGroup(idx, -1)}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                &uarr;
              </button>
              <button
                type="button"
                disabled={idx === data.groups.length - 1}
                onClick={(): void => moveGroup(idx, 1)}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                &darr;
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
