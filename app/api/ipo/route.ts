import { NextResponse } from "next/server";
import { postIpo } from "@/lib/post-ipo";

export const dynamic = "force-dynamic";

/** Companies that have listed, with PreStocks' and OpenStocks' post-IPO discounts. */
export async function GET() {
  try {
    return NextResponse.json({ fetchedAt: new Date().toISOString(), companies: await postIpo() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Post-IPO data is temporarily unavailable." }, { status: 502 });
  }
}
