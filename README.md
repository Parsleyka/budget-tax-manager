# budget-tax-manager

A local, single-user personal budget app for a Ukrainian who is both a salaried employee and a
**ФОП (FOP) on single tax group 3**. It runs on your own machine and keeps everything in plain JSON files.
Nothing is sent anywhere except requests for official exchange rates to the National Bank of Ukraine (NBU) API.

What it does:

- **NBU rates.** Shows today's official USD/UAH, EUR/UAH and PLN/UAH rates, the change from the previous day,
  and tomorrow's rate once the NBU publishes it.
- **Income.** Records salary (net, UAH) and freelance income (USD / EUR / PLN / UAH). Freelance income is
  converted at the NBU rate for the date the money was credited.
- **Freelancer tab.**
  - Freelance income before and after conversion.
  - Single tax (5%, or 3% for VAT payers), military levy and ЄСВ for any months you select.
  - Annual income-limit tracking.
  - Quarterly declaration figures with filing and payment deadlines.
  - Tax payments recorded against what is due.
  - Currency sales compared with the NBU rate.
- **Balances.**
  - Active balance: your main UAH account.
  - Frozen balance: Freelancer, Investments, Deposits and Other.
  - Net worth across both.
- **Budgeting.** Spending by category, category management, transfers between accounts, balance
  corrections, and analytics for any period.
- **Investments.** IBKR and any other investment account: deposits and withdrawals (from your accounts
  as real transfers, or "outside" money such as deposits made before you started tracking), manual
  value updates, and the overall gain (value − net deposited) with a value-vs-deposited chart. The value
  counts in the Frozen balance. Value updates are absolute, so adding older deposits later changes only
  the gain, never the value.
- **Debts.** A separate tracker for money you lent and borrowed, with return-by dates and partial repayments.
  - Overdue and soon-due debts are flagged on the Debts page, on the Overview and as a badge in the sidebar.
  - Debts never change account balances (Active / Frozen), net worth, income, spending or analytics.

Tax rules are versioned tables in `src/lib/tax/`, verified for 2024–2026. For later years the app reuses
the last known values and warns you about it.

## Requirements

- Node.js 24
- pnpm 12

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Production mode:

```bash
pnpm build
pnpm start          # or: pnpm start -p 3901
```

## Data location

All data lives in **`./data/`** in the project folder. This folder is git-ignored, because it holds your
personal finance data.

To keep the data somewhere else, set **`BUDGET_DATA_DIR`**:

```bash
BUDGET_DATA_DIR=~/Documents/budget-data pnpm start
```

| File | Contents |
|---|---|
| `accounts.json`, `incomes.json`, `expenses.json`, `categories.json`, `transfers.json`, `adjustments.json`, `debts.json` (repayments are stored inside each debt), `investment-flows.json`, `valuations.json` | `{ "version": 1, "items": [...] }` |
| `settings.json` | `{ "version": 1, "settings": {...} }` |
| `rates.json` | Permanent cache of NBU rates. Safe to delete; it is rebuilt on demand. |
| `*.json.bak` | Copy of each file from before its most recent write. |
| `backups/<timestamp>/` | Full copy of the data, made automatically before every import. |

How the files are handled:

- **First run.** Missing files are created with default accounts, categories and settings. No sample
  transactions are added.
- **Writes are atomic.** Each write goes to a temporary file that is then renamed into place, and writes
  to the same file run one at a time.
- **Bad files are never overwritten.** If a data file is corrupt or fails validation, the app shows which
  file is affected and stops. Fix the file, or restore it from its `.bak` copy.
- **Export and import.** Use Settings to export everything as a single JSON file, or to import one.
  Importing replaces all data, after making a backup.

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build. Every page route must show as `ƒ` (dynamic) in the route table. |
| `pnpm typecheck` | Generates route types (`next typegen`), then runs `tsc --noEmit` |
| `pnpm lint` | ESLint. `next build` no longer lints, so run this yourself. |
| `pnpm test` | Unit tests (Vitest) for `src/lib/**`, the JSON store, the NBU client and the action services |
| `pnpm e2e` | Playwright end-to-end tests. Builds the app, starts it on port 3910 with `BUDGET_DATA_DIR=./.e2e-data` (git-ignored, wiped before every run) and walks through the main flows: every page without console errors (also dark mode at 390 px), salary → Active balance, USD freelance income at the live NBU rate, cross-currency transfer, IBKR balance update, spendings (add/edit/delete, filters, analytics), ФОП taxes (5% + 1%, ЄСВ employed vs minimum, recording a payment), categories, export, persistence. Needs internet access for bank.gov.ua. `pnpm e2e:only` skips the build. |

Run lint, typecheck and tests before you commit. `next build` runs none of them.

Never run manual or e2e experiments against `./data`. Point `BUDGET_DATA_DIR` at a temporary folder instead:

```bash
BUDGET_DATA_DIR=$(mktemp -d) pnpm start -p 3901
```

Architecture notes for contributors and coding agents are in `AGENTS.md` and `CLAUDE.md`.
