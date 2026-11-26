# Pre-IPO price oracle

Puts the markets site's derived share prices (`/api/derived-price/{slug}`, see `lib/derived-price.ts`) on BNB Chain, with a Chainlink-compatible feed per asset.

This folder is self-contained: its own `package.json`, Hardhat 2 toolchain and `node_modules`. It is not part of the Next app. Do not install its packages from the repo root.

## Contracts

- **`PreIpoPriceOracle`** stores the latest price per asset. Prices are in USD with 8 decimals, and each asset is keyed by `keccak256(bytes(SYMBOL))`, for example `keccak256("ANTHROPIC")`. For each round it keeps:
  - `price`, `updatedAt` (when the keeper observed it), `sourceCount`, and `dispersionBps` (the weighted standard deviation of the sources ÷ price);
  - every round, so `getRoundData` can return history.
- **Roles.** `DEFAULT_ADMIN_ROLE` is the owner. It configures assets, pauses, grants updaters, and can `forceUpdate` past the deviation guard. `UPDATER_ROLE` pushes prices, and the owner can push them too.
- **Guards.** Each asset has its own settings:
  - a `heartbeat`: `getPrice` reverts once the price is older than this, and `isStale` reports it;
  - `maxDeviationBps`: the largest change allowed from the previous price;
  - `minSources`: the fewest sources an update can come from.

  Timestamps must increase. An update cannot be stamped more than 5 minutes ahead of the block, and the price must be above zero. There is also a global `pause`.
- **Updates.** `updatePrice` takes one entry and reverts with the reason if it is rejected. `updatePrices` takes a batch. It skips each failing entry and emits `PriceRejected(key, price, reason)`, so one bad asset cannot block the others. It returns the number of entries applied.
- **`PreIpoPriceFeed`** wraps one asset as an `AggregatorV3Interface` (`decimals`, `description`, `version`, `latestRoundData`, `getRoundData`). It behaves like Chainlink: `latestRoundData` does not revert on an old price, so consumers must check `updatedAt` themselves. It reverts if no price has been written yet. `latestConfidence()` adds the source count, dispersion and staleness.

Asset settings are in `scripts/assets.js`. By default the heartbeat is 6 h, the maximum deviation is 15% (the same band the derived price uses to drop outliers), and the minimum is 1 source. ANTHROPIC and OPENAI need 3 sources.

## Compile and test

```sh
cd contracts
npm install
npm run compile      # hardhat compile (solc 0.8.24, optimizer on, evm paris)
npm test             # hardhat test: 17 tests covering updates, auth, deviation, staleness, pause, batch, adapter
```

## Deploy (BNB Chain testnet)

```sh
export RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545   # optional, this is the default
export DEPLOYER_PRIVATE_KEY=0x...      # funded with testnet BNB
export UPDATER_ADDRESS=0x...           # optional: keeper address to grant UPDATER_ROLE
export OWNER_ADDRESS=0x...             # optional: hand admin to a multisig (the deployer renounces it)
npm run deploy:bsc-testnet
```

The script deploys the oracle, configures every asset, and deploys one feed per asset. It writes the addresses to `deployments/bscTestnet.json`. To rehearse on Hardhat's in-memory chain first, run `npx hardhat run scripts/deploy.js` with no `--network` flag. Nothing leaves your machine.

For mainnet, use `--network bsc` (chain 56) instead.

## Keeper

`scripts/push-prices.mjs` reads `/api/derived-price/{slug}` for each asset and builds one `updatePrices` batch.

**Dry run is the default.** It prints each price and the calldata and sends nothing.

```sh
node scripts/push-prices.mjs                         # dry run, every asset, from http://localhost:5173
node scripts/push-prices.mjs --slugs anthropic,openai
node scripts/push-prices.mjs --base-url https://markets.example.com
```

To broadcast:

```sh
export RPC_URL=...                 # default: BNB Chain testnet public RPC
export ORACLE_ADDRESS=0x...
export UPDATER_PRIVATE_KEY=0x...   # must hold UPDATER_ROLE (or be the owner)
node scripts/push-prices.mjs --send
```

Before it sends, the keeper:
- checks the chain ID (97 by default; set `EXPECTED_CHAIN_ID` to change it);
- checks that the signer holds the role;
- simulates the batch.

After the transaction is mined, it prints any `PriceRejected` reasons.

The keeper skips a company if the site has no derived price for it or if it has fewer sources than the asset's `minSources`. Run it more often than the heartbeat, for example every 15–30 minutes from cron. The site recomputes once a minute.

### Notes

- If a price moves more than `maxDeviationBps` in one step, the update is rejected, not clamped. If the move is real (a listing, a split, a re-rating), the owner can write it with `forceUpdate`. The owner can also widen the band with `configureAsset`.
- `dispersionBps` and `sourceCount` are what the site reports. A price with 1 source and 0 dispersion is not a tight market: only one source could be placed on a one-share basis. Consumers should require a minimum `sourceCount`.
