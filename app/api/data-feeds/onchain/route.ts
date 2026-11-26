import { NextResponse, type NextRequest } from "next/server";
import { onchainState } from "@/lib/data-feeds";

export const dynamic = "force-dynamic";

/**
 * What PreIpoPriceOracle holds for each asset: latest round, config and
 * staleness, read over ORACLE_RPC_URL. Until ORACLE_ADDRESS is set this
 * answers { deployed: false } with the commands that deploy and feed it.
 * ?slug= narrows the assets to one.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  try {
    const state = await onchainState();
    const body = state.deployed && slug ? { ...state, assets: state.assets.filter((asset) => asset.slug === slug) } : state;
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "The oracle could not be read right now." }, { status: 502 });
  }
}
