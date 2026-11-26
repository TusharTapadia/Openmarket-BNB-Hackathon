"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MarketHeader } from "@/components/market-header";
import { ModeSwitch } from "@/components/view-mode";
import { IpoView } from "@/components/ipo-view";
import { ProShell } from "@/components/pro/pro-shell";
import { useProData } from "@/components/pro/pro-kit";
import { LISTED } from "@/lib/coverage-view";

/** Pre-IPO → IPO: issuer tokens of covered companies that have listed, against the public stock. */
export default function IpoPage() {
  // The selected company is read from ?company=, so the URL-reading parts sit in a Suspense boundary.
  return <Suspense fallback={null}>
    <ModeSwitch lite={<div className="app-shell"><MarketHeader view="ipo" /><IpoView variant="lite" /></div>} pro={<ProIpo />} />
  </Suspense>;
}

function ProIpo() {
  const data = useProData();
  // Highlight the sidebar entry for the company on screen; the page opens on the first listed one.
  const slug = useSearchParams().get("company") ?? Object.keys(LISTED)[0];
  return <ProShell active={`ipo:${slug}`} data={data}><IpoView variant="pro" /></ProShell>;
}
