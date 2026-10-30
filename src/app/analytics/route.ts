import type { NextRequest } from "next/server";

/** The period / category params Spendings understands; anything else from an old Analytics link is dropped. */
const KEPT_PARAMS = ["period", "from", "to", "category"] as const;

/** GET /analytics → /expenses: Analytics was merged into Spendings (the "By category" breakdown). Old links keep working. */
export function GET(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/expenses";
  target.search = "";
  for (const key of KEPT_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return Response.redirect(target, 307);
}
