/**
 * zod schemas for every stored entity, every data file, and every Server Action input.
 * Pure + isomorphic: client forms may reuse the input schemas for client-side validation.
 */
import { z } from "zod";
import { isValidCategoryColor } from "./categories";
import { isValidDate, isValidMonth, isValidQuarterKey } from "./dates";
import { convertToUah, hasAtMostDecimals, toMinor } from "./money";
import type {
  Account,
  Adjustment,
  Category,
  Debt,
  DebtRepayment,
  Expense,
  InvestmentFlow,
  ExportFile,
  Income,
  RatesCache,
  Settings,
  TaxSettings,
  Transfer,
  Valuation,
} from "./types";

// ------------------------------------------------------------------ primitives

export const MAX_AMOUNT = 1_000_000_000_000; // 1e12 major units — sanity bound

export const IdSchema = z.string().trim().min(1, "Required").max(100);
export const DateSchema = z.string().refine(isValidDate, "Enter a valid date (YYYY-MM-DD)");
export const MonthSchema = z.string().refine(isValidMonth, "Enter a valid month (YYYY-MM)");
export const QuarterKeySchema = z.string().refine(isValidQuarterKey, "Enter a valid quarter (YYYY-Qn)");
export const TimestampSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp");
export const CurrencySchema = z.enum(["UAH", "USD", "EUR", "PLN"]);
export const ForeignCurrencySchema = z.enum(["USD", "EUR", "PLN"]);
export const AccountGroupSchema = z.enum(["active", "freelancer", "ibkr", "deposits", "other"]);
export const RateSourceSchema = z.enum(["nbu", "manual"]);
export const TaxKindSchema = z.enum(["single_tax", "military_levy", "esv"]);
export const EsvModeSchema = z.enum(["employed", "minimum", "custom", "exempt"]);

/** Any amount with ≤ 2 decimals (may be negative or zero). */
export const MoneySchema = z
  .number({ error: "Enter a number" })
  .refine(Number.isFinite, "Enter a number")
  .refine((n) => hasAtMostDecimals(n, 2), "At most 2 decimals")
  .refine((n) => Math.abs(n) <= MAX_AMOUNT, "Amount is too large");

/** Amount > 0 with ≤ 2 decimals. */
export const PositiveMoneySchema = MoneySchema.refine((n) => n > 0, "Must be greater than 0");

/** Exchange rate > 0 with ≤ 4 decimals (NBU precision). */
export const RateSchema = z
  .number({ error: "Enter a rate" })
  .refine(Number.isFinite, "Enter a rate")
  .refine((n) => n > 0, "Rate must be greater than 0")
  .refine((n) => hasAtMostDecimals(n, 4), "At most 4 decimals")
  .refine((n) => n < 1_000_000, "Rate is too large");

/** Percent 0..100 with ≤ 2 decimals. */
export const PercentSchema = z
  .number({ error: "Enter a percent" })
  .refine(Number.isFinite, "Enter a percent")
  .refine((n) => n >= 0 && n <= 100, "Must be between 0 and 100")
  .refine((n) => hasAtMostDecimals(n, 2), "At most 2 decimals");

