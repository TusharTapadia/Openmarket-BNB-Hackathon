import { NextResponse } from "next/server";
import { valuationCompanies } from "@/lib/offchain";
import { COVERAGE_COMPANIES } from "@/lib/market-coverage/shared";

export const dynamic = "force-dynamic";

/** The covered companies as AllocationsX lists them, with share counts, for the Lite valuation calculator. */
export async function GET() {
  try {
    return NextResponse.json(await valuationCompanies(COVERAGE_COMPANIES.map(({ slug, name }) => ({ slug, name }))), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "AllocationsX market data is temporarily unavailable." }, { status: 502 });
  }
}
