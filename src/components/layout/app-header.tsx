import type * as React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "./theme-toggle";

/**
 * Sticky top bar: sidebar toggle · NBU rates · theme switch. `rates` is a slot (the layout passes the
 * rates widget wrapped in <Suspense>, so the bar renders before NBU answers).
 */
export function AppHeader({ rates }: { rates: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
      <div className="ml-auto flex items-center gap-1">
        {rates}
        <ThemeToggle />
      </div>
    </header>
  );
}
