/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS for Hardhat. */
/**
 * Reads the app's root .env (one level up) into process.env without
 * overriding anything already set. One key, PRIVATE_KEY, both deploys the
 * oracle and signs every price update; DEPLOYER_PRIVATE_KEY and
 * UPDATER_PRIVATE_KEY still win when set explicitly.
 */
const fs = require("node:fs");
const path = require("node:path");

function loadRootEnv() {
  const file = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(file)) { return; }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) { continue; }
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

/** A 0x-prefixed key, or undefined. */
function normalizeKey(key) {
  if (!key) { return undefined; }
  return key.startsWith("0x") ? key : `0x${key}`;
}

loadRootEnv();
module.exports = { normalizeKey };