/** Optional free text; "" and whitespace become undefined. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .nullable()
    .transform((s) => (s ? s : undefined));

const NameSchema = z.string().trim().min(1, "Required").max(80, "At most 80 characters");
const CategoryColorSchema = z.string().refine(isValidCategoryColor, "Pick a color");
const IconSchema = z.string().trim().max(60).optional();

// ------------------------------------------------------------------ entities (stored)

export const AccountSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    group: AccountGroupSchema,
    currency: CurrencySchema,
    openingBalance: MoneySchema,
    archived: z.boolean(),
    note: z.string().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .refine((a) => a.group !== "active" || a.currency === "UAH", {
    message: "Accounts in the Active group must be in UAH",
    path: ["currency"],
  });

export const IncomeSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(["salary", "freelance"]),
    date: DateSchema,
    amount: PositiveMoneySchema,
    currency: CurrencySchema,
    rate: RateSchema,
    rateSource: RateSourceSchema,
    amountUah: MoneySchema,
    fee: MoneySchema.refine((n) => n >= 0, "Fee cannot be negative").optional(),
    accountId: IdSchema,
    counterparty: z.string().optional(),
    note: z.string().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((i, ctx) => {
    if (i.kind === "salary" && i.currency !== "UAH") {
      ctx.addIssue({ code: "custom", message: "Salary must be in UAH", path: ["currency"] });
    }
    if (i.kind === "salary" && i.fee !== undefined && i.fee !== 0) {
      ctx.addIssue({ code: "custom", message: "Salary cannot have a fee", path: ["fee"] });
    }
    if (i.currency === "UAH" && i.rate !== 1) {
      ctx.addIssue({ code: "custom", message: "UAH rate must be 1", path: ["rate"] });
    }
    if (i.fee !== undefined && i.fee >= i.amount) {
      ctx.addIssue({ code: "custom", message: "Fee must be less than the amount", path: ["fee"] });
    }
    if (convertToUah(i.amount, i.rate) !== i.amountUah) {
      ctx.addIssue({ code: "custom", message: "amountUah does not match amount × rate", path: ["amountUah"] });
    }
  });

export const CategorySchema = z.object({
  id: IdSchema,
  name: NameSchema,
  color: CategoryColorSchema,
  icon: z.string().optional(),
  systemKey: z.literal("taxes").optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const TaxMetaSchema = z.object({
  kind: TaxKindSchema,
  period: QuarterKeySchema,
});

export const ExpenseSchema = z
  .object({
    id: IdSchema,
    date: DateSchema,
    amount: PositiveMoneySchema,
    currency: CurrencySchema,
    rate: RateSchema,
    rateSource: RateSourceSchema.optional(),
    amountUah: MoneySchema,
    categoryId: IdSchema,
    accountId: IdSchema,
    note: z.string().optional(),
    taxMeta: TaxMetaSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((e, ctx) => {
    if (e.currency === "UAH" && e.rate !== 1) {
      ctx.addIssue({ code: "custom", message: "UAH rate must be 1", path: ["rate"] });
    }
    if (convertToUah(e.amount, e.rate) !== e.amountUah) {
      ctx.addIssue({ code: "custom", message: "amountUah does not match amount × rate", path: ["amountUah"] });
    }
  });

export const TransferSchema = z
  .object({
    id: IdSchema,
    date: DateSchema,
    fromAccountId: IdSchema,
    toAccountId: IdSchema,
    fromAmount: PositiveMoneySchema,
    toAmount: PositiveMoneySchema,
    note: z.string().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  });

export const AdjustmentSchema = z.object({
  id: IdSchema,
  date: DateSchema,
  accountId: IdSchema,
  delta: MoneySchema.refine((n) => n !== 0, "Delta cannot be 0"),
  note: z.string().optional(),
  createdAt: TimestampSchema,
});

export const InvestmentFlowSchema = z.object({
  id: IdSchema,
  accountId: IdSchema,
  date: DateSchema,
  kind: z.enum(["deposit", "withdrawal"]),
  amount: PositiveMoneySchema,
  note: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ValuationSchema = z.object({
  id: IdSchema,
  accountId: IdSchema,
  date: DateSchema,
  value: MoneySchema.refine((n) => n >= 0, "The value cannot be negative"),
  note: z.string().optional(),
  createdAt: TimestampSchema,
});

export const DebtDirectionSchema = z.enum(["lent", "borrowed"]);
const CounterpartySchema = z.string().trim().min(1, "Who is it? Enter a name").max(120, "At most 120 characters");

export const DebtRepaymentSchema = z.object({
  id: IdSchema,
  date: DateSchema,
  amount: PositiveMoneySchema,
  accountId: IdSchema.optional(),
  accountAmount: PositiveMoneySchema.optional(),
  note: z.string().optional(),
  createdAt: TimestampSchema,
});

// Unknown keys are stripped: an `accountId` on the debt itself (first version of debts) is dropped on read.

export const DebtSchema = z
  .object({
    id: IdSchema,
    direction: DebtDirectionSchema,
    counterparty: CounterpartySchema,
    date: DateSchema,
    amount: PositiveMoneySchema,
    currency: CurrencySchema,
    dueDate: DateSchema.optional(),
    note: z.string().optional(),
    repayments: z.array(DebtRepaymentSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((d, ctx) => {
    if (d.dueDate !== undefined && d.dueDate < d.date) {
      ctx.addIssue({ code: "custom", message: "The due date cannot be before the debt date", path: ["dueDate"] });
    }
    let repaid = 0;
    d.repayments.forEach((r, i) => {
      repaid += toMinor(r.amount);
      if (r.date < d.date) {
        ctx.addIssue({ code: "custom", message: "A repayment cannot be dated before the debt", path: ["repayments", i, "date"] });
      }
    });
    if (repaid > toMinor(d.amount)) {
      ctx.addIssue({ code: "custom", message: "Repayments exceed the debt amount", path: ["repayments"] });
    }
  });

export const EsvExemptPeriodSchema = z
  .object({
    from: MonthSchema,
    to: MonthSchema.nullable(),
    note: z.string().trim().max(200, "At most 200 characters").optional(),
    militaryService: z.boolean().optional(),
  })
  .refine((p) => p.to === null || p.from <= p.to, { message: "“To” must not be before “From”", path: ["to"] });

const taxSettingsShape = {
  vatPayer: z.boolean(),
  singleTaxRateOverridePct: PercentSchema.nullable(),
  militaryLevyEnabled: z.boolean(),
  militaryLevyRateOverridePct: PercentSchema.nullable(),
  militaryLevyEndDate: DateSchema.nullable(),
  esvMode: EsvModeSchema,
  employedFrom: DateSchema.nullable(),
  employedTo: DateSchema.nullable(),
  esvUncoveredMonths: z.array(MonthSchema),
  esvCustomMonthlyBase: PositiveMoneySchema.nullable(),
  fopRegisteredOn: DateSchema.nullable(),
  fopDeregisteredOn: DateSchema.nullable().optional(),
  esvExemptPeriods: z.array(EsvExemptPeriodSchema).max(50, "At most 50 periods").optional(),
  esv2024OptOut: z.boolean().optional(),
};

export const TaxSettingsSchema = z.object(taxSettingsShape).superRefine((t, ctx) => {
  if (t.employedFrom && t.employedTo && t.employedFrom > t.employedTo) {
    ctx.addIssue({ code: "custom", message: "“Employed to” must be after “Employed from”", path: ["employedTo"] });
  }
  if (t.fopRegisteredOn && t.fopDeregisteredOn && t.fopDeregisteredOn < t.fopRegisteredOn) {
    ctx.addIssue({ code: "custom", message: "Deregistration must not be before registration", path: ["fopDeregisteredOn"] });
  }
});

export const SettingsSchema = z.object({
  tax: TaxSettingsSchema,
  defaultActiveAccountId: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const RateEntrySchema = z.object({
  rate: RateSchema,
  calcdate: DateSchema.optional(),
  fetchedAt: TimestampSchema,
});

const RateMapSchema = z.record(DateSchema, RateEntrySchema);

export const RatesCacheSchema = z.object({
  version: z.literal(1),
  USD: RateMapSchema,
  EUR: RateMapSchema,
  // Caches written before PLN was supported have no PLN key.
  PLN: RateMapSchema.default({}),
  meta: z.object({ lastBackfillAt: TimestampSchema.optional() }),
});

// ------------------------------------------------------------------ data files

const collectionFile = <T extends z.ZodType>(item: T) => z.object({ version: z.literal(1), items: z.array(item) });

export const AccountsFileSchema = collectionFile(AccountSchema);
export const IncomesFileSchema = collectionFile(IncomeSchema);
export const ExpensesFileSchema = collectionFile(ExpenseSchema);
export const CategoriesFileSchema = collectionFile(CategorySchema);
export const TransfersFileSchema = collectionFile(TransferSchema);
export const AdjustmentsFileSchema = collectionFile(AdjustmentSchema);
export const DebtsFileSchema = collectionFile(DebtSchema);
export const InvestmentFlowsFileSchema = collectionFile(InvestmentFlowSchema);
export const ValuationsFileSchema = collectionFile(ValuationSchema);
export const SettingsFileSchema = z.object({ version: z.literal(1), settings: SettingsSchema });

export const DataSnapshotSchema = z.object({
  accounts: z.array(AccountSchema),
  incomes: z.array(IncomeSchema),
  expenses: z.array(ExpenseSchema),
  categories: z.array(CategorySchema),
  transfers: z.array(TransferSchema),
  adjustments: z.array(AdjustmentSchema),
  // Exports made before debts existed have no `debts` key.
  debts: z.array(DebtSchema).default([]),
  // Exports made before investments existed have neither key.
  investmentFlows: z.array(InvestmentFlowSchema).default([]),
  valuations: z.array(ValuationSchema).default([]),
  settings: SettingsSchema,
});

export const ExportFileSchema = z.object({
  app: z.literal("budget-tax-manager"),
  version: z.literal(1),
  exportedAt: TimestampSchema,
  data: DataSnapshotSchema.extend({ rates: RatesCacheSchema.optional() }),
});

// ------------------------------------------------------------------ action inputs

/**
 * createIncome / updateIncome. `rate` is only trusted when rateSource = "manual"
 * (otherwise the server re-resolves the NBU rate for `date`). Currency must equal the
 * account currency. Salary: UAH only, no fee.
 */
