/**
 * Domain types (SPEC §2). Money fields are MAJOR units with ≤ 2 decimals; do arithmetic
 * only through `@/lib/money`. Dates are YYYY-MM-DD, months YYYY-MM, quarters YYYY-Qn.
 * Pure + isomorphic.
 */
import type { Currency } from "./money";

export type { Currency } from "./money";
export type { ISODate, ISOMonth, QuarterKey, Quarter } from "./dates";

export type AccountGroup = "active" | "freelancer" | "ibkr" | "deposits" | "other";

export const ACCOUNT_GROUPS = ["active", "freelancer", "ibkr", "deposits", "other"] as const satisfies readonly AccountGroup[];
/** Groups that make up the Frozen balance (everything except "active"). */
export const FROZEN_GROUPS = ["freelancer", "ibkr", "deposits", "other"] as const satisfies readonly AccountGroup[];

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  active: "Active",
  freelancer: "Freelancer",
  // Key kept as "ibkr" for data compatibility; the group holds every investment account (IBKR, …).
  ibkr: "Investments",
  deposits: "Deposits",
  other: "Other",
};

export interface Account {
  id: string;
  name: string;
  group: AccountGroup;
  /** Accounts in group "active" MUST be UAH. */
  currency: Currency;
  /** In account currency; may be negative (e.g. a credit card). */
  openingBalance: number;
  /** Hidden from pickers; still counted in balances when its balance ≠ 0. */
  archived: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export type IncomeKind = "salary" | "freelance";
export type RateSource = "nbu" | "manual";

export interface Income {
  id: string;
  kind: IncomeKind;
  /** Date credited to the account — the tax income date for freelance. */
  date: string;
  /** In `currency`, > 0. Gross (before fee) — the tax base for freelance. */
  amount: number;
  /** salary: always "UAH". Always equals the target account's currency. */
  currency: Currency;
  /** UAH per 1 unit of currency; exactly 1 for UAH. */
  rate: number;
  rateSource: RateSource;
  /** convertToUah(amount, rate) — the TAXABLE base for freelance. */
  amountUah: number;
  /** Freelance only, same currency. The account is credited (amount − fee). */
  fee?: number;
  accountId: string;
  counterparty?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  /** A palette key from `CATEGORY_COLORS` ("blue", "orange", …) or a #rrggbb hex. */
  color: string;
  /** lucide-react icon name in PascalCase, e.g. "ShoppingCart". */
  icon?: string;
  /** The seeded "Taxes" category; cannot be deleted (can be renamed). */
  systemKey?: "taxes";
  /** Shown first in category lists (pickers, filters, Settings). */
  pinned?: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TaxKind = "single_tax" | "military_levy" | "esv";

export const TAX_KIND_LABELS: Record<TaxKind, string> = {
  single_tax: "Single tax",
  military_levy: "Military levy",
  esv: "ЄСВ",
};

export interface TaxMeta {
  kind: TaxKind;
  /** "YYYY-Qn" — the quarter the payment is FOR (not the payment date). */
  period: string;
}

export interface Expense {
  id: string;
  date: string;
  /** In account currency, > 0. */
  amount: number;
  /** = account currency. */
  currency: Currency;
  /** NBU rate on `date` (1 for UAH). */
  rate: number;
  /** Additive to SPEC: how `rate` was obtained (absent on UAH expenses / legacy rows). */
  rateSource?: RateSource;
  /** convertToUah(amount, rate) — used by analytics. */
  amountUah: number;
  categoryId: string;
  accountId: string;
  note?: string;
  /** Set when recorded via "Record tax payment" (category = Taxes). */
  taxMeta?: TaxMeta;
  createdAt: string;
  updatedAt: string;
}

/** Moving money between own accounts, incl. currency sale. Effective rate = toAmount / fromAmount. */
export interface Transfer {
  id: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  /** In from-account currency, > 0. */
  fromAmount: number;
  /** In to-account currency, > 0; equals fromAmount when currencies match. */
  toAmount: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** Balance correction / revaluation. The UI asks for the NEW balance; delta = new − current. */
export interface Adjustment {
  id: string;
  date: string;
  accountId: string;
  /** In account currency, ≠ 0, may be negative. */
  delta: number;
  note?: string;
  createdAt: string;
}

/**
 * Money put into / taken out of an investment account (group "ibkr") from OUTSIDE your tracked accounts
 * — e.g. deposits made before you started tracking. (A deposit from one of your accounts is a Transfer.)
 * It moves the investment account's balance and counts as invested principal.
 */
export interface InvestmentFlow {
  id: string;
  accountId: string;
  date: string;
  kind: "deposit" | "withdrawal";
  /** In the investment account's currency, > 0. */
  amount: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The market value of an investment account on a date, entered by hand. ABSOLUTE: the balance on/after
 * `date` is this value plus movements dated after it — so adding older deposits later never shifts it.
 */
export interface Valuation {
  id: string;
  accountId: string;
  date: string;
  /** In the account currency, ≥ 0. */
  value: number;
  note?: string;
  createdAt: string;
}

/** lent = they owe you (a receivable); borrowed = you owe them (a payable). */
export type DebtDirection = "lent" | "borrowed";

export const DEBT_DIRECTION_LABELS: Record<DebtDirection, string> = {
  lent: "Lent",
  borrowed: "Borrowed",
};

/** A (partial) return of a debt — by them for "lent", by you for "borrowed". */
export interface DebtRepayment {
  id: string;
  date: string;
  /** In the debt currency, > 0. */
  amount: number;
  /**
   * Your account the money arrived in ("lent") / was paid from ("borrowed") — its balance changes by
   * the repayment. Absent = no balance changes (e.g. cash you don't track).
   */
  accountId?: string;
  /** What arrived in / left that account, in ITS currency — only when it differs from the debt currency. */
  accountAmount?: number;
  note?: string;
  createdAt: string;
}

/**
 * Money lent to / borrowed from someone — a SEPARATE tracker: recording a debt never touches account
 * balances, net worth, income, spending or analytics. Only a repayment linked to one of your accounts
 * moves that account's balance (money really arrived / left). Repayments live inside the debt, so
 * deleting a debt removes its history atomically. (Debts written by the first version may still carry
 * an `accountId` on the debt itself; the schema drops it on read.)
 */
export interface Debt {
  id: string;
  direction: DebtDirection;
  /** Person or company. */
  counterparty: string;
  /** When the money changed hands (not in the future). */
  date: string;
  /** Principal in `currency`, > 0. */
  amount: number;
  currency: Currency;
  /** Agreed return date (may be in the future); absent = no deadline. */
  dueDate?: string;
  note?: string;
  repayments: DebtRepayment[];
  createdAt: string;
  updatedAt: string;
}

export type EsvMode = "employed" | "minimum" | "custom" | "exempt";

/** A run of months with no own ЄСВ (pension, disability, military service, occupied territory…). */
export interface EsvExemptPeriod {
  /** First exempt month, YYYY-MM (inclusive). */
  from: string;
  /** Last exempt month, YYYY-MM (inclusive); null = still exempt. */
  to: string | null;
  /** Free text, e.g. "Military service". */
  note?: string;
  /**
   * Mobilised / contract military service: the single tax and the military levy are exempt for these
   * months too, not only ЄСВ (ПКУ розд. XX підр. 10 п. 25; research/tax-rules.md §4.2).
   */
  militaryService?: boolean;
}

export interface TaxSettings {
  /** false → 5%; true → 3% (amounts must exclude VAT). */
  vatPayer: boolean;
  /** Percent, ≤ 2 decimals (e.g. 5). null → rules table. */
  singleTaxRateOverridePct: number | null;
  /** 1% from 2025-01-01 when enabled. */
  militaryLevyEnabled: boolean;
  militaryLevyRateOverridePct: number | null;
  /** null = open-ended. */
  militaryLevyEndDate: string | null;
  esvMode: EsvMode;
  /** "employed" coverage window (null = unbounded on that side). */
  employedFrom: string | null;
  employedTo: string | null;
  /** YYYY-MM months the employer did NOT cover → full minimum ЄСВ. */
  esvUncoveredMonths: string[];
  /** "custom": UAH base, clamped to [МЗП, maxBase] → 22% of it. */
  esvCustomMonthlyBase: number | null;
  /** No ЄСВ for months before; warn on income before it. */
  fopRegisteredOn: string | null;
  /**
   * Additive to SPEC (research/tax-rules.md §2.4, §4.3). Optional so older settings files stay valid.
   * ФОП deregistration date: ЄСВ is owed up to and including its month, nothing after.
   */
  fopDeregisteredOn?: string | null;
  /** Months with no own ЄСВ (tax-rules §4.2), each a month range. */
  esvExemptPeriods?: EsvExemptPeriod[];
  /** Used the martial-law right not to pay own ЄСВ for 2024 (Law 2464-VI розд. VIII п. 9-19); 2024 months only. */
  esv2024OptOut?: boolean;
}

export interface Settings {
  tax: TaxSettings;
  /** The "main bank account" (group active, UAH). */
  defaultActiveAccountId: string;
  createdAt: string;
  updatedAt: string;
}

/** One cached NBU rate. */
export interface RateEntry {
  /** UAH per 1 unit (rate_per_unit for the range endpoint). */
  rate: number;
  /** Business day the rate was set (range endpoint `calcdate`), YYYY-MM-DD, when known. */
  calcdate?: string;
  fetchedAt: string;
}

export type ForeignCurrency = "USD" | "EUR" | "PLN";

/** data/rates.json — permanent NBU cache (only real rows are stored, never `[]`). */
export interface RatesCache {
  version: 1;
  USD: Record<string, RateEntry>;
  EUR: Record<string, RateEntry>;
  PLN: Record<string, RateEntry>;
  meta: {
    /** Last time a range backfill ran (ISO timestamp). */
    lastBackfillAt?: string;
  };
}

/** Everything the app stores (except the rates cache). */
export interface DataSnapshot {
  accounts: Account[];
  incomes: Income[];
  expenses: Expense[];
  categories: Category[];
  transfers: Transfer[];
  adjustments: Adjustment[];
  debts: Debt[];
  investmentFlows: InvestmentFlow[];
  valuations: Valuation[];
  settings: Settings;
}

export interface ExportData extends DataSnapshot {
  rates?: RatesCache;
}

/** File produced by GET /api/export and accepted by the importData action. */
export interface ExportFile {
  app: "budget-tax-manager";
  version: 1;
  exportedAt: string;
  data: ExportData;
}

/** Server Action result (SPEC §7). Field error keys are zod paths joined with "." (e.g. "payments.0.amount"). */
export type FieldErrors = Record<string, string[]>;

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export type {
  IncomeInput,
  ExpenseInput,
  TaxPaymentInput,
  CategoryInput,
  AccountInput,
  SetActualBalanceInput,
  TransferInput,
  SettingsInput,
  DebtInput,
  DebtRepaymentInput,
  InvestmentFlowInput,
  ValuationInput,
} from "./schemas";
