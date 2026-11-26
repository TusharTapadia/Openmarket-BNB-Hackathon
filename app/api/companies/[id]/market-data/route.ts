import { NextResponse } from "next/server";
import { apiGet } from "@/lib/market-api";
export const dynamic = "force-dynamic";

/**
 * Market data for one company, proxied from the market data API.
 *
 * The detail page needs funding, perpetuals and issuers for a single slug, so
 * it asks for one company rather than filtering the whole set in the browser.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Named `id` to match the sibling insights route: Next.js requires one
  // dynamic segment name per path level, and this one is a slug.
  const { id: slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return NextResponse.json({ message: "Invalid company" }, { status: 400 });
  }
  try {
    return NextResponse.json(await apiGet(`/external/precap/companies/${encodeURIComponent(slug)}`), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Market data is temporarily unavailable. Please try again." }, { status: 502 });
  }
}
