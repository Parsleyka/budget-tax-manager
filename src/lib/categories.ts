/**
 * Category colors + icons. Pure + isomorphic.
 *
 * The palette is the validated 8-slot categorical palette from the `dataviz` skill
 * (reference instance), with a separately stepped dark-mode value per hue. Both sets pass the
 * validator (lightness band, chroma floor, adjacent CVD ΔE ≥ 8, normal-vision ΔE ≥ 15).
 * Light-mode aqua/yellow/magenta sit below 3:1 on the light surface, so charts MUST also show
 * visible labels or a table view (the analytics page already has category tables).
 *
 * Rules (dataviz skill):
 * - Assign hues in the fixed slot order, never generate new hues. More than 8 series in one
 *   chart → fold the tail into "Other" (gray).
 * - Color follows the entity (the category's stored color), not its rank.
 * - Never use the series color for text; text stays in foreground/muted tokens.
 *
 * CSS: `src/app/globals.css` defines `--cat-<key>` for light and dark, so use
 * `categoryColorVar(category.color)` (→ "var(--cat-blue)") in style props / chart configs.
 */

export const CATEGORY_COLORS = {
  blue: { label: "Blue", light: "#2a78d6", dark: "#3987e5" },
  orange: { label: "Orange", light: "#eb6834", dark: "#d95926" },
  aqua: { label: "Aqua", light: "#1baf7a", dark: "#199e70" },
  yellow: { label: "Yellow", light: "#eda100", dark: "#c98500" },
  magenta: { label: "Magenta", light: "#e87ba4", dark: "#d55181" },
  green: { label: "Green", light: "#008300", dark: "#008300" },
  violet: { label: "Violet", light: "#6250d6", dark: "#9085e9" },
  red: { label: "Red", light: "#e34948", dark: "#e66767" },
  /** Neutral for "Other" / folded tails. Not a series hue. */
  gray: { label: "Gray", light: "#898781", dark: "#898781" },
} as const;

export type CategoryColorKey = keyof typeof CATEGORY_COLORS;

/** The 8 series hues in their validated (CVD-safe) order. */
export const CATEGORY_COLOR_ORDER = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
] as const satisfies readonly CategoryColorKey[];

export const CATEGORY_COLOR_KEYS = [...CATEGORY_COLOR_ORDER, "gray"] as const satisfies readonly CategoryColorKey[];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isCategoryColorKey(value: unknown): value is CategoryColorKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, value);
}

/** Valid stored category color: a palette key or a #rrggbb hex. */
export function isValidCategoryColor(value: unknown): value is string {
  return isCategoryColorKey(value) || (typeof value === "string" && HEX_RE.test(value));
}

/** CSS color for a stored category color: palette key → `var(--cat-key)`, hex → as is. */
export function categoryColorVar(color: string): string {
  if (isCategoryColorKey(color)) return `var(--cat-${color})`;
  if (HEX_RE.test(color)) return color;
  return "var(--cat-gray)";
}

/** Raw hex for a palette key in a given mode (for canvas/SVG exports). */
export function categoryColorHex(color: string, mode: "light" | "dark" = "light"): string {
  if (isCategoryColorKey(color)) return CATEGORY_COLORS[color][mode];
  if (HEX_RE.test(color)) return color;
  return CATEGORY_COLORS.gray[mode];
}

/**
 * Chart color assignment for a set of categories shown together. Each category keeps its own
 * stored color unless another category earlier in `items` already took that hue; then it gets
 * the first unused hue in slot order. With more than 8 items the caller must fold the tail into
 * "Other" first (use `foldToOther`). Pass items in a STABLE order (e.g. category creation order),
 * not by rank, so colors don't jump when filters change.
 */
