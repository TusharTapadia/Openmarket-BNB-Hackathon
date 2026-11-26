#!/usr/bin/env node
/**
 * Keeper: reads the derived price for each company from the markets site and
 * pushes them to PreIpoPriceOracle in one `updatePrices` batch.
 *
 * Dry run is the default: it prints what it would write and the calldata, and
 * sends nothing. Pass --send to broadcast.
 *
 *   node scripts/push-prices.mjs                      # dry run, every asset
 *   node scripts/push-prices.mjs --slugs anthropic,openai
 *   node scripts/push-prices.mjs --send               # broadcast
 *
 * Environment:
 *   PRICE_API_BASE        site to read from (default http://localhost:5173), or --base-url
 *   RPC_URL               JSON-RPC endpoint (default BNB Chain testnet's public RPC)
 *   ORACLE_ADDRESS        deployed PreIpoPriceOracle
 *   UPDATER_PRIVATE_KEY   key holding UPDATER_ROLE (only needed with --send; falls back to PRIVATE_KEY in the app's .env)
 *   EXPECTED_CHAIN_ID     refuse to send elsewhere (default 97, BNB Chain testnet)
 */
import { createRequire } from "node:module";
import { Contract, Interface, JsonRpcProvider, Wallet, id, parseUnits, formatUnits } from "ethers";

const require = createRequire(import.meta.url);
const { ASSETS } = require("./assets.js");
const { normalizeKey } = require("./env.js");
const fs = require("node:fs");
const path = require("node:path");

