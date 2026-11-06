@AGENTS.md

## Project conventions

- **Data.** Data lives in `./data` (git-ignored, the user's REAL finances) or in `$BUDGET_DATA_DIR`.
  Never write test or demo data to `./data`. For manual runs use
  `BUDGET_DATA_DIR=$(mktemp -d) pnpm start -p 3901`; `pnpm e2e` uses `./.e2e-data` (git-ignored, wiped each run).
- **Server boundary.** All file I/O, NBU calls and repositories live in `src/server/**`, and every file
  there starts with `import "server-only"`. `src/lib/**` must stay pure and isomorphic: no Node or Next
  imports, unit tested.
- **Money.**
  - Amounts are stored as major units with at most 2 decimals.
  - Do ALL arithmetic through `@/lib/money` (`toMinor`/`fromMinor`, `sumMoney`, `convertToUah`,
    `percentOf`, which uses basis points). It works in integer minor units with HALF-UP rounding.
  - Never add floats.
  - Display with `formatMoney(amount, currency)` (uk-UA, e.g. `41 230,50 ₴`) and `formatRate(rate)`.
- **Dates.**
  - Dates are `YYYY-MM-DD` strings; helpers are in `@/lib/dates` and `@/lib/periods`.
  - "Today" is `todayKyiv()`, computed on the server and passed to client components as a prop.
    Never call `new Date()` while a client component renders.
- **Pages.**
  - Read data only through `src/server/queries.ts` loaders. Each one starts with `await connection()`,
    which keeps every page dynamic (ƒ).
  - `params` and `searchParams` are Promises (`PageProps<"/route">`).
- **Mutations.**
  - Use Server Actions in `src/server/actions/*.ts` (`"use server"`). Each one is a thin wrapper:
    a service in `src/server/services/*` validates with zod and enforces integrity, then the action calls
    `revalidatePath("/", "layout")`.
  - Actions return `ActionResult<T>` = `{ ok: true, data } | { ok: false, error, fieldErrors? }`.
    Call them from client components inside `useTransition`.
- **Tax logic.** Tax logic is `@/lib/tax/{rules,engine,deadlines}`, built from `research/tax-rules.md`.
  Only freelance income is taxable.
- **UI.**
  - Use shadcn/ui on the Radix base (`asChild`). The form primitive is `field`.
  - The root layout's `<main>` already provides the page container (max-w-7xl, padding, `gap-6`): a page
    returns `<><PageHeader … /> …<SectionCard>s</>`. Reuse `src/components/shared/*` (Money, StatCard,
    PageHeader, SectionCard, EmptyState, pickers, badges) and `src/components/forms/*` (form dialogs).
  - Charts use the shadcn `chart` component with category colors from `@/lib/categories`
    (`categoryColorVar`).
- **Gates.** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before finishing.
  `next build` does not lint or test.
