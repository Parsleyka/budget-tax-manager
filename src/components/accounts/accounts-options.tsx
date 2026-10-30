"use client";

import { createContext, use, type ReactNode } from "react";
import type { AccountsDialogOptions } from "./accounts-view";

const AccountsOptionsContext = createContext<AccountsDialogOptions | null>(null);

/**
 * Hands the shared-dialog options (today, open accounts, balances) to every client island on the
 * Accounts page, so the Server Component serialises them once instead of once per row.
 * Renders no DOM — children stay direct children of the shell's `<main>`.
 */
export function AccountsOptionsProvider({ options, children }: { options: AccountsDialogOptions; children: ReactNode }) {
  return <AccountsOptionsContext value={options}>{children}</AccountsOptionsContext>;
}

export function useAccountsOptions(): AccountsDialogOptions {
  const options = use(AccountsOptionsContext);
  if (!options) throw new Error("useAccountsOptions must be used inside <AccountsOptionsProvider>");
  return options;
}
