import type { NextRequest } from "next/server";
import { todayKyiv } from "@/lib/dates";
import { getRate, InvalidRateRequestError, RateUnavailableError } from "@/server/nbu/rates";

/**
 * GET /api/rates?currency=USD|EUR|UAH&date=YYYY-MM-DD  (date defaults to today, Kyiv)
 * 200 → RateResult { currency, date, rate, effectiveDate, source, stale }
 * 400 → { error } bad currency/date · 503 → { error } NBU unavailable and nothing cached
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const currency = (params.get("currency") ?? "").toUpperCase();
  const date = params.get("date") ?? todayKyiv();
  const headers = { "cache-control": "no-store" };
  try {
    const result = await getRate(currency as "USD", date);
    return Response.json(result, { headers });
  } catch (err) {
    if (err instanceof InvalidRateRequestError) return Response.json({ error: err.message }, { status: 400, headers });
    if (err instanceof RateUnavailableError) return Response.json({ error: err.message }, { status: 503, headers });
    console.error("[budget] /api/rates failed", err);
    return Response.json({ error: "Unexpected error" }, { status: 500, headers });
  }
}
