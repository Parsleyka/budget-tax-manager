"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard (icon button with a short "copied" state). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Copied to the clipboard");
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy — select the text and copy it manually.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}
