import { NextResponse } from "next/server";
import { apiGet } from "@/lib/market-api";
export const dynamic = "force-dynamic";

/**
 * Reference price over time for one company.
 *
 * Under [id] beside the sibling routes because Next allows one dynamic segment
 * name per path level; the parameter is a slug and is destructured to that.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return NextResponse.json({ message: "Invalid company" }, { status: 400 });
  }
  const days = Number(new URL(request.url).searchParams.get("days") ?? 90);
  const window = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 90;
  try {
    return NextResponse.json(await apiGet(`/external/precap/companies/${encodeURIComponent(slug)}/history?days=${window}`), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Price history is temporarily unavailable. Please try again." }, { status: 502 });
  }
}
