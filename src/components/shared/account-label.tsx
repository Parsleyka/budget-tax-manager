import { BriefcaseBusiness, ChartCandlestick, CreditCard, PiggyBank, Wallet, type LucideIcon } from "lucide-react";
import { ACCOUNT_GROUP_LABELS, type Account, type AccountGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CurrencyBadge } from "./currency-badge";

export const ACCOUNT_GROUP_ICONS: Record<AccountGroup, LucideIcon> = {
  active: CreditCard,
  freelancer: BriefcaseBusiness,
  ibkr: ChartCandlestick,
  deposits: PiggyBank,
  other: Wallet,
};

export type AccountLike = Pick<Account, "name" | "currency" | "group"> & Partial<Pick<Account, "archived">>;

export interface AccountLabelProps {
  /** null/undefined → "Unknown account". */
  account: AccountLike | null | undefined;
  /** Show the currency code badge after the name (default true). */
  showCurrency?: boolean;
  /** Show the group name ("Freelancer") after the name (default false). */
  showGroup?: boolean;
  /** Show the group icon before the name (default true). */
  showIcon?: boolean;
  className?: string;
}

/** Account name with its group icon, currency badge and an "archived" marker. */
export function AccountLabel({ account, showCurrency = true, showGroup = false, showIcon = true, className }: AccountLabelProps) {
  if (!account) {
    return <span className={cn("text-sm text-muted-foreground", className)}>Unknown account</span>;
  }
  const Icon = ACCOUNT_GROUP_ICONS[account.group];
  return (
    <span data-slot="account-label" className={cn("inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm", className)}>
      {showIcon ? <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className={cn("truncate", account.archived && "text-muted-foreground")}>{account.name}</span>
      {showGroup ? <span className="shrink-0 text-xs text-muted-foreground">· {ACCOUNT_GROUP_LABELS[account.group]}</span> : null}
      {showCurrency ? <CurrencyBadge currency={account.currency} className="shrink-0" /> : null}
      {account.archived ? <span className="shrink-0 text-[0.68rem] text-muted-foreground">archived</span> : null}
    </span>
  );
}
