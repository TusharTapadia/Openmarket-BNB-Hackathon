import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProScreener } from "@/components/pro/pro-screener";
import { parseViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";

export const metadata: Metadata = { title: "Screener | Openmarkets Pro" };

/** The Pro company screener; Lite's home page already is its screener. */
export default async function ScreenerPage() {
  if (parseViewMode((await cookies()).get(VIEW_MODE_COOKIE)?.value) !== "pro") { redirect("/"); }
  return <ProScreener />;
}
