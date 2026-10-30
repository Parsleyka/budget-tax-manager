import { Download } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SettingsPageData } from "@/server/queries";
import { CopyButton } from "./copy-button";
import { formatBytes } from "./import-file";
import { ImportDataCard } from "./import-data-card";

const FILE_LABELS: Record<string, string> = {
  "accounts.json": "Accounts",
  "incomes.json": "Salary & freelance income",
  "expenses.json": "Spendings (incl. tax payments)",
  "categories.json": "Categories",
  "transfers.json": "Transfers & currency sales",
  "adjustments.json": "Balance updates",
  "settings.json": "Settings",
  "rates.json": "NBU exchange-rate cache",
};

/** Settings → Data: where the files live, export (download) and import (replace with backup). */
export function DataSection({ dataDir, files }: Pick<SettingsPageData, "dataDir" | "files">) {
  const totalBytes = files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0);
  return (
    <>
      <SectionCard title="Data folder" action={<CopyButton text={dataDir} label="Copy path" />}>
        <p className="pb-2 font-mono text-xs break-all text-muted-foreground">{dataDir}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="hidden sm:table-cell">Contents</TableHead>
              <TableHead className="text-right">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((f) => (
              <TableRow key={f.name}>
                <TableCell className="font-mono text-xs">{f.name}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{FILE_LABELS[f.name] ?? "—"}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {f.exists && f.sizeBytes !== null ? (
                    formatBytes(f.sizeBytes)
                  ) : (
                    <span className="text-muted-foreground">Not created yet</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="text-xs">Total</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="text-right text-xs tabular-nums">{formatBytes(totalBytes)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </SectionCard>

      <SectionCard title="Export">
        <Button asChild variant="outline" className="w-full sm:w-fit">
          <a href="/api/export" download>
            <Download /> Download export
          </a>
        </Button>
      </SectionCard>

      <ImportDataCard dataDir={dataDir} />
    </>
  );
}
