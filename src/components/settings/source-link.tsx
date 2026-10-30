import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuleSource } from "./rule-sources";

/** A legal citation, linked to zakon.rada.gov.ua when the law is known. Inline, so it wraps like text. */
export function SourceLink({ source, className }: { source: RuleSource; className?: string }) {
  if (!source.href) return <span className={className}>{source.label}</span>;
  return (
    <a
      href={source.href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "underline decoration-muted-foreground/40 underline-offset-2 hover:text-primary hover:decoration-primary",
        className,
      )}
    >
      {source.label}
      <ExternalLink aria-hidden className="ml-0.5 inline size-3 align-[-1px] opacity-60" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
