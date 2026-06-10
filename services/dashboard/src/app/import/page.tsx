"use client";

import { CsvSiteCreator } from "@/components/import/CsvSiteCreator";
import { ImportPanel } from "@/components/import/ImportPanel";

export default function ImportPage(): React.ReactElement {
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">
          Import
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-8">
          Import articles into the network.
        </p>
      </div>

      <CsvSiteCreator />
      <ImportPanel />
    </div>
  );
}
