"use client";

import { ChevronRight, Ellipsis } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InvestmentFlowDialog, type InvestmentDialogOptions } from "@/components/forms/investment-flow-dialog";
import { TransferDialog, type TransferDialogOptions } from "@/components/forms/transfer-dialog";
import { ValuationDialog } from "@/components/forms/valuation-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { formatMoneyDisplay, Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/dates";
import { ageLabel, isTrackedGroup, TRACKED_GROUP_COPY, type InvestmentMovement, type InvestmentSummary } from "@/lib/investments";
import type { FxRates } from "@/lib/ledger";
import { convertToUah } from "@/lib/money";
import { cn } from "@/lib/utils";
import { deleteInvestmentFlow, deleteValuation } from "@/server/actions/investments";
import { deleteTransfer } from "@/server/actions/transfers";
import { signedPercent, STALE_DAYS } from "./format";
import { InvestmentChart } from "./investment-chart";

export interface InvestmentAccountRowProps {
  summary: InvestmentSummary;
  fx: FxRates;
  options: InvestmentDialogOptions;
  transferOptions: TransferDialogOptions;
  /** Value + net deposited of every investment account (for the "Update value" preview). */
  current: Record<string, { value: number; netDeposited: number }>;
}

/** History rows shown before "Show all". */
const HISTORY_LIMIT = 5;

function uahOf(amount: number, currency: InvestmentSummary["currency"], fx: FxRates): number | null {
  if (currency === "UAH") return amount;
  const r = fx[currency];
  return r ? convertToUah(amount, r.rate) : null;
}

