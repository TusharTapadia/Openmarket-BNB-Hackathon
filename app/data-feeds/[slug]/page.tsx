import type { Metadata } from "next";
import { DataFeedPage } from "@/components/data-feeds/pages";
import { feedAsset } from "@/lib/data-feeds";

export async function generateMetadata({ params }: PageProps<"/data-feeds/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const asset = feedAsset(slug);
  return { title: `${asset ? `${asset.name} / USD` : "Data feed"} | Openmarkets` };
}

export default async function Page({ params }: PageProps<"/data-feeds/[slug]">) {
  const { slug } = await params;
  return <DataFeedPage slug={slug} />;
}
