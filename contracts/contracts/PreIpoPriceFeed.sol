// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";
import {PreIpoPriceOracle} from "./PreIpoPriceOracle.sol";

/**
 * @title PreIpoPriceFeed
 * @notice One oracle asset as a Chainlink AggregatorV3Interface, so lending
 *         markets and vaults that already read Chainlink can read this price.
 *
 * Like Chainlink, `latestRoundData` does not revert on an old price: consumers
 * are expected to check `updatedAt` against their own tolerance (or call
 * `PreIpoPriceOracle.getPrice`, which does). `startedAt` equals `updatedAt`
 * and `answeredInRound` equals `roundId`, since every round is answered in
 * the transaction that opens it. It reverts when no price has been written,
 * rather than returning a zero answer a careless consumer might accept.
 */
contract PreIpoPriceFeed is AggregatorV3Interface {
    PreIpoPriceOracle public immutable oracle;
    bytes32 public immutable key;
    uint256 public constant override version = 1;

    error NoData();

    constructor(PreIpoPriceOracle oracle_, bytes32 key_) {
        oracle = oracle_;
        key = key_;
    }

    function decimals() external view override returns (uint8) {
        return oracle.DECIMALS();
    }

    function description() external view override returns (string memory) {
        return oracle.assetConfig(key).description;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        PreIpoPriceOracle.Round memory round;
        (roundId, round) = oracle.latestRound(key);
        if (roundId == 0) revert NoData();
        return (roundId, int256(uint256(round.price)), round.updatedAt, round.updatedAt, roundId);
    }

    function getRoundData(uint80 roundId_)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        PreIpoPriceOracle.Round memory round = oracle.getRound(key, roundId_);
        return (roundId_, int256(uint256(round.price)), round.updatedAt, round.updatedAt, roundId_);
    }

    /** @notice Sources and dispersion behind the latest answer, beyond what AggregatorV3 carries. */
    function latestConfidence() external view returns (uint16 sourceCount, uint16 dispersionBps, bool stale) {
        (, PreIpoPriceOracle.Round memory round) = oracle.latestRound(key);
        return (round.sourceCount, round.dispersionBps, oracle.isStale(key));
    }
}
