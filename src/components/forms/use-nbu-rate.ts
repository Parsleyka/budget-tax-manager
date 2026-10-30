"use client";

import { useEffect, useState } from "react";
import { isValidDate } from "@/lib/dates";
import type { Currency } from "@/lib/types";
import type { RateResult } from "@/server/nbu/rates";

export type { RateResult };

/**
 * idle        — UAH, disabled, or no valid date (nothing to fetch)
 * loading     — debounce / request in flight
 * ok          — official NBU rate for that exact date
 * stale       — only an older cached rate exists (NBU hasn't published / is down) → ask for a manual rate
 * unavailable — 503 / network error → ask for a manual rate
 * error       — bad request (400) or unexpected response
 */
export type NbuRateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; result: RateResult }
  | { status: "stale"; result: RateResult }
  | { status: "unavailable"; error: string }
  | { status: "error"; error: string };

/** Official rates never change once published, so successful lookups are memoized per session. */
const officialRates = new Map<string, RateResult>();

function isRateResult(v: unknown): v is RateResult {
  return typeof v === "object" && v !== null && typeof (v as RateResult).rate === "number" && typeof (v as RateResult).stale === "boolean";
}

/**
 * Live NBU rate for (currency, date) via `GET /api/rates` — debounced (default 300 ms) and aborted
 * when the inputs change or the component unmounts. State is set only in async callbacks
 * (react-hooks/set-state-in-effect).
 */
export function useNbuRate(currency: Currency, date: string | null | undefined, enabled = true, delayMs = 300): NbuRateState {
  const key = enabled && currency !== "UAH" && date && isValidDate(date) ? `${currency}|${date}` : null;
  const [state, setState] = useState<{ key: string; value: NbuRateState } | null>(null);

  useEffect(() => {
    if (!key || officialRates.has(key)) return;
    const [cur, d] = key.split("|");
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rates?currency=${encodeURIComponent(cur)}&date=${encodeURIComponent(d)}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        const body: unknown = await res.json().catch(() => null);
        if (ctrl.signal.aborted) return;
        if (res.ok && isRateResult(body)) {
          if (!body.stale) officialRates.set(key, body);
          setState({ key, value: body.stale ? { status: "stale", result: body } : { status: "ok", result: body } });
        } else {
          const message =
            typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
              ? (body as { error: string }).error
              : `Rate request failed (${res.status})`;
          setState({ key, value: res.status === 503 ? { status: "unavailable", error: message } : { status: "error", error: message } });
        }
      } catch {
        if (ctrl.signal.aborted) return;
        setState({ key, value: { status: "unavailable", error: "Could not reach the rates service" } });
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, delayMs]);

  if (!key) return { status: "idle" };
  const cached = officialRates.get(key);
  if (cached) return { status: "ok", result: cached };
  if (!state || state.key !== key) return { status: "loading" };
  return state.value;
}

/** The usable rate from a state: the official rate when ok, otherwise null. UAH → 1. */
export function officialRate(currency: Currency, state: NbuRateState): number | null {
  if (currency === "UAH") return 1;
  return state.status === "ok" ? state.result.rate : null;
}