/** One investment / deposit account as a compact row: value and gain; the chart and history open below. */
export function InvestmentAccountRow({ summary: s, fx, options, transferOptions, current }: InvestmentAccountRowProps) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"flow" | "value" | null>(null);
  const cur = s.currency;
  // A bank deposit has a balance with interest; a brokerage has a market value.
  const copy = TRACKED_GROUP_COPY[isTrackedGroup(s.account.group) ? s.account.group : "ibkr"];
  const valueUah = cur === "UAH" ? null : uahOf(s.value, cur, fx);
  const gainTone = s.gain > 0 ? "text-positive" : s.gain < 0 ? "text-negative" : undefined;
  const stale = s.valuationAgeDays === null || s.valuationAgeDays > STALE_DAYS;
  const archived = s.account.archived;

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid={`investment-card-${s.account.name}`} className="border-b last:border-b-0">
      <div className="flex items-center gap-3 py-3">
        <CollapsibleTrigger asChild>
          <button type="button" className="group flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">
                {s.account.name}
                <span className="sr-only"> details</span>
                {archived ? <span className="ml-2 text-xs font-normal text-muted-foreground">archived</span> : null}
              </span>
              <span className={cn("truncate text-xs", stale ? "text-warning" : "text-muted-foreground")}>
                {s.lastValuation ? `Updated ${ageLabel(s.valuationAgeDays ?? 0)}` : "Not updated yet"}
              </span>
            </span>
          </button>
        </CollapsibleTrigger>
        {/* Phones: value over gain in one column, so the account name keeps its width. */}
        <dl className="flex shrink-0 flex-col items-end text-right sm:flex-row sm:items-start sm:gap-8">
          <div data-testid="investment-value">
            <dt className="sr-only">{copy.value}</dt>
            <dd className="font-medium tabular-nums">
              <Money amount={s.value} currency={cur} />
            </dd>
            {valueUah !== null ? (
              <dd className="hidden text-xs text-muted-foreground sm:block">
                ≈ <Money amount={valueUah} currency="UAH" />
              </dd>
            ) : null}
          </div>
          <div data-testid="investment-gain" className="flex items-baseline gap-1.5 sm:block sm:min-w-24">
            <dt className="sr-only">{copy.gain}</dt>
            <dd className="font-medium">
              <Money amount={s.gain} currency={cur} signed className={gainTone} />
            </dd>
            <dd className="text-xs text-muted-foreground">{s.returnPct !== null ? signedPercent(s.returnPct) : "—"}</dd>
          </div>
        </dl>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${s.account.name}`} className="text-muted-foreground" disabled={archived}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog("flow")}>Deposit / withdrawal</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("value")}>{copy.update}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-4 pb-5 pl-6">
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <div className="flex items-baseline gap-1.5" data-testid="investment-deposited">
              <dt className="text-muted-foreground">Deposited</dt>
              <dd className="font-medium">
                <Money amount={s.netDeposited} currency={cur} />
              </dd>
              {s.withdrawn > 0 ? (
                <dd className="text-xs text-muted-foreground">
                  <Money amount={s.deposited} currency={cur} /> in · <Money amount={s.withdrawn} currency={cur} /> out
                </dd>
              ) : null}
            </div>
            {s.lastValuation ? (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{formatDate(s.lastValuation.date)}</dd>
              </div>
            ) : null}
          </dl>

          {s.series.length >= 2 ? <InvestmentChart series={s.series} currency={cur} valueLabel={copy.value} /> : null}

          {s.movements.length || s.valuations.length ? (
            <InvestmentHistory summary={s} options={options} transferOptions={transferOptions} />
          ) : (
            <p className="text-sm text-muted-foreground">No deposits or updates yet.</p>
          )}
        </div>
      </CollapsibleContent>

      <InvestmentFlowDialog
        options={options}
        defaults={{ accountId: s.account.id }}
        open={dialog === "flow"}
        onOpenChange={(o) => setDialog(o ? "flow" : null)}
      />
      <ValuationDialog
        options={options}
        defaults={{ accountId: s.account.id }}
        current={current}
        open={dialog === "value"}
        onOpenChange={(o) => setDialog(o ? "value" : null)}
      />
    </Collapsible>
  );
}

/** Deposits & withdrawals and value updates of one account (latest first, the rest behind "Show all"). */
function InvestmentHistory({
  summary: s,
  options,
  transferOptions,
}: Pick<InvestmentAccountRowProps, "summary" | "options" | "transferOptions">) {
  const [all, setAll] = useState(false);
  const cur = s.currency;
  const copy = TRACKED_GROUP_COPY[isTrackedGroup(s.account.group) ? s.account.group : "ibkr"];
  const noun = s.account.group === "deposits" ? "balance" : "value";
  const movements = all ? s.movements : s.movements.slice(0, HISTORY_LIMIT);
  const valuations = all ? s.valuations : s.valuations.slice(0, HISTORY_LIMIT);
  const more = Math.max(s.movements.length, s.valuations.length) > HISTORY_LIMIT && !all;

  return (
    <Tabs defaultValue="flows" className="gap-2">
      <TabsList aria-label={`${s.account.name} history`}>
        <TabsTrigger value="flows">
          Deposits & withdrawals <span className="text-xs text-muted-foreground tabular-nums">{s.movements.length}</span>
        </TabsTrigger>
        <TabsTrigger value="values">
          {copy.updates} <span className="text-xs text-muted-foreground tabular-nums">{s.valuations.length}</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="flows">
        {movements.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No deposits yet.</p>
        ) : (
          <ul className="divide-y">
            {movements.map((m) => (
              <MovementRow key={m.key} movement={m} summary={s} options={options} transferOptions={transferOptions} />
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="values">
        {valuations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No {noun} updates yet.</p>
        ) : (
          <ul className="divide-y">
            {valuations.map((v) => (
              <li key={v.id} data-testid="investment-valuation" className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="tabular-nums">{formatDate(v.date)}</span>
                  {v.note ? <span className="ml-2 truncate text-xs text-muted-foreground">{v.note}</span> : null}
                </span>
                {v.change !== null ? (
                  <Money amount={v.change} currency={cur} signed className={cn("text-xs", v.change > 0 ? "text-positive" : v.change < 0 ? "text-negative" : "text-muted-foreground")} />
                ) : null}
                <Money amount={v.value} currency={cur} className="w-28 text-right font-medium" />
                <DeleteButton
                  id={v.id}
                  action={deleteValuation}
                  noun={`${noun} update`}
                  ariaLabel={`Delete ${noun} update of ${formatDate(v.date)}`}
                  description={`${formatMoneyDisplay(v.value, cur)} on ${formatDate(v.date)}. The account value falls back to the previous update plus later deposits.`}
                  className="text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
      {more ? (
        <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setAll(true)}>
          Show all
        </Button>
      ) : null}
    </Tabs>
  );
}

/** One deposit / withdrawal: date, from / to, amount and a "…" menu (edit · delete). */
function MovementRow({
  movement: m,
  summary: s,
  options,
  transferOptions,
}: Pick<InvestmentAccountRowProps, "summary" | "options" | "transferOptions"> & { movement: InvestmentMovement }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cur = s.currency;
  const deposit = m.kind === "deposit";
  const label = `${deposit ? "deposit" : "withdrawal"} of ${formatMoneyDisplay(m.amount, cur)} on ${formatDate(m.date)}`;
  const where = m.source === "transfer" ? `${deposit ? "from" : "to"} ${m.linkedAccount?.name ?? "another account"}` : "outside";

  return (
    <li data-testid="investment-movement" className="flex items-center gap-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        <span className="tabular-nums">{formatDate(m.date)}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {deposit ? "Deposit" : "Withdrawal"} · {where}
          {m.source === "transfer" && m.linkedAccount && m.linkedAccount.currency !== cur && m.linkedAmount !== null
            ? ` (${formatMoneyDisplay(m.linkedAmount, m.linkedAccount.currency)})`
            : ""}
          {m.note ? ` · ${m.note}` : ""}
        </span>
      </span>
      <Money amount={deposit ? m.amount : -m.amount} currency={cur} signed className="w-28 text-right font-medium" />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} className="text-muted-foreground">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {m.source === "flow" ? (
        <InvestmentFlowDialog
          options={options}
          open={editing}
          onOpenChange={setEditing}
          flow={{ id: m.id, accountId: s.account.id, date: m.date, kind: m.kind, amount: m.amount, note: m.note, createdAt: m.createdAt, updatedAt: m.createdAt }}
        />
      ) : (
        <TransferDialog
          options={transferOptions}
          open={editing}
          onOpenChange={setEditing}
          transfer={{
            id: m.id,
            date: m.date,
            fromAccountId: deposit ? (m.linkedAccount?.id ?? "") : s.account.id,
            toAccountId: deposit ? s.account.id : (m.linkedAccount?.id ?? ""),
            fromAmount: deposit ? (m.linkedAmount ?? m.amount) : m.amount,
            toAmount: deposit ? m.amount : (m.linkedAmount ?? m.amount),
            note: m.note,
            createdAt: m.createdAt,
            updatedAt: m.createdAt,
            fromAccount: deposit ? m.linkedAccount : s.account,
            toAccount: deposit ? s.account : m.linkedAccount,
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete this ${deposit ? "deposit" : "withdrawal"}?`}
        description={
          m.source === "transfer"
            ? `This is a transfer ${deposit ? "from" : "to"} ${m.linkedAccount?.name ?? "another account"} — both balances go back. This can't be undone.`
            : "The invested principal and the account value go back accordingly. This can't be undone."
        }
        onConfirm={async () => {
          const res = await (m.source === "flow" ? deleteInvestmentFlow : deleteTransfer)(m.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(deposit ? "Deposit deleted" : "Withdrawal deleted");
        }}
      />
    </li>
  );
}
