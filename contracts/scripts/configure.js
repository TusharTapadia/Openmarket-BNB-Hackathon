/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: Hardhat 2 loads its scripts with require(). */
/**
 * Re-applies scripts/assets.js to the deployed oracle: heartbeat, deviation
 * guard and minimum sources per asset. Only assets whose settings differ are
 * sent.
 *
 *   RPC_URL=https://bsc-dataseed.bnbchain.org npx hardhat run scripts/configure.js --network bsc
 */
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ASSETS } = require("./assets");

async function main() {
  const { ethers, network } = hre;
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const address = process.env.ORACLE_ADDRESS || JSON.parse(fs.readFileSync(file, "utf8")).oracle;
  const [admin] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PreIpoPriceOracle", address, admin);
  console.log(`Oracle ${address} on ${network.name}, admin ${admin.address}`);
  for (const asset of ASSETS) {
    const key = ethers.id(asset.symbol);
    const now = await oracle.assetConfig(key);
    const same = Number(now.heartbeat) === asset.heartbeat && Number(now.maxDeviationBps) === asset.maxDeviationBps && Number(now.minSources) === asset.minSources && now.enabled;
    if (same) { console.log(`  ${asset.symbol.padEnd(11)} unchanged`); continue; }
    const tx = await oracle.configureAsset(key, asset.description, asset.heartbeat, asset.maxDeviationBps, asset.minSources, true);
    await tx.wait();
    console.log(`  ${asset.symbol.padEnd(11)} heartbeat ${Number(now.heartbeat) / 3600}h -> ${asset.heartbeat / 3600}h  tx ${tx.hash}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
