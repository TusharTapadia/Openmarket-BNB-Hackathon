/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: Hardhat 2 loads its config, scripts and tests with require(). This line only matters to the app's root ESLint run. */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const ANTHROPIC = ethers.id("ANTHROPIC");
const OPENAI = ethers.id("OPENAI");
const UNKNOWN = ethers.id("NOPE");
const HEARTBEAT = 6 * 60 * 60;
const usd = (value) => ethers.parseUnits(String(value), 8);
const Rejection = { UnknownAsset: 0, ZeroPrice: 1, PriceTooLarge: 2, NotNewer: 3, FromFuture: 4, TooFewSources: 5, DeviationTooLarge: 6, BadDispersion: 7 };

async function deploy() {
  const [owner, updater, stranger] = await ethers.getSigners();
  const oracle = await ethers.deployContract("PreIpoPriceOracle", [owner.address]);
  await oracle.configureAsset(ANTHROPIC, "ANTHROPIC / USD", HEARTBEAT, 1500, 3, true);
  await oracle.configureAsset(OPENAI, "OPENAI / USD", HEARTBEAT, 1500, 1, true);
  await oracle.grantRole(await oracle.UPDATER_ROLE(), updater.address);
  const feed = await ethers.deployContract("PreIpoPriceFeed", [await oracle.getAddress(), ANTHROPIC]);
  return { oracle, feed, owner, updater, stranger };
}

async function update(key, price, { at, sources = 5, dispersion = 300 } = {}) {
  return { key, price: usd(price), observedAt: at ?? (await time.latest()), sourceCount: sources, dispersionBps: dispersion };
}

