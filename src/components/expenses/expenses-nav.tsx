"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useEffect, useRef, useTransition, type ReactNode } from "react";
import { applyParamPatch, type ParamPatch } from "./expense-list-model";

export interface NavigateOptions {
  /** Keep `?limit=` (sort changes, "Show more"). Filter changes reset it by default. */
  keepLimit?: boolean;
  /** Runs inside the navigation transition — put `useOptimistic` setters here. */
  optimistic?: () => void;
}

interface ExpensesNav {
  /** A filter/sort/page-size navigation is in flight (the server is re-rendering the page). */
  pending: boolean;
  navigate: (patch: ParamPatch, options?: NavigateOptions) => void;
}

const ExpensesNavContext = createContext<ExpensesNav | null>(null);

/**
 * URL state for the Spendings page: every filter lives in the search params, so the Server Component
 * loader re-runs on change. One shared transition lets the list dim while any control is updating.
 * Renders no DOM, so its children stay direct children of the page container.
 */
export function ExpensesNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The query we last asked for. Two quick changes (e.g. a category click while the debounced search
  // fires) must build on each other, not on the URL that has not caught up yet.
  const latest = useRef<string | null>(null);

  useEffect(() => {
    latest.current = searchParams.toString();
  }, [searchParams]);

  function navigate(patch: ParamPatch, options: NavigateOptions = {}) {
    const base = latest.current ?? searchParams.toString();
    const query = applyParamPatch(base, patch, { keepLimit: options.keepLimit });
    latest.current = query;
    startTransition(() => {
      options.optimistic?.();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return <ExpensesNavContext value={{ pending, navigate }}>{children}</ExpensesNavContext>;
}

export function useExpensesNav(): ExpensesNav {
  const nav = use(ExpensesNavContext);
  if (!nav) throw new Error("useExpensesNav must be used inside <ExpensesNavProvider>");
  return nav;
}
