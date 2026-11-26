import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProOverview } from "@/components/pro/pro-overview";
import { parseViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";

export const metadata: Metadata = { title: "Market Overview | Openmarkets Pro" };

/** The institutional overview exists only in Pro; Lite readers go home. */
export default async function OverviewPage() {
  if (parseViewMode((await cookies()).get(VIEW_MODE_COOKIE)?.value) !== "pro") { redirect("/"); }
  return <ProOverview />;
}
