"use client";

import { useEffect, useState } from "react";

/**
 * Whether an element is at least `minRem` wide (tracked with a ResizeObserver). Returns a callback ref
 * for the element and `null` until the first measurement — during SSR and hydration — so callers can
 * keep rendering both CSS-switched layouts until then and afterwards mount only the visible one
 * (halving the DOM of long lists).
 */
export function useContainerWide<T extends HTMLElement = HTMLDivElement>(
  minRem: number,
): [ref: (el: T | null) => void, wide: boolean | null] {
  const [el, setEl] = useState<T | null>(null);
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      setWide(width >= minRem * rootPx);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, minRem]);
  return [setEl, wide];
}