export const IncomeInputSchema = z
  .object({
    kind: z.enum(["salary", "freelance"]),
    date: DateSchema,
    amount: PositiveMoneySchema,
    currency: CurrencySchema,
    accountId: IdSchema,
    fee: MoneySchema.refine((n) => n >= 0, "Fee cannot be negative").nullable().optional(),
    rate: RateSchema.nullable().optional(),
    rateSource: RateSourceSchema.default("nbu"),
    counterparty: optionalText(200),
    note: optionalText(1000),
  })
  .superRefine((i, ctx) => {
    if (i.kind === "salary" && i.currency !== "UAH") {
      ctx.addIssue({ code: "custom", message: "Salary is always in UAH", path: ["currency"] });
    }
    if (i.kind === "salary" && i.fee) {
      ctx.addIssue({ code: "custom", message: "Salary cannot have a fee", path: ["fee"] });
    }
    if (i.fee && i.fee >= i.amount) {
      ctx.addIssue({ code: "custom", message: "Fee must be less than the amount", path: ["fee"] });
    }
    if (i.currency !== "UAH" && i.rateSource === "manual" && (i.rate === null || i.rate === undefined)) {
      ctx.addIssue({ code: "custom", message: "Enter the exchange rate", path: ["rate"] });
    }
  });

