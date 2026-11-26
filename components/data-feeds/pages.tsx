"use client";

import { MarketHeader } from "@/components/market-header";
import { ModeSwitch } from "@/components/view-mode";
import { ProShell } from "@/components/pro/pro-shell";
import { useProData } from "@/components/pro/pro-kit";
import { FeedsIndex } from "./feeds-index";
import { FeedDetail } from "./feed-detail";

/** The data-feeds pages in Lite (top bar) and Pro (shell with sidebar). */

function ProFrame({ children }: { children: React.ReactNode }) {
  const data = useProData();
  return <ProShell active="data-feeds" data={data}>{children}</ProShell>;
}

export function DataFeedsPage() {
  return <ModeSwitch
    lite={<div className="app-shell"><MarketHeader view="data-feeds" /><FeedsIndex variant="lite" /></div>}
    pro={<ProFrame><FeedsIndex variant="pro" /></ProFrame>} />;
}

export function DataFeedPage({ slug }: { slug: string }) {
  return <ModeSwitch
    lite={<div className="app-shell"><MarketHeader view="data-feeds" /><FeedDetail slug={slug} variant="lite" /></div>}
    pro={<ProFrame><FeedDetail slug={slug} variant="pro" /></ProFrame>} />;
}