describe("PreIpoPriceOracle", () => {
  describe("configuration", () => {
    it("lists configured assets once and rejects bad config", async () => {
      const { oracle, stranger } = await loadFixture(deploy);
      await oracle.configureAsset(ANTHROPIC, "ANTHROPIC / USD", HEARTBEAT, 1000, 3, true);
      expect(await oracle.assetKeys()).to.deep.equal([ANTHROPIC, OPENAI]);
      expect((await oracle.assetConfig(ANTHROPIC)).maxDeviationBps).to.equal(1000);
      await expect(oracle.configureAsset(OPENAI, "x", 0, 100, 1, true)).to.be.revertedWithCustomError(oracle, "InvalidConfig");
      await expect(oracle.configureAsset(OPENAI, "x", 60, 10_001, 1, true)).to.be.revertedWithCustomError(oracle, "InvalidConfig");
      await expect(oracle.connect(stranger).configureAsset(OPENAI, "x", 60, 100, 1, true))
        .to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });

    it("computes keys as keccak256 of the symbol", async () => {
      const { oracle } = await loadFixture(deploy);
      expect(await oracle.keyFor("ANTHROPIC")).to.equal(ANTHROPIC);
    });
  });

  describe("updates", () => {
    it("stores price, timestamp, sources and dispersion, and emits", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      const u = await update(ANTHROPIC, "84.38310000", { sources: 7, dispersion: 339 });
      await expect(oracle.connect(updater).updatePrice(u))
        .to.emit(oracle, "PriceUpdated").withArgs(ANTHROPIC, 1, u.price, u.observedAt, 7, 339);
      const [roundId, round] = await oracle.latestRound(ANTHROPIC);
      expect(roundId).to.equal(1);
      expect(round.price).to.equal(usd("84.3831"));
      expect(round.sourceCount).to.equal(7);
      expect(round.dispersionBps).to.equal(339);
      const [price, updatedAt] = await oracle.getPrice(ANTHROPIC);
      expect(price).to.equal(u.price);
      expect(updatedAt).to.equal(u.observedAt);
    });

    it("lets the owner update too", async () => {
      const { oracle } = await loadFixture(deploy);
      await expect(oracle.updatePrice(await update(OPENAI, 971))).to.emit(oracle, "PriceUpdated");
    });

    it("rejects zero, unknown, future, too-few-sources, bad dispersion and non-newer updates", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      const now = await time.latest();
      const as = oracle.connect(updater);
      const cases = [
        [await update(UNKNOWN, 1), Rejection.UnknownAsset],
        [{ ...(await update(ANTHROPIC, 1)), price: 0n }, Rejection.ZeroPrice],
        [{ ...(await update(ANTHROPIC, 1)), price: 2n ** 128n }, Rejection.PriceTooLarge],
        [await update(ANTHROPIC, 84, { at: now + 3600 }), Rejection.FromFuture],
        [await update(ANTHROPIC, 84, { sources: 2 }), Rejection.TooFewSources],
        [await update(ANTHROPIC, 84, { dispersion: 10_001 }), Rejection.BadDispersion],
        [await update(ANTHROPIC, 84, { at: 0 }), Rejection.NotNewer],
      ];
      for (const [u, reason] of cases) {
        await expect(as.updatePrice(u)).to.be.revertedWithCustomError(oracle, "UpdateRejected").withArgs(u.key, reason);
      }
      await as.updatePrice(await update(ANTHROPIC, 84, { at: now }));
      await expect(as.updatePrice(await update(ANTHROPIC, 84.5, { at: now })))
        .to.be.revertedWithCustomError(oracle, "UpdateRejected").withArgs(ANTHROPIC, Rejection.NotNewer);
    });
  });

  describe("authorization", () => {
    it("refuses updates from accounts without UPDATER_ROLE", async () => {
      const { oracle, stranger } = await loadFixture(deploy);
      await expect(oracle.connect(stranger).updatePrice(await update(OPENAI, 900)))
        .to.be.revertedWithCustomError(oracle, "NotUpdater").withArgs(stranger.address);
      await expect(oracle.connect(stranger).updatePrices([await update(OPENAI, 900)]))
        .to.be.revertedWithCustomError(oracle, "NotUpdater");
    });

    it("stops an updater once its role is revoked", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      await oracle.revokeRole(await oracle.UPDATER_ROLE(), updater.address);
      await expect(oracle.connect(updater).updatePrice(await update(OPENAI, 900))).to.be.revertedWithCustomError(oracle, "NotUpdater");
    });

    it("keeps admin actions to the owner", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      await expect(oracle.connect(updater).pause()).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
      await expect(oracle.connect(updater).forceUpdate(await update(OPENAI, 900))).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });
  });

  describe("deviation guard", () => {
    it("allows moves inside the band and rejects moves beyond it", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      const as = oracle.connect(updater);
      await as.updatePrice(await update(OPENAI, 1000));
      await time.increase(60);
      await as.updatePrice(await update(OPENAI, 1150)); // +15.0%: exactly at the band
      await time.increase(60);
      await expect(as.updatePrice(await update(OPENAI, 1323))) // +15.04%
        .to.be.revertedWithCustomError(oracle, "UpdateRejected").withArgs(OPENAI, Rejection.DeviationTooLarge);
      await expect(as.updatePrice(await update(OPENAI, 977))) // −15.04%
        .to.be.revertedWithCustomError(oracle, "UpdateRejected").withArgs(OPENAI, Rejection.DeviationTooLarge);
    });

    it("lets the owner force a genuine jump through, and can be switched off", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      await oracle.connect(updater).updatePrice(await update(OPENAI, 1000));
      await time.increase(60);
      await expect(oracle.forceUpdate(await update(OPENAI, 2000)))
        .to.emit(oracle, "PriceForced").withArgs(OPENAI, 2, usd(1000), usd(2000));
      await oracle.configureAsset(OPENAI, "OPENAI / USD", HEARTBEAT, 0, 1, true);
      await time.increase(60);
      await expect(oracle.connect(updater).updatePrice(await update(OPENAI, 100))).to.emit(oracle, "PriceUpdated");
    });
  });

  describe("staleness", () => {
    it("serves a fresh price and reverts once the heartbeat passes", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      await expect(oracle.getPrice(OPENAI)).to.be.revertedWithCustomError(oracle, "NoPrice");
      expect(await oracle.isStale(OPENAI)).to.equal(true);
      await oracle.connect(updater).updatePrice(await update(OPENAI, 971));
      expect(await oracle.isStale(OPENAI)).to.equal(false);
      await time.increase(HEARTBEAT + 1);
      expect(await oracle.isStale(OPENAI)).to.equal(true);
      await expect(oracle.getPrice(OPENAI)).to.be.revertedWithCustomError(oracle, "StalePrice");
      await expect(oracle.getPrice(UNKNOWN)).to.be.revertedWithCustomError(oracle, "UnknownAsset");
    });
  });

  describe("pause", () => {
    it("blocks updates and checked reads while paused", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      await oracle.connect(updater).updatePrice(await update(OPENAI, 971));
      await oracle.pause();
      await expect(oracle.connect(updater).updatePrice(await update(OPENAI, 972))).to.be.revertedWithCustomError(oracle, "EnforcedPause");
      await expect(oracle.connect(updater).updatePrices([await update(OPENAI, 972)])).to.be.revertedWithCustomError(oracle, "EnforcedPause");
      await expect(oracle.getPrice(OPENAI)).to.be.revertedWithCustomError(oracle, "EnforcedPause");
      await oracle.unpause();
      await time.increase(1);
      await expect(oracle.connect(updater).updatePrice(await update(OPENAI, 972))).to.emit(oracle, "PriceUpdated");
    });
  });

  describe("batch", () => {
    it("writes the good entries and skips the bad ones with a reason", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      const as = oracle.connect(updater);
      await as.updatePrice(await update(OPENAI, 1000));
      await time.increase(60);
      const batch = [
        await update(ANTHROPIC, 84.38),
        await update(OPENAI, 2000), // beyond the deviation band
        await update(UNKNOWN, 5),
      ];
      expect(await as.updatePrices.staticCall(batch)).to.equal(1);
      await expect(as.updatePrices(batch))
        .to.emit(oracle, "PriceUpdated").withArgs(ANTHROPIC, 1, usd(84.38), batch[0].observedAt, 5, 300)
        .and.to.emit(oracle, "PriceRejected").withArgs(OPENAI, usd(2000), Rejection.DeviationTooLarge)
        .and.to.emit(oracle, "PriceRejected").withArgs(UNKNOWN, usd(5), Rejection.UnknownAsset);
      expect((await oracle.latestRound(OPENAI)).round.price).to.equal(usd(1000));
    });

    it("updates many assets in one transaction", async () => {
      const { oracle, updater } = await loadFixture(deploy);
      await expect(oracle.connect(updater).updatePrices([await update(ANTHROPIC, 84), await update(OPENAI, 971)]))
        .to.emit(oracle, "PriceUpdated").withArgs(OPENAI, 1, usd(971), await time.latest(), 5, 300);
      expect((await oracle.latestRound(ANTHROPIC)).roundId).to.equal(1);
      expect((await oracle.latestRound(OPENAI)).roundId).to.equal(1);
    });
  });

  describe("PreIpoPriceFeed (AggregatorV3)", () => {
    it("reports decimals, description and version", async () => {
      const { feed } = await loadFixture(deploy);
      expect(await feed.decimals()).to.equal(8);
      expect(await feed.description()).to.equal("ANTHROPIC / USD");
      expect(await feed.version()).to.equal(1);
    });

    it("reverts before the first price, then serves latest and historical rounds", async () => {
      const { oracle, feed, updater } = await loadFixture(deploy);
      await expect(feed.latestRoundData()).to.be.revertedWithCustomError(feed, "NoData");
      const first = await update(ANTHROPIC, 83.5);
      await oracle.connect(updater).updatePrice(first);
      await time.increase(600);
      const second = await update(ANTHROPIC, 84.38, { sources: 7, dispersion: 339 });
      await oracle.connect(updater).updatePrice(second);

      const latest = await feed.latestRoundData();
      expect(latest.roundId).to.equal(2);
      expect(latest.answer).to.equal(usd(84.38));
      expect(latest.startedAt).to.equal(second.observedAt);
      expect(latest.updatedAt).to.equal(second.observedAt);
      expect(latest.answeredInRound).to.equal(2);

      const past = await feed.getRoundData(1);
      expect(past.answer).to.equal(usd(83.5));
      expect(past.updatedAt).to.equal(first.observedAt);
      await expect(feed.getRoundData(3)).to.be.revertedWithCustomError(oracle, "RoundNotFound");

      const confidence = await feed.latestConfidence();
      expect(confidence.sourceCount).to.equal(7);
      expect(confidence.dispersionBps).to.equal(339);
      expect(confidence.stale).to.equal(false);
    });

    it("keeps answering after the heartbeat, like Chainlink, but flags staleness", async () => {
      const { oracle, feed, updater } = await loadFixture(deploy);
      await oracle.connect(updater).updatePrice(await update(ANTHROPIC, 84));
      await time.increase(HEARTBEAT + 1);
      expect((await feed.latestRoundData()).answer).to.equal(usd(84));
      expect((await feed.latestConfidence()).stale).to.equal(true);
    });
  });
});