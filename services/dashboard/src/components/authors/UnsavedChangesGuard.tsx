"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/** While `when` is true: closing the tab asks (beforeunload) and in-app link clicks open a confirm first. */
export function UnsavedChangesGuard({ when }: { when: boolean }): React.ReactElement | null {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => { e.preventDefault(); };
    const onClick = (e: MouseEvent): void => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [when]);

  if (!pendingHref) return null;
  return (
    <Modal open onClose={(): void => setPendingHref(null)} title="Leave without saving?" size="sm">
      {/* Modal has no dialog role/label of its own — this keeps the confirm announced and testable. */}
      <div role="dialog" aria-modal="true" aria-label="Leave without saving?">
        <p className="text-sm text-[var(--text-secondary)]">Your changes to this author haven&apos;t been saved.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={(): void => setPendingHref(null)}>Stay</Button>
          <Button variant="danger" onClick={(): void => { const href = pendingHref; setPendingHref(null); router.push(href); }}>Leave</Button>
        </div>
      </div>
    </Modal>
  );
}
