import { NextResponse, type NextRequest } from "next/server";
import { derivedPrice } from "@/lib/derived-price";

export const dynamic = "force-dynamic";
/** A cold read touches every venue and issuer feed; give it room on serverless hosts. */
export const maxDuration = 60;

/**
 * The derived price for one share of a company: every source normalised to one
 * share and weighted by trust × popularity. See lib/derived-price.ts for the
 * method. Read by the company page and by the on-chain oracle's keeper.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/derived-price/[slug]">) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return NextResponse.json({ message: "Invalid company" }, { status: 400 });
  }
  try {
    const result = await derivedPrice(slug);
    if (!result) { return NextResponse.json({ message: "Unknown company" }, { status: 404 }); }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "The derived price is temporarily unavailable. Please try again." }, { status: 502 });
  }
}
