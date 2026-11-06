"use client";

import { useState } from "react";
import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import { TransferDialog } from "@/components/forms/transfer-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdjustmentRow, TransferRow } from "@/server/queries";
import { useAccountsOptions } from "./accounts-options";
import { AdjustmentsSection } from "./adjustments-section";
import { TransfersSection } from "./transfers-section";

function Count({ value }: { value: number }) {
  return <span className="text-xs font-normal text-muted-foreground tabular-nums">{value}</span>;
}

/** Transfers and balance updates under one tab bar; the button on the right adds to the open tab. */
export function AccountsHistory({ transfers, adjustments }: { transfers: TransferRow[]; adjustments: AdjustmentRow[] }) {
  const options = useAccountsOptions();
  const [tab, setTab] = useState("transfers");

  return (
    <SectionCard>
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-2">
        <div className="flex items-center justify-between gap-3">
          <TabsList variant="line" aria-label="Account history" className="-ml-1.5">
            <TabsTrigger value="transfers">
              Transfers <Count value={transfers.length} />
            </TabsTrigger>
            <TabsTrigger value="balance-updates">
              Balance updates <Count value={adjustments.length} />
            </TabsTrigger>
          </TabsList>
          {tab === "transfers" ? (
            <TransferDialog
              options={options}
              trigger={
                <Button size="sm" variant="ghost" className="-mr-2.5" disabled={options.accounts.length < 2}>
                  Transfer
                </Button>
              }
            />
          ) : (
            <AdjustBalanceDialog
              options={options}
              trigger={
                <Button size="sm" variant="ghost" className="-mr-2.5" disabled={options.accounts.length === 0}>
                  Update balance
                </Button>
              }
            />
          )}
        </div>
        <TabsContent value="transfers">
          <TransfersSection transfers={transfers} />
        </TabsContent>
        <TabsContent value="balance-updates">
          <AdjustmentsSection adjustments={adjustments} />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