/**
 * createExpense / updateExpense. Currency comes from the account. `taxMeta` links a Taxes spending to
 * the ФОП quarter it pays for (UAH account + Taxes category only); null removes the link, omitted keeps
 * the existing one.
 */
export const ExpenseInputSchema = z
  .object({
    date: DateSchema,
    amount: PositiveMoneySchema,
    accountId: IdSchema,
    categoryId: IdSchema,
    note: optionalText(1000),
    rate: RateSchema.nullable().optional(),
    rateSource: RateSourceSchema.default("nbu"),
    taxMeta: TaxMetaSchema.nullable().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.rateSource === "manual" && (e.rate === null || e.rate === undefined)) {
      ctx.addIssue({ code: "custom", message: "Enter the exchange rate", path: ["rate"] });
    }
  });

/** recordTaxPayment: one Taxes expense per payment line (from a UAH account). */
export const TaxPaymentInputSchema = z
  .object({
    date: DateSchema,
    accountId: IdSchema,
    period: QuarterKeySchema,
    payments: z
      .array(z.object({ kind: TaxKindSchema, amount: PositiveMoneySchema }))
      .min(1, "Add at least one payment"),
    note: optionalText(1000),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.payments.forEach((line, i) => {
      if (seen.has(line.kind)) {
        ctx.addIssue({ code: "custom", message: "Each tax kind may appear once", path: ["payments", i, "kind"] });
      }
      seen.add(line.kind);
    });
  });

export const CategoryInputSchema = z.object({
  name: NameSchema,
  color: CategoryColorSchema,
  icon: IconSchema.nullable().transform((s) => (s ? s : undefined)),
});

export const AccountInputSchema = z
  .object({
    name: NameSchema,
    group: AccountGroupSchema,
    currency: CurrencySchema,
    openingBalance: MoneySchema.default(0),
    note: optionalText(1000),
  })
  .refine((a) => a.group !== "active" || a.currency === "UAH", {
    message: "Accounts in the Active group must be in UAH",
    path: ["currency"],
  });

/** setActualBalance: the user enters the NEW actual balance; the server stores delta = new − current. */
export const SetActualBalanceInputSchema = z.object({
  accountId: IdSchema,
  date: DateSchema,
  newBalance: MoneySchema,
  note: optionalText(1000),
});

/** createTransfer / updateTransfer. `toAmount` may be omitted when both accounts share a currency. */
export const TransferInputSchema = z
  .object({
    date: DateSchema,
    fromAccountId: IdSchema,
    toAccountId: IdSchema,
    fromAmount: PositiveMoneySchema,
    toAmount: PositiveMoneySchema.nullable().optional(),
    note: optionalText(1000),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  });

/** createDebt / updateDebt. Debts are a separate tracker: no account, no balance effect. */
export const DebtInputSchema = z
  .object({
    direction: DebtDirectionSchema,
    counterparty: CounterpartySchema,
    date: DateSchema,
    amount: PositiveMoneySchema,
    currency: CurrencySchema,
    dueDate: DateSchema.nullable().optional(),
    note: optionalText(1000),
  })
  .refine((d) => !d.dueDate || d.dueDate >= d.date, {
    message: "The due date cannot be before the debt date",
    path: ["dueDate"],
  });

