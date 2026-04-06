"use client";

import { useState, useTransition } from "react";
import type { DeletedSiteEntry } from "@/types/dashboard";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { restoreSiteEntry, permanentlyDeleteSite } from "@/actions/sites";

interface TrashListProps {
  items: DeletedSiteEntry[];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TrashList({ items }: TrashListProps): React.ReactElement {
  const { toast } = useToast();
  const [restorePending, startRestoreTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [actionDomain, setActionDomain] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeletedSiteEntry | null>(null);

  function handleRestore(domain: string): void {
    setActionDomain(domain);
    startRestoreTransition(async () => {
      try {
        await restoreSiteEntry(domain);
        toast(`Restored ${domain} to dashboard`, "success");
      } catch (error) {
        toast(error instanceof Error ? error.message : "Failed to restore", "error");
      } finally {
        setActionDomain(null);
      }
    });
  }

  function handlePermanentDelete(): void {
    if (!deleteTarget) return;
    const domain = deleteTarget.domain;
    setActionDomain(domain);
    startDeleteTransition(async () => {
      try {
        await permanentlyDeleteSite(domain);
        toast(`Permanently deleted ${domain} and all site files`, "success");
        setDeleteTarget(null);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Failed to delete", "error");
      } finally {
        setActionDomain(null);
      }
    });
  }

  return (
    <>
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-secondary)]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Domain
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Company
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Vertical
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Last Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Deleted At
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.domain}
                  className="border-b border-[var(--border-secondary)] last:border-b-0"
                >
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    {item.domain}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {item.company}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {item.vertical}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {formatDate(item.deleted_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(): void => handleRestore(item.domain)}
                        loading={restorePending && actionDomain === item.domain}
                        disabled={restorePending || deletePending}
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                        </svg>
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(): void => setDeleteTarget(item)}
                        disabled={restorePending || deletePending}
                        className="!text-red-400 hover:!text-red-300"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                        Delete Forever
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permanent delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={(): void => setDeleteTarget(null)}
        title="Permanently Delete Domain"
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-medium">
                  Are you sure you want to permanently delete{" "}
                  <strong>{deleteTarget.domain}</strong>?
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-2">
                  This action will:
                </p>
                <ul className="text-sm text-[var(--text-muted)] mt-1 list-disc list-inside space-y-1">
                  <li>
                    Delete all site files from Git{" "}
                    <span className="text-[var(--text-secondary)]">
                      (site.yaml, skill.md, articles, assets)
                    </span>
                  </li>
                  <li>Remove the domain from the dashboard entirely</li>
                  <li>
                    <strong className="text-red-400">
                      This cannot be undone
                    </strong>{" "}
                    (except via Git history)
                  </li>
                </ul>
                <p className="text-sm text-[var(--text-muted)] mt-2">
                  Note: This does <strong className="text-[var(--text-secondary)]">not</strong>{" "}
                  delete the Cloudflare zone or DNS records.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
              <Button variant="ghost" onClick={(): void => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                onClick={handlePermanentDelete}
                loading={deletePending && actionDomain === deleteTarget.domain}
                className="!bg-red-500 hover:!bg-red-600 !text-white"
              >
                Delete Forever
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
