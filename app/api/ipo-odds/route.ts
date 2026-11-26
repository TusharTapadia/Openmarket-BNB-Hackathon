import { NextResponse } from "next/server";
import { ipoOdds } from "@/lib/ipo-odds";

export const dynamic = "force-dynamic";

/** Kalshi's expected S-1 date and latest priced deadline for each covered company. */
export async function GET() {
  try {
    return NextResponse.json(await ipoOdds(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "IPO odds are temporarily unavailable." }, { status: 502 });
  }
}