export function assignChartColors(items: ReadonlyArray<{ id: string; color: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const pending: string[] = [];
  for (const item of items) {
    if (item.color === "gray" || !used.has(item.color)) {
      out.set(item.id, item.color);
      if (item.color !== "gray") used.add(item.color);
    } else {
      pending.push(item.id);
    }
  }
  for (const id of pending) {
    const free = CATEGORY_COLOR_ORDER.find((k) => !used.has(k));
    if (free) {
      used.add(free);
      out.set(id, free);
    } else {
      out.set(id, "gray");
    }
  }
  return out;
}

/**
 * Keep the first `max − 1` rows (already sorted by the caller, e.g. by amount) and fold the rest
 * into one "Other" row built by `makeOther(rest)`. Returns rows unchanged when they fit.
 */
export function foldToOther<T>(rows: readonly T[], max: number, makeOther: (rest: T[]) => T): T[] {
  if (rows.length <= max) return [...rows];
  const head = rows.slice(0, max - 1);
  return [...head, makeOther(rows.slice(max - 1))];
}

/** Icons offered in the category dialog (lucide-react export names). */
export const CATEGORY_ICONS = [
  "ShoppingCart",
  "UtensilsCrossed",
  "Coffee",
  "Bus",
  "Car",
  "Fuel",
  "TrainFront",
  "House",
  "Zap",
  "Wifi",
  "Smartphone",
  "HeartPulse",
  "Pill",
  "ShoppingBag",
  "Shirt",
  "Popcorn",
  "Clapperboard",
  "Music",
  "Gamepad2",
  "Repeat",
  "Plane",
  "GraduationCap",
  "Book",
  "Gift",
  "HandHeart",
  "Landmark",
  "Receipt",
  "Dumbbell",
  "PawPrint",
  "Baby",
  "Scissors",
  "Sparkles",
  "Wrench",
  "Briefcase",
  "PiggyBank",
  "Wallet",
  "Banknote",
  "Tag",
  "CircleEllipsis",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICONS)[number];

/** Pinned in Settings → Categories. An archived category is never treated as pinned (it keeps the flag for a restore). */
export function isPinned(category: { pinned?: boolean; archived: boolean }): boolean {
  return !!category.pinned && !category.archived;
}

/** Pinned categories first, then by name. */
export function sortCategories<T extends { name: string; pinned?: boolean; archived: boolean }>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || a.name.localeCompare(b.name));
}

/** Splits a list into pinned and the rest, keeping each part's order (for "Pinned" groups in pickers). */
export function splitPinned<T extends { pinned?: boolean; archived: boolean }>(categories: readonly T[]): { pinned: T[]; others: T[] } {
  return { pinned: categories.filter(isPinned), others: categories.filter((c) => !isPinned(c)) };
}

export interface SeedCategory {
  name: string;
  color: CategoryColorKey;
  icon: CategoryIconName;
  systemKey?: "taxes";
}

/** Seeded on first run (SPEC §2). 14 hued categories share 8 hues, so some repeat by design. */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { name: "Groceries", color: "blue", icon: "ShoppingCart" },
  { name: "Restaurants & Cafés", color: "orange", icon: "UtensilsCrossed" },
  { name: "Transport", color: "aqua", icon: "Bus" },
  { name: "Housing & Utilities", color: "yellow", icon: "House" },
  { name: "Health", color: "magenta", icon: "HeartPulse" },
  { name: "Shopping", color: "green", icon: "ShoppingBag" },
  { name: "Entertainment", color: "violet", icon: "Popcorn" },
  { name: "Subscriptions", color: "red", icon: "Repeat" },
  { name: "Travel", color: "aqua", icon: "Plane" },
  { name: "Education", color: "violet", icon: "GraduationCap" },
  { name: "Gifts", color: "magenta", icon: "Gift" },
  { name: "Donations", color: "green", icon: "HandHeart" },
  { name: "Taxes", color: "red", icon: "Landmark", systemKey: "taxes" },
  { name: "Cash withdrawal", color: "green", icon: "Banknote" },
  { name: "Other", color: "gray", icon: "CircleEllipsis" },
];
