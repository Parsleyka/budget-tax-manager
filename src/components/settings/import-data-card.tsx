"use client";

import { CircleCheck, FileCheck2, FileWarning, Upload, X } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { importData } from "@/server/actions/data";
import { MAX_IMPORT_BYTES, formatBytes, inspectImportFile, plural, type ImportCounts, type ImportSummary } from "./import-file";

type FileState =
  | { status: "idle" }
  | { status: "reading"; fileName: string }
  | { status: "invalid"; fileName: string; error: string }
  | { status: "ready"; fileName: string; sizeBytes: number; text: string; summary: ImportSummary };

type ImportOutcome = { ok: true; backupDir: string; counts: Omit<ImportCounts, "rates"> & { rates: number } } | { ok: false; error: string };

const kyivTimestamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function countLines(c: Omit<ImportCounts, "rates"> & { rates: number | null }): string[] {
  const lines = [
    plural(c.accounts, "account"),
    plural(c.incomes, "income"),
    plural(c.expenses, "spending"),
    plural(c.categories, "category", "categories"),
    plural(c.transfers, "transfer"),
    plural(c.adjustments, "balance update"),
    plural(c.debts, "debt"),
    plural(c.investmentFlows, "investment deposit/withdrawal", "investment deposits/withdrawals"),
    plural(c.valuations, "investment value update"),
  ];
  lines.push(c.rates === null ? "no NBU rate cache (yours is kept)" : plural(c.rates, "cached NBU rate"));
  return lines;
}

/** Settings → Data → Import: pick an export file, pre-check it, confirm, replace everything (with backup). */
export function ImportDataCard({ dataDir }: { dataDir: string }) {
  const [file, setFile] = useState<FileState>({ status: "idle" });
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    setOutcome(null);
    if (!picked) {
      setFile({ status: "idle" });
      return;
    }
    if (picked.size > MAX_IMPORT_BYTES) {
      setFile({
        status: "invalid",
        fileName: picked.name,
        error: `The file is ${formatBytes(picked.size)}; the limit is ${formatBytes(MAX_IMPORT_BYTES)}.`,
      });
      return;
    }
    setFile({ status: "reading", fileName: picked.name });
    try {
      const text = await picked.text();
      const inspection = inspectImportFile(text);
      setFile(
        inspection.ok
          ? { status: "ready", fileName: picked.name, sizeBytes: picked.size, text, summary: inspection.summary }
          : { status: "invalid", fileName: picked.name, error: inspection.error },
      );
    } catch {
      setFile({ status: "invalid", fileName: picked.name, error: "The file could not be read." });
    }
  }

  function clear() {
    setFile({ status: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function runImport(): Promise<void> {
    if (file.status !== "ready") return;
    const res = await importData(file.text);
    if (res.ok) {
      setOutcome({ ok: true, backupDir: res.data.backupDir, counts: res.data.counts });
      toast.success("Data imported", { description: `Your previous data was backed up to ${res.data.backupDir}` });
      clear();
      return;
    }
    setOutcome({ ok: false, error: res.error });
    toast.error(res.error);
  }

  return (
    <SectionCard title="Import">
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="import-file">Export file (.json)</FieldLabel>
          <Input
            ref={inputRef}
            id="import-file"
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="cursor-pointer"
          />
          <FieldDescription className="text-xs">Up to {formatBytes(MAX_IMPORT_BYTES)}. Nothing changes until you confirm.</FieldDescription>
        </Field>

        {file.status === "reading" ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Spinner className="size-3.5" /> Checking {file.fileName}…
          </p>
        ) : null}

        {file.status === "invalid" ? (
          <Alert variant="destructive">
            <FileWarning />
            <AlertTitle className="break-all">{file.fileName} can’t be imported</AlertTitle>
            <AlertDescription className="break-words">{file.error}</AlertDescription>
          </Alert>
        ) : null}

        {file.status === "ready" ? (
          <div className="flex flex-col gap-2">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <FileCheck2 className="size-4 shrink-0 text-positive" aria-hidden />
              <span className="truncate">{file.fileName}</span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Valid export from {kyivTimestamp.format(new Date(file.summary.exportedAt))} (Kyiv time). It contains:
            </p>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
              {countLines(file.summary.counts).map((line) => (
                <li key={line} className="tabular-nums">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="destructive" disabled={file.status !== "ready"} onClick={() => setConfirming(true)}>
            <Upload /> Replace all data…
          </Button>
          {file.status !== "idle" ? (
            <Button type="button" variant="ghost" onClick={clear}>
              <X /> Clear
            </Button>
          ) : null}
        </div>

        {outcome?.ok ? (
          <Alert>
            <CircleCheck className="text-positive" />
            <AlertTitle>Import complete</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{countLines(outcome.counts).join(", ")}.</span>
              <span>
                Previous data backed up to <code className="font-mono text-xs break-all">{outcome.backupDir}</code>
              </span>
            </AlertDescription>
          </Alert>
        ) : null}
        {outcome && !outcome.ok ? (
          <Alert variant="destructive">
            <FileWarning />
            {/* The service restores every file on a failed write; it says so unless a restore itself failed. */}
            <AlertTitle>
              {/could not be restored/.test(outcome.error) ? "Import failed — your data needs attention" : "Import failed — nothing was changed"}
            </AlertTitle>
            <AlertDescription className="break-words">{outcome.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        confirmLabel="Replace all data"
        title="Replace all your data?"
        description={
          <>
            All accounts, incomes, spendings, categories, transfers, balance updates, debts, investments and settings will be replaced by the
            contents of “{file.status === "ready" ? file.fileName : "the file"}”. This cannot be merged.
          </>
        }
        onConfirm={runImport}
      >
        <div className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          A backup is made first: every current file is copied to{" "}
          <code className="font-mono break-all text-foreground">{dataDir}/backups/&lt;date-time&gt;/</code>. To undo the
          import, copy those files back into the data folder.
        </div>
      </ConfirmDialog>
    </SectionCard>
  );
}
