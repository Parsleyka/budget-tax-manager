"use client";

import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** A flat, collapsed-by-default section ("Advanced", "Rules reference"): a hairline, a toggle, its content. */
export function Disclosure({
  title,
  defaultOpen = false,
  children,
  className,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("border-t pt-3", className)}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="group/disclosure -ml-2 h-8 gap-1.5 px-2 text-sm font-medium">
          <ChevronRight aria-hidden className="text-muted-foreground transition-transform group-data-[state=open]/disclosure:rotate-90" />
          {title}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-6 pt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
