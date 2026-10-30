/** UI labels for enums. Pure + isomorphic. (Account group / tax kind labels live in ./types.) */
import type { Currency, EsvMode, IncomeKind, RateSource } from "./types";

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  salary: "Salary",
  freelance: "Freelance",
};

export const CURRENCY_LABELS: Record<Currency, string> = {
  UAH: "Ukrainian hryvnia",
  USD: "US dollar",
  EUR: "Euro",
  PLN: "Polish złoty",
};

export const RATE_SOURCE_LABELS: Record<RateSource, string> = {
  nbu: "NBU",
  manual: "Manual",
};

export const ESV_MODE_LABELS: Record<EsvMode, string> = {
  employed: "Employed (employer pays ЄСВ)",
  minimum: "Minimum contribution",
  custom: "Custom base",
  exempt: "Exempt",
};

export const ESV_MODE_DESCRIPTIONS: Record<EsvMode, string> = {
  employed:
    "No own ЄСВ for months in which an employer paid ЄСВ for you of at least the minimum contribution " +
    "(Law 2464-VI art. 4 ч. 6 as amended by Law 4536-IX, in force 01.10.2025 — any employer; before that only a " +
    "main place of work qualified). Months outside the employment window or marked as not covered owe the full minimum.",
  minimum: "22% of the minimum wage every month (the legal floor).",
  custom: "22% of a self-chosen monthly base, clamped to [minimum wage, maximum base].",
  exempt: "No ЄСВ (pensioner, disability, military service, …).",
};
