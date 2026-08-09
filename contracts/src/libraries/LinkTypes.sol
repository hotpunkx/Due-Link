// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LinkTypes
/// @notice Shared enums and structs for the DueLink protocol.
/// @dev A "Link" is the universal object representing a bilateral obligation
///      between an `initiator` and a `counterparty`. Type-specific terms live
///      in separate mappings on DueLinkCore, keyed by link id, to keep the
///      base struct compact and the core contract easy to reason about.
library LinkTypes {
    enum LinkType {
        SEND,
        LOAN,
        ESCROW,
        INVOICE
    }

    enum LinkStatus {
        PENDING_ACCEPTANCE, // created, awaiting counterparty acceptance
        ACTIVE, // accepted; obligation live (funds may or may not be locked)
        FULFILLED, // terms met, funds settled, link closed
        DEFAULTED, // deadline passed without fulfillment
        DISPUTED, // frozen pending arbitration (escrow only)
        CANCELLED // cancelled before or after acceptance by mutual/initiator action
    }

    enum EscrowReleaseMode {
        MANUAL,
        TIMELOCK,
        ARBITRATED
    }

    struct Link {
        uint256 id;
        address initiator;
        address counterparty;
        LinkType linkType;
        LinkStatus status;
        address token; // ERC-20 settlement asset (USDC on Arc)
        uint256 amount; // principal / face amount, in token's smallest unit
        uint256 createdAt;
        uint256 expiresAt; // 0 = no acceptance expiry
        bytes32 termsHash; // pointer to off-chain terms doc (IPFS/Arweave)
    }

    struct LoanTerms {
        uint16 interestBps; // flat interest, in basis points of principal
        uint256 dueDate;
        uint8 installments; // informational; repayment accepted any time/amount
        address collateralToken; // address(0) = uncollateralized (reputation-only)
        uint256 collateralAmount;
        uint256 amountRepaid;
        bool collateralDeposited;
        bool collateralClaimed;
    }

    struct EscrowTerms {
        EscrowReleaseMode releaseMode;
        uint256 autoReleaseAt; // used when releaseMode == TIMELOCK
        address arbitrator; // used when releaseMode == ARBITRATED
        bytes32 deliverableHash;
        bool buyerConfirmed;
    }

    struct InvoiceTerms {
        uint256 dueDate;
        uint16 lateFeeBps; // accrued per overdue "period" at checkOverdue() call
        bool recurring;
        uint256 cycleSeconds;
        uint256 amountRemaining;
    }
}
