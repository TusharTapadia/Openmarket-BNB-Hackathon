import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Host_Grotesk } from "next/font/google";
import "./globals.css";
import "./precap.css";
import "./summary.css";
import "./pro.css";
import "./markets.css";
import "./theme.css";
import "./trade.css";
import { cookies } from "next/headers";
import { ViewModeProvider } from "@/components/view-mode";
import { ThemeProvider } from "@/components/theme-mode";
import { defaultTheme, parseTheme, THEME_COOKIE } from "@/components/theme-cookie";
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
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Lite or Pro, read here so the first server render is already the right one.
  const jar = await cookies();
  const mode = parseViewMode(jar.get(VIEW_MODE_COOKIE)?.value);
  // Light or dark, likewise: the stored pick, else the view's own look.
  const chosenTheme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const theme = chosenTheme ?? defaultTheme(mode);
  return (
    <html lang="en" data-mode={mode} data-theme={theme} className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased"><ViewModeProvider initial={mode}><ThemeProvider initial={chosenTheme}><TradeProviders>{children}</TradeProviders></ThemeProvider></ViewModeProvider></body>
    </html>
  );
}
