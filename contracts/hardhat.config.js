/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: Hardhat 2 loads its config, scripts and tests with require(). This line only matters to the app's root ESLint run. */
require("@nomicfoundation/hardhat-toolbox");
const { normalizeKey } = require("./scripts/env");

/**
 * Hardhat for the price oracle. Network settings come from the environment;
 * nothing here holds a key. BNB Chain testnet (chain 97) is the default target.
 *
 *   RPC_URL               JSON-RPC endpoint (default: BNB Chain's public testnet RPC)
 *   DEPLOYER_PRIVATE_KEY  key that deploys and owns the oracle (falls back to PRIVATE_KEY in the app's .env)
 */
const deployerKey = normalizeKey(process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY);
const accounts = deployerKey ? [deployerKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  // Contract verification: Sourcify needs no key; BscScan uses Etherscan's v2 API
  // with one ETHERSCAN_API_KEY (from etherscan.io) for every chain, BNB Chain included.
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || process.env.ETHERSCAN_KEY || "" },
  sourcify: { enabled: true },
  networks: {
    bscTestnet: {
      url: process.env.RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      accounts,
    },
    bsc: {
      url: process.env.RPC_URL || "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts,
    },
  },
};