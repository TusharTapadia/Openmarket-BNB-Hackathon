import type { Metadata } from "next";
import { DataFeedsPage } from "@/components/data-feeds/pages";

export const metadata: Metadata = {
  title: "Data feeds | Openmarkets",
  description: "Aggregated pre-IPO share prices from every source we read, and what the on-chain oracle holds.",
};

export default function Page() {
  return <DataFeedsPage />;
}
