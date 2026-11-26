import { NextResponse, type NextRequest } from "next/server";
import { feedDetail, isInterval } from "@/lib/data-feeds";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One data feed: the aggregate, every source behind it, and its history at the
 * requested interval (?interval=1s|1m|5m|1h|24h, default 1m).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/data-feeds/[slug]">) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return NextResponse.json({ message: "Invalid feed" }, { status: 400 });
  }
  const requested = request.nextUrl.searchParams.get("interval");
  const interval = isInterval(requested) ? requested : "1m";
  try {
    const detail = await feedDetail(slug, interval);
    if (!detail) { return NextResponse.json({ message: "No feed for this asset" }, { status: 404 }); }
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "This feed is temporarily unavailable. Please try again." }, { status: 502 });
  }
}
