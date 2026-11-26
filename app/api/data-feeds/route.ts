import { NextResponse } from "next/server";
import { feedAssets, feedSummary } from "@/lib/data-feeds";

export const dynamic = "force-dynamic";
/** A cold read computes every asset's derived price; give it room on serverless hosts. */
export const maxDuration = 60;

/**
 * Every data feed: the aggregated price per asset, its sources, spread and
 * recent samples. Each read also samples the feeds (see lib/data-feeds.ts).
 */
export async function GET() {
  const feeds = await Promise.all(feedAssets().map((asset) => feedSummary(asset)));
  return NextResponse.json({ fetchedAt: new Date().toISOString(), feeds }, { headers: { "Cache-Control": "no-store" } });
}
