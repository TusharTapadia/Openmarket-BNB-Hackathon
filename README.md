# Openmarkets

Openmarkets reads every price for pre-IPO companies (off-chain trades, perpetuals,
spot tokens and issuer tokens) and turns them into one trusted price per share,
published on BNB Chain.

- **Lite and Pro views** of the same data: a readable overview, and a dense trading desk.
- **Every venue, perps and spot**: Hyperliquid HIP-3 deployers, MEXC, Gate and other
  exchanges, plus issuer tokens from PreStocks, OpenStocks, xStocks and Paimon, each
  shown against the off-chain share price.
- **Weighted price** for each company: each source weighted by trust times liquidity,
  normalised to one share, with outliers left out (`lib/derived-price.ts`). Sources
  include Atlas oracle feeds (ANTB, SPCXB) and CoinMarketCap exchange pairs.
- **Data feeds** (`/data-feeds`): every aggregated feed, its price history, its verified
  sources, and the value currently stored on-chain.
- **On-chain oracle** (`contracts/`): `PreIpoPriceOracle` on BNB Chain with a
  Chainlink-compatible feed per asset, and a keeper that pushes the weighted prices.
  Mainnet oracle: `0xA980e3C24759adFf55636512Ee1708bbFC91f65B`.
- **Trade**: issuer tokens on BNB Chain swap through PancakeSwap from your own wallet
  (RainbowKit); PreStocks tokens on Solana show Jupiter quotes.
- **Pre-IPO → IPO**: what happens to pre-IPO tokens once a company lists (Anthropic,
  SpaceX), with each issuer's discount to the public share.
- **IPO timing** from Kalshi's IPO date markets.

## Local development

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Build and run the production app with:

```sh
npm run build
npm start
```

`npm run lint` runs ESLint. `npx tsc --noEmit` checks TypeScript.

## Vercel deployment

Import this repository into Vercel. For this dedicated
repository, use its root as the project root. `vercel.json` selects Next.js,
installs with `npm ci`, builds with `npm run build`, and uses the framework's
default output directory. No Cloudflare Worker bundle is needed for Vercel.

`package.json` contains version-pinned `allowScripts` entries for the native
build dependencies. After changing dependency versions, run
`npm install-scripts ls` to review any newly unapproved install scripts.

The optional server-side `PRECAP_API_URL` environment variable overrides the
public API host; see `.env.example`. No API secret is required for the current
public feeds.

Reference prices are the volume-weighted mean of perpetual-market prices in the
existing company JSON. Only venues with a positive price and positive reported
volume contribute; no contributing venues means an unavailable reference price.
Implied valuations are independently weighted from each venue's reported
estimated valuation, preserving its contract's price units. Supplied JSON
snapshots are never presented as live exchange quotes or oToken prices.

Stock marks are fetched separately from the API's
`/v1/external/watchlist/market-prices` endpoint, which reads the saved
`caplight_watchlist.market_price` field. That endpoint has no quote timestamp;
the displayed fetch time indicates when Markets retrieved the marks.

The detail chart shows disclosed completed funding valuations. The supplied
funding rounds are used when the company insights feed has none.

## Existing Sites runtime

The original Cloudflare/Vinext tooling remains available through `sites:dev`,
`sites:build`, and `sites:start`. Its runtime files and hosting manifest are
retained for the existing Sites publication. The default scripts target Next.js
and Vercel.
