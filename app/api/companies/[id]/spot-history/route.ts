import { NextResponse } from "next/server";
import { apiGet } from "@/lib/market-api";
export const dynamic = "force-dynamic";

/**
 * Daily close of the spot token for one company, proxied from the API.
 *
 * A sibling of price-history rather than part of it: the two measure
 * different things, and the chart asks for whichever one the reader has
 * selected rather than fetching both on every load.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return NextResponse.json({ message: "Invalid company" }, { status: 400 });
  }
  const days = Number(new URL(request.url).searchParams.get("days"));
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? Math.trunc(days) : 90;
  try {
    return NextResponse.json(await apiGet(`/external/precap/companies/${encodeURIComponent(slug)}/spot-history?days=${window}`), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Spot history is temporarily unavailable. Please try again." }, { status: 502 });
  }
}
