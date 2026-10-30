import { BriefcaseBusiness, HandCoins, Handshake, LayoutDashboard, ReceiptText, Settings, TrendingUp, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Short description (tooltips / mobile). */
  description: string;
}

/** Main navigation (sidebar). Settings is rendered separately in the sidebar footer. */
export const NAV_ITEMS: readonly NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard, description: "Balances, this month, recent activity" },
  { title: "Spendings", href: "/expenses", icon: ReceiptText, description: "Expenses by category" },
  { title: "Income", href: "/income", icon: HandCoins, description: "Salary and freelance income" },
  { title: "Freelancer", href: "/freelance", icon: BriefcaseBusiness, description: "ФОП income and taxes" },
  { title: "Accounts", href: "/accounts", icon: Wallet, description: "Balances and transfers" },
  { title: "Investments", href: "/investments", icon: TrendingUp, description: "IBKR and bank deposits: value and gain" },
  { title: "Debts", href: "/debts", icon: Handshake, description: "Money you lent and borrowed" },
];

export const SETTINGS_ITEM: NavItem = {
  title: "Settings",
  href: "/settings",
  icon: Settings,
  description: "Taxes, categories, data",
};

/** Active when the path equals the item or is nested below it ("/" only matches exactly). */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
