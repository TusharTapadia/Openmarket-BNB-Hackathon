import { NextResponse } from "next/server";
import { apiGet, normalizeInsights } from "@/lib/market-api";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ message: "Invalid company" }, { status: 400 });
  try {
    return NextResponse.json(normalizeInsights(await apiGet(`/external/companies/${encodeURIComponent(id)}/insights?newsLimit=20`)),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Company updates are temporarily unavailable. Please try again." }, { status: 502 });
  }
}
