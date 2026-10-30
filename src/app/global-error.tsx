"use client";

import "./globals.css";

/** Last-resort boundary for errors in the root layout itself (renders its own document). */
export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background font-sans text-foreground antialiased">
        <title>Error · Budget &amp; Tax</title>
        <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
          <h1 className="text-2xl font-semibold">The app could not start</h1>
          <p className="text-sm text-muted-foreground">Your data was not changed. Details are also printed in the terminal running the app.</p>
          <pre className="rounded-lg border bg-muted p-4 text-sm break-words whitespace-pre-wrap">
            {error.message || "Unknown error"}
            {error.digest ? `\n\nDigest: ${error.digest}` : ""}
          </pre>
          <div>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              onClick={() => (retry ?? reset)?.()}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
