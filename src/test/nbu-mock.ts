/** Mocked NBU HTTP API for tests: install with vi.stubGlobal("fetch", nbu.fetch). */
import { vi } from "vitest";

type Responder = (url: URL) => string | Error | "hang" | null;

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const isoFromCompact = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;

/** Body exactly like the single-date endpoint (CRLF + odd whitespace). */
export function dayBody(cc: string, isoDate: string, rate: number): string {
  return `[\r\n{ \r\n"r030":840,"txt":"Долар США","rate":${rate},"cc":"${cc}","exchangedate":"${ddmmyyyy(isoDate)}","special":"N"\r\n }\r\n]`;
}

export const WRONG_DATE_BODY = "[\r\n{ \r\nWrong date format\r\n }\r\n]";

export function rangeBody(cc: string, rows: { date: string; rate: number; units?: number; calcdate?: string }[]): string {
  const items = rows.map((r) => {
    const units = r.units ?? 1;
    return `{ \r\n"exchangedate":"${ddmmyyyy(r.date)}","r030":840,"cc":"${cc}","txt":"x","enname":"x","rate":${r.rate * units},"units":${units},"rate_per_unit":${r.rate},"group":"1","calcdate":"${ddmmyyyy(r.calcdate ?? r.date)}","special":"N"\r\n }`;
  });
  return `[\r\n${items.join("\r\n,")}\r\n]`;
}

/**
 * Default world: published USD/EUR rates by date (single-date endpoint and range endpoint).
 * Unknown dates answer `[]`.
 */
export function createNbuMock(rates: Partial<Record<"USD" | "EUR" | "PLN", Record<string, number>>>) {
  const overrides: Responder[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    for (const o of overrides) {
      const r = o(url);
      if (r === "hang") {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        });
      }
      if (r instanceof Error) throw r;
      if (typeof r === "string") return new Response(r, { status: 200, headers: { "content-type": "application/json" } });
    }
    const cc = (url.searchParams.get("valcode") ?? "").toUpperCase() as "USD" | "EUR" | "PLN";
    const table = rates[cc] ?? {};
    if (url.pathname.endsWith("/exchange")) {
      const date = isoFromCompact(url.searchParams.get("date") ?? "");
      const rate = table[date];
      return new Response(rate ? dayBody(cc, date, rate) : "[]", { status: 200 });
    }
    if (url.pathname.endsWith("/exchange_site")) {
      const from = isoFromCompact(url.searchParams.get("start") ?? "");
      const to = isoFromCompact(url.searchParams.get("end") ?? "");
      const rows = Object.entries(table)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rate]) => ({ date, rate }));
      return new Response(rangeBody(cc, rows), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  return {
    fetch: fetchMock,
    /** Override: when `match(url)`, answer with a raw body, throw an Error (network), or hang until aborted. */
    when(match: (url: URL) => boolean, respond: string | Error | "hang") {
      overrides.push((url) => (match(url) ? respond : null));
    },
    calls: () => fetchMock.mock.calls.map((c) => String(c[0])),
  };
}