/**
 * addDebtRepayment: `amount` in the debt currency, at most the outstanding amount. `accountId` (optional)
 * is where the money arrived / left; `accountAmount` = that amount in the account's currency, required
 * when it differs from the debt currency.
 */
export const DebtRepaymentInputSchema = z.object({
  date: DateSchema,
  amount: PositiveMoneySchema,
  accountId: IdSchema.nullable().optional(),
  accountAmount: PositiveMoneySchema.nullable().optional(),
  note: optionalText(1000),
});

/**
 * Investments page "Add deposit / withdrawal". With `linkedAccountId` (one of your accounts) it is stored
 * as a Transfer (money really moves; `linkedAmount` = what left / arrived there, needed when currencies
 * differ); without it, as an InvestmentFlow (outside money, e.g. before tracking).
 */
export const InvestmentFlowInputSchema = z.object({
  accountId: IdSchema,
  kind: z.enum(["deposit", "withdrawal"]),
  date: DateSchema,
  amount: PositiveMoneySchema,
  linkedAccountId: IdSchema.nullable().optional(),
  linkedAmount: PositiveMoneySchema.nullable().optional(),
  note: optionalText(1000),
});

/** "Update value": the investment account's market value on `date` (absolute). */
export const ValuationInputSchema = z.object({
  accountId: IdSchema,
  date: DateSchema,
  value: MoneySchema.refine((n) => n >= 0, "The value cannot be negative"),
  note: optionalText(1000),
});

/** updateSettings: a partial patch; the merged result is validated in full. */
export const SettingsInputSchema = z.object({
  tax: z.object(taxSettingsShape).partial().optional(),
  defaultActiveAccountId: IdSchema.optional(),
});

export type IncomeInput = z.input<typeof IncomeInputSchema>;
export type ExpenseInput = z.input<typeof ExpenseInputSchema>;
export type TaxPaymentInput = z.input<typeof TaxPaymentInputSchema>;
export type CategoryInput = z.input<typeof CategoryInputSchema>;
export type AccountInput = z.input<typeof AccountInputSchema>;
export type SetActualBalanceInput = z.input<typeof SetActualBalanceInputSchema>;
export type TransferInput = z.input<typeof TransferInputSchema>;
export type SettingsInput = z.input<typeof SettingsInputSchema>;
export type DebtInput = z.input<typeof DebtInputSchema>;
export type DebtRepaymentInput = z.input<typeof DebtRepaymentInputSchema>;
export type InvestmentFlowInput = z.input<typeof InvestmentFlowInputSchema>;
export type ValuationInput = z.input<typeof ValuationInputSchema>;

// ------------------------------------------------------------------ compile-time sync checks

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type _SchemaTypeChecks = [
  Assert<Equals<z.output<typeof AccountSchema>, Account>>,
  Assert<Equals<z.output<typeof IncomeSchema>, Income>>,
  Assert<Equals<z.output<typeof CategorySchema>, Category>>,
  Assert<Equals<z.output<typeof ExpenseSchema>, Expense>>,
  Assert<Equals<z.output<typeof TransferSchema>, Transfer>>,
  Assert<Equals<z.output<typeof AdjustmentSchema>, Adjustment>>,
  Assert<Equals<z.output<typeof DebtRepaymentSchema>, DebtRepayment>>,
  Assert<Equals<z.output<typeof DebtSchema>, Debt>>,
  Assert<Equals<z.output<typeof InvestmentFlowSchema>, InvestmentFlow>>,
  Assert<Equals<z.output<typeof ValuationSchema>, Valuation>>,
  Assert<Equals<z.output<typeof TaxSettingsSchema>, TaxSettings>>,
  Assert<Equals<z.output<typeof SettingsSchema>, Settings>>,
  Assert<Equals<z.output<typeof RatesCacheSchema>, RatesCache>>,
  Assert<Equals<z.output<typeof ExportFileSchema>, ExportFile>>,
];

// ------------------------------------------------------------------ helpers

/** zod error → { "path.to.field": ["message", …] } (root errors under "_"). */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** One-line summary of a zod error, e.g. for corrupt-file messages. */
export function zodErrorSummary(error: z.ZodError, max = 3): string {
  const parts = error.issues.slice(0, max).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
  const more = error.issues.length > max ? ` (+${error.issues.length - max} more)` : "";
  return parts.join("; ") + more;
}
