// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @title ReputationRegistry
/// @notice Tracks per-address fulfillment history across all Link types.
///         Written to exclusively by DueLinkCore (set as owner post-deploy).
contract ReputationRegistry is Ownable {
    struct Stats {
        uint64 linksFulfilled;
        uint64 linksDefaulted;
        uint64 linksDisputed;
        uint128 totalVolumeSettled; // in USDC smallest unit (6 decimals), capped by uint128
        uint256 firstLinkAt;
    }

    mapping(address => Stats) public statsOf;

    event FulfillmentRecorded(address indexed account, uint256 volume);
    event DefaultRecorded(address indexed account);
    event DisputeRecorded(address indexed account);

    constructor(address core) Ownable(core) {}

    function recordFulfillment(address account, uint256 volume) external onlyOwner {
        Stats storage s = statsOf[account];
        if (s.firstLinkAt == 0) s.firstLinkAt = block.timestamp;
        s.linksFulfilled += 1;
        s.totalVolumeSettled += uint128(volume);
        emit FulfillmentRecorded(account, volume);
    }

    function recordDefault(address account) external onlyOwner {
        Stats storage s = statsOf[account];
        if (s.firstLinkAt == 0) s.firstLinkAt = block.timestamp;
        s.linksDefaulted += 1;
        emit DefaultRecorded(account);
    }

    function recordDispute(address account) external onlyOwner {
        Stats storage s = statsOf[account];
        if (s.firstLinkAt == 0) s.firstLinkAt = block.timestamp;
        s.linksDisputed += 1;
        emit DisputeRecorded(account);
    }

    /// @notice Fulfillment rate in basis points (0-10000). Returns 10000 (100%)
    ///         for addresses with no history yet, so first-time counterparties
    ///         aren't penalized by a divide-by-zero read.
    function fulfillmentRateBps(address account) external view returns (uint256) {
        Stats memory s = statsOf[account];
        uint256 total = uint256(s.linksFulfilled) + uint256(s.linksDefaulted);
        if (total == 0) return 10000;
        return (uint256(s.linksFulfilled) * 10000) / total;
    }
}
