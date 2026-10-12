"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/** Marks the extra history entry that lets browser Back be caught while there are unsaved changes. */
const GUARD_KEY = "__authorsUnsavedGuard";
const BACK = "__back__";

/**
 * While `when` is true: closing the tab asks (beforeunload), in-app link clicks open a confirm first, and browser
 * Back opens the same confirm. Back is caught with one extra history entry for this page (same URL, Next's own
 * state copied); once the changes are saved or discarded, a Back press skips that entry so it still leaves at once.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }): React.ReactElement | null {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const whenRef = useRef(when);
  const guardEntry = useRef(false);
  const leaving = useRef(false);
  whenRef.current = when;

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = "You have unsaved changes.";
    };
    const onClick = (e: MouseEvent): void => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(href);
    };
    if (!guardEntry.current) {
      window.history.pushState({ ...(window.history.state as object | null), [GUARD_KEY]: true }, "", window.location.href);
      guardEntry.current = true;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [when]);

  // Mounted for the page's lifetime: it also has to skip the guard entry after the changes are gone.
  useEffect(() => {
    const onPopState = (): void => {
      if (leaving.current) return;
      if (!guardEntry.current) return;
      if (whenRef.current) {
        window.history.pushState({ ...(window.history.state as object | null), [GUARD_KEY]: true }, "", window.location.href);
        setPending(BACK);
      } else {
        guardEntry.current = false;
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function leave(): void {
    const target = pending;
    setPending(null);
    if (target === BACK) {
      leaving.current = true;
      guardEntry.current = false;
      window.history.go(-2);
    } else if (target) {
      // Replace the guard entry rather than add after it, so Back from the next page returns here in one press.
      if (guardEntry.current) { guardEntry.current = false; router.replace(target); } else router.push(target);
    }
  }

  if (!pending) return null;
  return (
    <Modal open onClose={(): void => setPending(null)} title="Leave without saving?" size="sm">
      {/* Modal has no dialog role/label of its own — this keeps the confirm announced and testable. */}
      <div role="dialog" aria-modal="true" aria-label="Leave without saving?">
        <p className="text-sm text-[var(--text-secondary)]">Your changes to this author haven&apos;t been saved.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={(): void => setPending(null)}>Stay</Button>
          <Button variant="danger" onClick={leave}>Leave</Button>
        </div>
      </div>
    </Modal>
  );
}
