/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: Hardhat 2 loads its config, scripts and tests with require(). This line only matters to the app's root ESLint run. */
/**
 * Deploys PreIpoPriceOracle, configures every asset in scripts/assets.js, and
 * deploys one PreIpoPriceFeed (AggregatorV3 adapter) per asset.
 *
 *   npx hardhat run scripts/deploy.js --network bscTestnet
 *
 * Environment:
 *   RPC_URL               endpoint for the chosen network
 *   DEPLOYER_PRIVATE_KEY  pays for deployment; owns the oracle unless OWNER_ADDRESS is set
 *   OWNER_ADDRESS         optional: admin to hand the oracle to (the deployer renounces)
 *   UPDATER_ADDRESS       optional: keeper address granted UPDATER_ROLE (default: the deployer, so PRIVATE_KEY both deploys and updates)
 *
 * On a live network the addresses are written to deployments/<network>.json.
 * Run with no --network to rehearse against Hardhat's in-memory chain.
 */
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ASSETS } = require("./assets");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) { throw new Error("No deployer: set DEPLOYER_PRIVATE_KEY."); }
  const chain = await ethers.provider.getNetwork();
  console.log(`Network ${network.name} (chain ${chain.chainId}), deployer ${deployer.address}`);

  const oracle = await ethers.deployContract("PreIpoPriceOracle", [deployer.address]);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`PreIpoPriceOracle ${oracleAddress}`);

  const feeds = {};
  for (const asset of ASSETS) {
    const key = ethers.id(asset.symbol);
    await (await oracle.configureAsset(key, asset.description, asset.heartbeat, asset.maxDeviationBps, asset.minSources, true)).wait();
    const feed = await ethers.deployContract("PreIpoPriceFeed", [oracleAddress, key]);
    await feed.waitForDeployment();
    feeds[asset.symbol] = { slug: asset.slug, key, feed: await feed.getAddress() };
    console.log(`  ${asset.symbol.padEnd(11)} key ${key}  feed ${feeds[asset.symbol].feed}`);
  }

  // The deploying key also signs price updates unless another updater is named.
  const updater = process.env.UPDATER_ADDRESS || deployer.address;
  if (updater) {
    await (await oracle.grantRole(await oracle.UPDATER_ROLE(), updater)).wait();
    console.log(`UPDATER_ROLE granted to ${updater}`);
  }
  const owner = process.env.OWNER_ADDRESS;
  if (owner && owner.toLowerCase() !== deployer.address.toLowerCase()) {
    const admin = await oracle.DEFAULT_ADMIN_ROLE();
    await (await oracle.grantRole(admin, owner)).wait();
    await (await oracle.renounceRole(admin, deployer.address)).wait();
    console.log(`Ownership handed to ${owner}`);
  }

  if (network.name !== "hardhat") {
    const out = path.join(__dirname, "..", "deployments", `${network.name}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify({ chainId: Number(chain.chainId), oracle: oracleAddress, assets: feeds, deployedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`Wrote ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});