/** The oracle address: ORACLE_ADDRESS, else the last deployment for the target network. */
function deployedOracle() {
  if (process.env.ORACLE_ADDRESS) { return process.env.ORACLE_ADDRESS; }
  const network = Number(process.env.EXPECTED_CHAIN_ID || 97) === 56 ? "bsc" : "bscTestnet";
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "deployments", `${network}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).oracle : undefined;
}

const ORACLE_ABI = [
  "function updatePrices((bytes32 key,uint256 price,uint64 observedAt,uint16 sourceCount,uint16 dispersionBps)[] updates) returns (uint256 applied)",
  "function latestRound(bytes32 key) view returns (uint80 roundId, (uint128 price,uint64 updatedAt,uint16 sourceCount,uint16 dispersionBps) round)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function UPDATER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "event PriceUpdated(bytes32 indexed key, uint80 indexed roundId, uint256 price, uint64 updatedAt, uint16 sourceCount, uint16 dispersionBps)",
  "event PriceRejected(bytes32 indexed key, uint256 price, uint8 reason)",
];
const REJECTIONS = ["UnknownAsset", "ZeroPrice", "PriceTooLarge", "NotNewer", "FromFuture", "TooFewSources", "DeviationTooLarge", "BadDispersion"];

function args(argv) {
  const out = { send: false, slugs: null, baseUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--send") { out.send = true; }
    else if (arg === "--dry-run") { out.send = false; }
    else if (arg === "--slugs") { out.slugs = argv[++i].split(",").map((slug) => slug.trim()).filter(Boolean); }
    else if (arg === "--base-url") { out.baseUrl = argv[++i]; }
    else if (arg === "--help" || arg === "-h") { console.log("Usage: push-prices.mjs [--dry-run | --send] [--slugs a,b] [--base-url URL]"); process.exit(0); }
    else { throw new Error(`Unknown argument ${arg}`); }
  }
  return out;
}

/** The site's JSON as one oracle update, or a reason it cannot be one. */
function toUpdate(asset, body) {
  if (!body || typeof body.price !== "number" || !(body.price > 0)) { return { skip: "no derived price" }; }
  const observedAt = Math.floor(Date.parse(body.computedAt) / 1000);
  if (!Number.isFinite(observedAt)) { return { skip: "no computedAt" }; }
  const sourceCount = Math.min(Number(body.sourcesUsed) || 0, 65_535);
  if (sourceCount < asset.minSources) { return { skip: `${sourceCount} sources, oracle wants ${asset.minSources}` }; }
  return {
    update: {
      key: id(asset.symbol),
      // Eight decimals, rounded half-up from the site's float.
      price: parseUnits(body.price.toFixed(8), 8),
      observedAt: BigInt(observedAt),
      sourceCount,
      dispersionBps: Math.min(Math.max(Math.round(Number(body.dispersionBps) || 0), 0), 10_000),
    },
  };
}

async function fetchDerived(baseUrl, slug) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/derived-price/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) { throw new Error(`${slug}: HTTP ${response.status}`); }
  return response.json();
}

async function main() {
  const opts = args(process.argv.slice(2));
  const baseUrl = opts.baseUrl || process.env.PRICE_API_BASE || "http://localhost:5173";
  const assets = opts.slugs ? ASSETS.filter((asset) => opts.slugs.includes(asset.slug)) : ASSETS;
  if (!assets.length) { throw new Error("No matching assets."); }

  console.log(`${opts.send ? "SEND" : "DRY RUN"} · prices from ${baseUrl}`);
  const updates = [];
  for (const asset of assets) {
    try {
      const result = toUpdate(asset, await fetchDerived(baseUrl, asset.slug));
      if (result.skip) { console.log(`  skip ${asset.symbol.padEnd(11)} ${result.skip}`); continue; }
      updates.push(result.update);
      const u = result.update;
      console.log(`  ${asset.symbol.padEnd(16)} $${formatUnits(u.price, 8).padEnd(16)} sources ${String(u.sourceCount).padEnd(3)} ±${(u.dispersionBps / 100).toFixed(2)}%  at ${new Date(Number(u.observedAt) * 1000).toISOString()}`);
    } catch (error) {
      console.log(`  fail ${asset.symbol.padEnd(11)} ${error.message}`);
    }
  }
  if (!updates.length) { console.log("Nothing to push."); process.exitCode = 1; return; }

  const iface = new Interface(ORACLE_ABI);
  const calldata = iface.encodeFunctionData("updatePrices", [updates]);
  const oracleAddress = deployedOracle();

  if (!opts.send) {
    console.log(`\nto:       ${oracleAddress || "<ORACLE_ADDRESS unset>"}`);
    console.log(`function: updatePrices(${updates.length} updates)`);
    console.log(`calldata: ${calldata}`);
    console.log("\nNothing sent. Re-run with --send to broadcast.");
    return;
  }

  const rpcUrl = process.env.RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
  const key = normalizeKey(process.env.UPDATER_PRIVATE_KEY || process.env.PRIVATE_KEY);
  if (!oracleAddress || !key) { throw new Error("--send needs ORACLE_ADDRESS and UPDATER_PRIVATE_KEY."); }
  const provider = new JsonRpcProvider(rpcUrl);
  const expected = BigInt(process.env.EXPECTED_CHAIN_ID || 97);
  const { chainId } = await provider.getNetwork();
  if (chainId !== expected) { throw new Error(`RPC is chain ${chainId}, expected ${expected}. Set EXPECTED_CHAIN_ID to override.`); }

  const signer = new Wallet(key, provider);
  const oracle = new Contract(oracleAddress, ORACLE_ABI, signer);
  const [updater, admin] = await Promise.all([oracle.UPDATER_ROLE(), oracle.DEFAULT_ADMIN_ROLE()]);
  const allowed = (await oracle.hasRole(updater, signer.address)) || (await oracle.hasRole(admin, signer.address));
  if (!allowed) { throw new Error(`${signer.address} has no UPDATER_ROLE on ${oracleAddress}.`); }

  // Simulate first: a paused oracle or bad batch fails here, not on-chain.
  const applied = await oracle.updatePrices.staticCall(updates);
  console.log(`\nSimulated: ${applied} of ${updates.length} would apply. Sending from ${signer.address}…`);
  const tx = await oracle.updatePrices(updates);
  console.log(`tx ${tx.hash}`);
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    const parsed = (() => { try { return iface.parseLog(log); } catch { return null; } })();
    if (parsed?.name === "PriceRejected") {
      const asset = ASSETS.find((entry) => id(entry.symbol) === parsed.args.key);
      console.log(`  rejected ${asset?.symbol ?? parsed.args.key}: ${REJECTIONS[Number(parsed.args.reason)] ?? parsed.args.reason}`);
    }
  }
  console.log(`Mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
