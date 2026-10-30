import { DatabaseZap, FileWarning } from "lucide-react";
import type { DataHealthProblem } from "@/server/db/store";

/** Full-page notice shown by the root layout when a data file is corrupt (nothing is overwritten). */
export function DataProblems({ problems, dataDir }: { problems: DataHealthProblem[]; dataDir: string }) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-4" aria-labelledby="data-problems-title">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <DatabaseZap aria-hidden className="size-5" />
        </div>
        <div className="flex flex-col gap-1">
          <h1 id="data-problems-title" className="text-2xl font-semibold tracking-tight">
            Your data files need attention
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            The app found data it cannot read safely and stopped before changing anything. Fix the file(s) below or
            restore them from the <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.bak</code> copy next to
            them, then reload.
          </p>
        </div>
      </div>
      <p className="text-sm">
        Data folder: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{dataDir}</code>
      </p>
      <ul className="flex flex-col gap-3">
        {problems.map((p) => (
          <li key={p.file} className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <FileWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <div className="font-mono font-medium break-all">{p.file}</div>
              <div className="mt-1 text-muted-foreground break-words">{p.message}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
