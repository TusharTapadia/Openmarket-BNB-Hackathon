// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PreIpoPriceOracle
 * @notice Stores the derived price of one share of each covered pre-IPO company
 *         (see the markets site's /api/derived-price), pushed by an off-chain keeper.
 *
 *  - Prices are USD with 8 decimals, like Chainlink's USD feeds.
 *  - Each asset is keyed by `keccak256(bytes(SYMBOL))`, e.g. keccak256("ANTHROPIC").
 *  - Every update records how many sources fed the price and their dispersion
 *    (weighted standard deviation over price, in basis points) so readers can
 *    judge confidence, and keeps its round so Chainlink-style `getRoundData`
 *    works for history.
 *  - Guards: per-asset heartbeat (staleness), maximum move per update, minimum
 *    source count, monotonic timestamps, and a global pause.
 *  - Roles: DEFAULT_ADMIN_ROLE (the owner) configures assets, pauses, grants
 *    updaters and may force a price through the deviation guard; UPDATER_ROLE
 *    pushes prices. The owner can push prices too.
 *
 *  `PreIpoPriceFeed` wraps one asset as an AggregatorV3Interface for DeFi.
 */
contract PreIpoPriceOracle is AccessControl, Pausable {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    uint8 public constant DECIMALS = 8;
    uint16 public constant MAX_BPS = 10_000;
    /** How far ahead of the block an observation may be stamped (clock skew between keeper and chain). */
    uint64 public constant MAX_FUTURE_SKEW = 5 minutes;

    struct Round {
        uint128 price; // USD, 8 decimals
        uint64 updatedAt; // when the keeper observed the price (unix seconds)
        uint16 sourceCount; // sources that carried weight in the derived price
        uint16 dispersionBps; // weighted std dev / price, in bps (lower is tighter)
    }

    struct AssetConfig {
        bool enabled;
        uint32 heartbeat; // max age in seconds before a price is stale
        uint16 maxDeviationBps; // max move vs the previous price per update; 0 disables the guard
        uint16 minSources; // updates with fewer sources are rejected
        string description; // e.g. "ANTHROPIC / USD"
    }

    struct PriceUpdate {
        bytes32 key;
        uint256 price; // USD, 8 decimals
        uint64 observedAt;
        uint16 sourceCount;
        uint16 dispersionBps;
    }

    /** Why a batch entry was skipped (see `PriceRejected`). */
    enum Rejection {
        UnknownAsset,
        ZeroPrice,
        PriceTooLarge,
        NotNewer,
        FromFuture,
        TooFewSources,
        DeviationTooLarge,
        BadDispersion
    }

    mapping(bytes32 => AssetConfig) private _configs;
    mapping(bytes32 => uint80) private _latestRound;
    mapping(bytes32 => mapping(uint80 => Round)) private _rounds;
    bytes32[] private _keys;

    event AssetConfigured(bytes32 indexed key, string description, uint32 heartbeat, uint16 maxDeviationBps, uint16 minSources, bool enabled);
    event PriceUpdated(bytes32 indexed key, uint80 indexed roundId, uint256 price, uint64 updatedAt, uint16 sourceCount, uint16 dispersionBps);
    event PriceRejected(bytes32 indexed key, uint256 price, Rejection reason);
    event PriceForced(bytes32 indexed key, uint80 indexed roundId, uint256 previousPrice, uint256 price);

    error NotUpdater(address account);
    error UpdateRejected(bytes32 key, Rejection reason);
    error UnknownAsset(bytes32 key);
    error NoPrice(bytes32 key);
    error StalePrice(bytes32 key, uint256 updatedAt, uint256 heartbeat);
    error InvalidConfig();
    error RoundNotFound(bytes32 key, uint80 roundId);

    modifier onlyUpdater() {
        if (!hasRole(UPDATER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotUpdater(msg.sender);
        _;
    }

    constructor(address owner_) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner_ == address(0) ? msg.sender : owner_);
    }

    /* ------------------------------------------------------------------ */
    /* Admin                                                               */
    /* ------------------------------------------------------------------ */

    function configureAsset(bytes32 key, string calldata description, uint32 heartbeat, uint16 maxDeviationBps, uint16 minSources, bool enabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (key == bytes32(0) || heartbeat == 0 || maxDeviationBps > MAX_BPS || minSources == 0) revert InvalidConfig();
        AssetConfig storage config = _configs[key];
        // heartbeat is never zero once configured, so zero marks a new key.
        if (config.heartbeat == 0) _keys.push(key);
        config.enabled = enabled;
        config.heartbeat = heartbeat;
        config.maxDeviationBps = maxDeviationBps;
        config.minSources = minSources;
        config.description = description;
        emit AssetConfigured(key, description, heartbeat, maxDeviationBps, minSources, enabled);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Writes a price past the deviation guard, for a genuine jump such as
     *         a listing or a split. Every other check still applies.
     */
    function forceUpdate(PriceUpdate calldata update) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        uint256 previous = _rounds[update.key][_latestRound[update.key]].price;
        (bool ok, Rejection reason) = _check(update, false);
        if (!ok) revert UpdateRejected(update.key, reason);
        uint80 roundId = _write(update);
        emit PriceForced(update.key, roundId, previous, update.price);
    }

    /* ------------------------------------------------------------------ */
    /* Updates                                                             */
    /* ------------------------------------------------------------------ */

    /** @notice One price; reverts with the reason if any check fails. */
    function updatePrice(PriceUpdate calldata update) external onlyUpdater whenNotPaused {
        (bool ok, Rejection reason) = _check(update, true);
        if (!ok) revert UpdateRejected(update.key, reason);
        _write(update);
    }

    /**
     * @notice Many prices in one transaction. An entry that fails a check is
     *         skipped with `PriceRejected` so one bad asset cannot hold back the rest.
     * @return applied How many entries were written.
     */
    function updatePrices(PriceUpdate[] calldata updates) external onlyUpdater whenNotPaused returns (uint256 applied) {
        for (uint256 i = 0; i < updates.length; ++i) {
            (bool ok, Rejection reason) = _check(updates[i], true);
            if (ok) {
                _write(updates[i]);
                ++applied;
            } else {
                emit PriceRejected(updates[i].key, updates[i].price, reason);
            }
        }
    }

    function _check(PriceUpdate calldata update, bool guardDeviation) internal view returns (bool, Rejection) {
        AssetConfig storage config = _configs[update.key];
        if (!config.enabled) return (false, Rejection.UnknownAsset);
        if (update.price == 0) return (false, Rejection.ZeroPrice);
        if (update.price > type(uint128).max || update.price > uint256(type(int256).max)) return (false, Rejection.PriceTooLarge);
        if (update.observedAt > block.timestamp + MAX_FUTURE_SKEW) return (false, Rejection.FromFuture);
        if (update.sourceCount < config.minSources) return (false, Rejection.TooFewSources);
        if (update.dispersionBps > MAX_BPS) return (false, Rejection.BadDispersion);

        Round storage last = _rounds[update.key][_latestRound[update.key]];
        if (last.updatedAt != 0) {
            if (update.observedAt <= last.updatedAt) return (false, Rejection.NotNewer);
            if (guardDeviation && config.maxDeviationBps != 0) {
                uint256 previous = last.price;
                uint256 move = update.price > previous ? update.price - previous : previous - update.price;
                if (move * MAX_BPS > previous * config.maxDeviationBps) return (false, Rejection.DeviationTooLarge);
            }
        } else if (update.observedAt == 0) {
            return (false, Rejection.NotNewer);
        }
        return (true, Rejection.UnknownAsset);
    }

    function _write(PriceUpdate calldata update) internal returns (uint80 roundId) {
        roundId = _latestRound[update.key] + 1;
        _latestRound[update.key] = roundId;
        _rounds[update.key][roundId] = Round({
            price: uint128(update.price),
            updatedAt: update.observedAt,
            sourceCount: update.sourceCount,
            dispersionBps: update.dispersionBps
        });
        emit PriceUpdated(update.key, roundId, update.price, update.observedAt, update.sourceCount, update.dispersionBps);
    }

    /* ------------------------------------------------------------------ */
    /* Reads                                                               */
    /* ------------------------------------------------------------------ */

    /**
     * @notice The latest price, reverting if it is missing, stale or the oracle is paused.
     *         The safe read for contracts that act on the price.
     */
    function getPrice(bytes32 key) external view whenNotPaused returns (uint256 price, uint256 updatedAt) {
        AssetConfig storage config = _configs[key];
        if (!config.enabled) revert UnknownAsset(key);
        Round storage round = _rounds[key][_latestRound[key]];
        if (round.updatedAt == 0) revert NoPrice(key);
        if (block.timestamp > uint256(round.updatedAt) + config.heartbeat) revert StalePrice(key, round.updatedAt, config.heartbeat);
        return (round.price, round.updatedAt);
    }

    /** @notice The latest round with no staleness check; callers judge `updatedAt` themselves. */
    function latestRound(bytes32 key) external view returns (uint80 roundId, Round memory round) {
        roundId = _latestRound[key];
        round = _rounds[key][roundId];
    }

    function getRound(bytes32 key, uint80 roundId) external view returns (Round memory round) {
        round = _rounds[key][roundId];
        if (roundId == 0 || round.updatedAt == 0) revert RoundNotFound(key, roundId);
    }

    /** @notice True when there is no price, or the latest is older than the asset's heartbeat. */
    function isStale(bytes32 key) public view returns (bool) {
        Round storage round = _rounds[key][_latestRound[key]];
        return round.updatedAt == 0 || block.timestamp > uint256(round.updatedAt) + _configs[key].heartbeat;
    }

    function assetConfig(bytes32 key) external view returns (AssetConfig memory) {
        return _configs[key];
    }

    function assetKeys() external view returns (bytes32[] memory) {
        return _keys;
    }

    /** @notice The key for a symbol, as the keeper computes it: keccak256(bytes(symbol)). */
    function keyFor(string calldata symbol) external pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }
}
