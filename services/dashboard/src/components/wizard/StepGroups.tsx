"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface GroupSummary {
  group_id: string;
  name: string;
  ads_config?: { primary_advertiser?: string; layout?: string };
}

interface MonetizationSummary {
  monetization_id: string;
  name?: string;
  provider?: string;
  ads_config?: { layout?: string; ad_placements?: unknown[] };
  tracking?: Record<string, unknown>;
}

interface OrgConfig {
  default_monetization?: string;
  [key: string]: unknown;
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
  const [availableMonetization, setAvailableMonetization] = useState<
    MonetizationSummary[]
  >([]);
  const [orgDefaultMonetization, setOrgDefaultMonetization] = useState<
    string | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll(): Promise<void> {
      try {
        const [groupsRes, monRes, orgRes] = await Promise.all([
          fetch("/api/groups"),
          fetch("/api/monetization"),
          fetch("/api/settings/org"),
        ]);
        if (groupsRes.ok) {
          setAvailableGroups((await groupsRes.json()) as GroupSummary[]);
        }
        if (monRes.ok) {
          setAvailableMonetization(
            (await monRes.json()) as MonetizationSummary[],
          );
        }
        if (orgRes.ok) {
          const org = (await orgRes.json()) as OrgConfig;
          setOrgDefaultMonetization(org.default_monetization);
        }
      } catch {
        // Best effort — allow manual entry if APIs unavailable
      } finally {
        setLoading(false);
      }
    }
    void fetchAll();
  }, []);

  const selectedMonetization = data.monetization
    ? availableMonetization.find(
        (m) => m.monetization_id === data.monetization,
      )
    : orgDefaultMonetization
      ? availableMonetization.find(
          (m) => m.monetization_id === orgDefaultMonetization,
        )
      : undefined;
  const monetizationIsInherited = !data.monetization && !!orgDefaultMonetization;

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
        <h2 className="text-xl font-semibold">Group &amp; Monetization</h2>
        <p className="mt-1 text-sm text-gray-500">
          Pick the editorial group(s) for theme + legal defaults, and the
          monetization profile that supplies tracking, ad placements, and
          ads.txt.
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

      <div className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Monetization Profile
          </h3>
          {monetizationIsInherited && (
            <span className="text-xs text-gray-400">
              Inherited from org default
            </span>
          )}
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading monetization profiles...</p>
        ) : availableMonetization.length === 0 ? (
          <p className="text-sm text-gray-400">
            No monetization profiles found. Create one in /monetization first.
          </p>
        ) : (
          <select
            value={data.monetization ?? ""}
            onChange={(e): void =>
              onChange({ monetization: e.target.value || undefined })
            }
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          >
            <option value="">
              {orgDefaultMonetization
                ? `— Use org default (${orgDefaultMonetization}) —`
                : "— No monetization —"}
            </option>
            {availableMonetization.map((m) => (
              <option key={m.monetization_id} value={m.monetization_id}>
                {m.name ?? m.monetization_id}
                {m.provider ? ` · ${m.provider}` : ""}
              </option>
            ))}
          </select>
        )}

        {selectedMonetization && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
            <div className="font-semibold text-gray-700 dark:text-gray-200">
              What this site inherits:
            </div>
            <ul className="mt-1 space-y-0.5">
              {selectedMonetization.provider && (
                <li>Provider: {selectedMonetization.provider}</li>
              )}
              {selectedMonetization.ads_config?.layout && (
                <li>Layout: {selectedMonetization.ads_config.layout}</li>
              )}
              <li>
                Placements:{" "}
                {Array.isArray(selectedMonetization.ads_config?.ad_placements)
                  ? selectedMonetization.ads_config!.ad_placements!.length
                  : 0}
              </li>
            </ul>
          </div>
        )}
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
