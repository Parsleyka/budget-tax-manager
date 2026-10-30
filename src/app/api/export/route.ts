import { todayKyiv } from "@/lib/dates";
import { exportData } from "@/server/services/data-transfer";

/** GET /api/export → all data (+ NBU cache) as one JSON file download (ExportFile). */
export async function GET() {
  try {
    const payload = await exportData();
    return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="budget-export-${todayKyiv()}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
