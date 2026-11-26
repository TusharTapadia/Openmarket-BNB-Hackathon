import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Host_Grotesk } from "next/font/google";
import "./globals.css";
import "./precap.css";
import "./summary.css";
import "./pro.css";
import "./markets.css";
import "./trade.css";
import { cookies } from "next/headers";
import { ViewModeProvider } from "@/components/view-mode";
import { TradeProviders } from "@/components/trade/providers";
import { parseViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";

/**
 * Two families, each with one job (Hallmark · Console): Host Grotesk for
 * everything a person reads, headings and labels included, and Atkinson
 * Hyperlegible Mono for what a venue measured: prices, volumes, percentages,
 * timestamps and raw tickers. Its slashed zero and tailed one keep figures
 * unambiguous at small sizes.
 */
const sans = Host_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-host",
  display: "swap",
});

const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Openmarkets",
  applicationName: "Openmarkets",
  description: "Private market pricing, valuations, funding and research.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Lite or Pro, read here so the first server render is already the right one.
  const mode = parseViewMode((await cookies()).get(VIEW_MODE_COOKIE)?.value);
  return (
    <html lang="en" data-mode={mode} className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased"><ViewModeProvider initial={mode}><TradeProviders>{children}</TradeProviders></ViewModeProvider></body>
    </html>
  );
}
