/**
 * App-wide colors for the income/spending series, so salary, freelance and spending look the same on
 * every page (Overview, Income, Analytics). Validated adjacent pairs in light + dark (dataviz palette):
 * salary = slot 1 (blue), spending = slot 2 (orange), freelance = slot 3 (aqua). Net is a derived line
 * in ink so it never competes with a fourth hue.
 */
export const SERIES_COLORS = {
  salary: "var(--chart-1)",
  spending: "var(--chart-2)",
  freelance: "var(--chart-3)",
  net: "var(--foreground)",
} as const;
