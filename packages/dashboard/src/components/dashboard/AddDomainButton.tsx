"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { addDomainManually } from "@/actions/sync";
import { COMPANIES, VERTICALS } from "@/lib/constants";
import type { Company, Vertical } from "@/types/dashboard";

export function AddDomainButton(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [company, setCompany] = useState<Company>("ATL");
  const [vertical, setVertical] = useState<Vertical>("Other");
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  function handleSubmit(): void {
    if (!domain.trim()) return;
    startTransition(async () => {
      try {
        await addDomainManually(domain.trim(), company, vertical);
        toast(`Added ${domain.trim()} to dashboard`, "success");
        setOpen(false);
        setDomain("");
      } catch (error) {
        toast(
          error instanceof Error ? error.message : "Failed to add domain",
          "error"
        );
      }
    });
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={(): void => setOpen(true)}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add Domain
      </Button>

      <Modal open={open} onClose={(): void => setOpen(false)} title="Add Domain" size="sm">
        <div className="space-y-4">
          <Input
            label="Domain"
            placeholder="e.g. mynewsite.com"
            value={domain}
            onChange={(e): void => setDomain(e.target.value)}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Company"
              options={COMPANIES.map((c) => ({ value: c, label: c }))}
              value={company}
              onChange={(e): void => setCompany(e.target.value as Company)}
            />
            <Select
              label="Vertical"
              options={VERTICALS.map((v) => ({ value: v, label: v }))}
              value={vertical}
              onChange={(e): void => setVertical(e.target.value as Vertical)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={(): void => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={isPending}
              disabled={!domain.trim()}
            >
              Add Domain
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
