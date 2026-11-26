/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: Hardhat 2 loads its scripts with require(). */
/**
 * Verifies the deployed oracle and every feed adapter: on Sourcify (no key
 * needed) and, when ETHERSCAN_API_KEY is set, on BscScan through Etherscan's
 * v2 API. Constructor arguments are rebuilt from deployments/<network>.json.
 *
 *   npx hardhat run scripts/verify.js --network bsc
 */
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function verifyOne(label, address, constructorArguments, contract) {
  const results = [];
  try {
    await hre.run("verify:sourcify", { address, contract });
    results.push("Sourcify ok");
  } catch (error) {
    results.push(/already (been )?verified/i.test(error.message) ? "Sourcify already verified" : `Sourcify failed: ${error.message.split("\n")[0]}`);
  }
  if (process.env.ETHERSCAN_API_KEY || process.env.ETHERSCAN_KEY) {
    try {
      await hre.run("verify:etherscan", { address, constructorArgsParams: constructorArguments.map(String), contract });
      results.push("BscScan ok");
    } catch (error) {
      results.push(/already verified/i.test(error.message) ? "BscScan already verified" : `BscScan failed: ${error.message.split("\n")[0]}`);
    }
  } else {
    results.push("BscScan skipped (set ETHERSCAN_KEY)");
  }
  console.log(`${label.padEnd(18)} ${address}  ${results.join(", ")}`);
}

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  // The deployer passed its own address as the oracle's owner.
  const owner = process.env.ORACLE_OWNER || (await hre.ethers.getSigners())[0].address;
  await verifyOne("PreIpoPriceOracle", deployment.oracle, [owner], "contracts/PreIpoPriceOracle.sol:PreIpoPriceOracle");
  for (const [symbol, asset] of Object.entries(deployment.assets)) {
    await verifyOne(`${symbol} / USD`, asset.feed, [deployment.oracle, asset.key], "contracts/PreIpoPriceFeed.sol:PreIpoPriceFeed");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
