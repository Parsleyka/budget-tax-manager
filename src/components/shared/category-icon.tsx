import {
  Baby,
  Banknote,
  Book,
  Briefcase,
  Bus,
  Car,
  CircleEllipsis,
  Clapperboard,
  Coffee,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandHeart,
  HeartPulse,
  House,
  Landmark,
  Music,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Popcorn,
  Receipt,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  TrainFront,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { createElement } from "react";
import type { CategoryIconName } from "@/lib/categories";

/**
 * Static map of the curated category icons (`CATEGORY_ICONS` in `@/lib/categories`).
 * Importing `icons` from lucide-react would ship every icon to the browser, so only these are
 * bundled; any other stored name renders the `Tag` fallback.
 */
export const CATEGORY_ICON_COMPONENTS: Record<CategoryIconName, LucideIcon> = {
  ShoppingCart,
  UtensilsCrossed,
  Coffee,
  Bus,
  Car,
  Fuel,
  TrainFront,
  House,
  Zap,
  Wifi,
  Smartphone,
  HeartPulse,
  Pill,
  ShoppingBag,
  Shirt,
  Popcorn,
  Clapperboard,
  Music,
  Gamepad2,
  Repeat,
  Plane,
  GraduationCap,
  Book,
  Gift,
  HandHeart,
  Landmark,
  Receipt,
  Dumbbell,
  PawPrint,
  Baby,
  Scissors,
  Sparkles,
  Wrench,
  Briefcase,
  PiggyBank,
  Wallet,
  Banknote,
  Tag,
  CircleEllipsis,
};

/** lucide component for a stored icon name (falls back to `Tag`). */
export function categoryIconComponent(name: string | null | undefined): LucideIcon {
  return (name && (CATEGORY_ICON_COMPONENTS as Record<string, LucideIcon>)[name]) || Tag;
}

export interface CategoryIconProps extends Omit<LucideProps, "name"> {
  /** Stored `category.icon` (lucide PascalCase name). */
  name: string | null | undefined;
}

/** Renders a category's lucide icon by name. Decorative by default (aria-hidden). */
export function CategoryIcon({ name, ...props }: CategoryIconProps) {
  return createElement(categoryIconComponent(name), { "aria-hidden": true, ...props });
}
