"use client";

import { RotateCw, ServerCrash } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route error boundary (renders inside the app shell).
 * A `digest` means the error happened on the server: in production its message is withheld (the
 * client only gets e.g. "Minified React error #441"), so we explain that instead of showing it — the
 * full error is in the terminal running the app. Corrupt data files are reported by the root layout
 * (DataProblems), but the layout is not re-rendered on client-side navigation, so a file that broke
 * while the app was open lands here first: a full reload shows the dedicated screen.
 */
export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const redacted =
    !!error.digest ||
    /Server Components render|omitted in production|Minified React error #441/i.test(error.message ?? "");

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-8" role="alert">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <ServerCrash aria-hidden className="size-5" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">This page could not be loaded. Your data was not changed.</p>
        </div>
      </div>
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        {redacted ? (
          <div className="flex flex-col gap-2 text-sm" data-testid="error-redacted">
            <p>The server could not render this page. The details are not sent to the browser.</p>
            <p className="text-xs text-muted-foreground">
              The full message is printed in the terminal running the app (look for the digest below). If you edited a
              data file while the app was open, reload the page — it then shows which file needs attention.
            </p>
          </div>
        ) : (
          <p className="font-mono text-sm break-words whitespace-pre-wrap">{error.message || "Unknown error"}</p>
        )}
        {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Digest: {error.digest}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => (retry ?? reset)?.()}>
          <RotateCw /> Try again
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Go to Overview</Link>
        </Button>
      </div>
    </section>
  );
}
