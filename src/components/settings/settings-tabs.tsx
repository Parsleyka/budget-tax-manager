"use client";

import type * as React from "react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_TABS, type SettingsTab } from "./tabs";

const TAB_LABELS: Record<SettingsTab, string> = { taxes: "Taxes", categories: "Categories", general: "General", data: "Data" };

export interface SettingsTabsProps {
  /** From `?tab=` (validated on the server). */
  initialTab: SettingsTab;
  panels: Record<SettingsTab, React.ReactNode>;
}

/**
 * Settings sections as tabs. The active tab lives in `?tab=` (written with history.replaceState, so
 * no server round-trip) and every panel stays mounted — unsaved tax edits survive a tab switch.
 */
export function SettingsTabs({ initialTab, panels }: SettingsTabsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [prevInitial, setPrevInitial] = useState(initialTab);
  if (initialTab !== prevInitial) {
    // Navigated to another ?tab= while mounted (e.g. a link from another page).
    setPrevInitial(initialTab);
    setTab(initialTab);
  }

  function change(value: string) {
    const next = value as SettingsTab;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "taxes") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <Tabs value={tab} onValueChange={change} className="gap-6">
      <TabsList className="w-full sm:w-fit" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <TabsTrigger key={t} value={t} className="sm:px-3">
            {TAB_LABELS[t]}
          </TabsTrigger>
        ))}
      </TabsList>
      {SETTINGS_TABS.map((t) => (
        <TabsContent key={t} value={t} forceMount className="flex min-w-0 flex-col gap-8 data-[state=inactive]:hidden">
          {panels[t]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
