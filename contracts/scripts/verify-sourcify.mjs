#!/usr/bin/env node
/**
 * Verifies the deployed oracle and feeds on Sourcify through its v2 API
 * (no API key). Sends the exact compiler input Hardhat used, from
 * artifacts/build-info, and polls each job until it finishes.
 *
 *   node scripts/verify-sourcify.mjs            # uses deployments/bsc.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const API = "https://sourcify.dev/server";
const network = process.argv[2] || "bsc";
const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${network}.json`), "utf8"));
const chainId = deployment.chainId;

// The build-info file holding both contracts: Hardhat's standard JSON input plus the full compiler version.
const infoDir = path.join(root, "artifacts", "build-info");
const info = fs.readdirSync(infoDir).map((file) => JSON.parse(fs.readFileSync(path.join(infoDir, file), "utf8")))
  .find((body) => body.output?.contracts?.["contracts/PreIpoPriceOracle.sol"] && body.output?.contracts?.["contracts/PreIpoPriceFeed.sol"]);
if (!info) { throw new Error("No build-info with both contracts: run npx hardhat compile."); }
const compilerVersion = info.solcLongVersion.startsWith("v") ? info.solcLongVersion.slice(1) : info.solcLongVersion;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function status(address) {
  const body = await (await fetch(`${API}/v2/contract/${chainId}/${address}`)).json();
  return body.match ?? null;
}

async function verify(label, address, contractIdentifier) {
  const already = await status(address);
  if (already) { console.log(`${label.padEnd(18)} ${address}  already verified (${already})`); return; }
  const response = await fetch(`${API}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stdJsonInput: info.input, compilerVersion, contractIdentifier }),
  });
  const body = await response.json();
  if (!response.ok) { console.log(`${label.padEnd(18)} ${address}  request failed: ${body.message ?? response.status}`); return; }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(3000);
    const job = await (await fetch(`${API}/v2/verify/${body.verificationId}`)).json();
    if (job.isJobCompleted) {
      console.log(`${label.padEnd(18)} ${address}  ${job.error ? `failed: ${job.error.message}` : `verified (${job.contract?.match})`}`);
      return;
    }
  }
  console.log(`${label.padEnd(18)} ${address}  still pending, job ${body.verificationId}`);
}

await verify("PreIpoPriceOracle", deployment.oracle, "contracts/PreIpoPriceOracle.sol:PreIpoPriceOracle");
for (const [symbol, asset] of Object.entries(deployment.assets)) {
  await verify(`${symbol} / USD`, asset.feed, "contracts/PreIpoPriceFeed.sol:PreIpoPriceFeed");
}
