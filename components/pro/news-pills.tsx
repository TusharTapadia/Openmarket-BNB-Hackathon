"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate, type CompanyInsights, type MarketData } from "@/app/data";
import { useRemoteData } from "@/hooks/use-market-data";
import type { CompanyView } from "@/lib/coverage-view";
import { Logo } from "./pro-shell";
import { SkeletonInline } from "@/components/skeleton";

type Headline = { id: string; title: string; url: string | null; source: string | null; date: string | null; company: CompanyView };

/**
 * Latest headlines across the covered companies, from each company's insights
 * feed, as a row of pills that scrolls sideways inside its own box.
 */
export function NewsPills({ companies }: { companies: CompanyView[] }) {
  const profiles = useRemoteData<MarketData>("/api/markets");
  const [headlines, setHeadlines] = useState<Headline[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ids = companies.flatMap((company) => {
    const profile = profiles.data?.companies.find((item) => item.slug === company.slug);
    return profile ? [`${company.slug}:${profile.id}`] : [];
  }).join(",");

  useEffect(() => {
    if (!ids) { return; }
    let active = true;
    void Promise.all(ids.split(",").map(async (pair) => {
      const [slug, id] = pair.split(":");
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(id)}/insights`, { cache: "no-store" });
        if (!response.ok) { return []; }
        const body = await response.json() as CompanyInsights;
        const company = companies.find((item) => item.slug === slug)!;
        return body.news.slice(0, 8).map((article) => ({ ...article, company }));
      } catch { return []; }
    })).then((lists) => {
      if (active) { setHeadlines(lists.flat().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 24)); }
    });
    return () => { active = false; };
    // `companies` changes identity on every poll; the ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.8, behavior: "smooth" });

  return <section className="p-news-row" aria-label="Latest company news">
    <span className="p-lbl p-news-label">Latest news</span>
    <button type="button" className="p-news-arrow" onClick={() => scroll(-1)} aria-label="Scroll news left"><ChevronLeft size={15} /></button>
    <div className="p-news-pills" ref={scroller}>
      {headlines === null ? profiles.error ? <span className="p-news-pill p-faint">News is unavailable right now.</span>
        : [0, 1, 2, 3].map((index) => <span key={index} className="p-news-pill"><SkeletonInline width={300} height={10} /></span>)
        : headlines.length ? headlines.map((item) => {
          const body = <><Logo name={item.company.name} logo={item.company.logo} size={18} /><span className="p-news-title">{item.title}</span><span className="p-faint p-mono">{formatDate(item.date)}</span></>;
          return item.url ? <a key={`${item.company.slug}-${item.id}`} className="p-news-pill" href={item.url} target="_blank" rel="noopener noreferrer" title={`${item.source ?? ""} · ${item.title}`}>{body}</a>
            : <span key={`${item.company.slug}-${item.id}`} className="p-news-pill">{body}</span>;
        }) : <span className="p-news-pill p-faint">No headlines published.</span>}
    </div>
    <button type="button" className="p-news-arrow" onClick={() => scroll(1)} aria-label="Scroll news right"><ChevronRight size={15} /></button>
  </section>;
}
