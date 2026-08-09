// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {LinkTypes} from "./libraries/LinkTypes.sol";
import {ReputationRegistry} from "./ReputationRegistry.sol";

/// @title DueLinkCore
/// @notice Single onchain object ("Link") representing any direct obligation
///         between two wallets: a Send, a Loan, an Escrow Trade, or an Invoice.
///         Deployed on Arc, settled in USDC.
///
/// @dev MVP scope / explicitly deferred to v1.5 (see PRD §11):
///      - Invoice late fees are informational (computed by the frontend from
///        `lateFeeBps` + overdue duration) rather than compounded on-chain.
///      - Collateral liquidation on loan default transfers the *entire*
///        posted collateral to the lender (no price oracle / partial
///        liquidation in v1 — document this clearly to users of
///        collateralized loans).
///      - Escrow arbitration is a single designated address per Link, not a
///        decentralized jury.
contract DueLinkCore is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using LinkTypes for LinkTypes.Link;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    IERC20 public immutable usdc;
    ReputationRegistry public immutable reputation;

    address public feeRecipient;
    uint16 public protocolFeeBps; // e.g. 25 = 0.25%. Capped at 250 (2.5%).
    uint16 public constant MAX_FEE_BPS = 250;

    uint256 public nextLinkId = 1;

    mapping(uint256 => LinkTypes.Link) public links;
    mapping(uint256 => LinkTypes.LoanTerms) public loanTerms;
    mapping(uint256 => LinkTypes.EscrowTerms) public escrowTerms;
    mapping(uint256 => LinkTypes.InvoiceTerms) public invoiceTerms;
    mapping(address => uint256[]) public linksByUser;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event LinkCreated(
        uint256 indexed id,
        address indexed initiator,
        address indexed counterparty,
        LinkTypes.LinkType linkType,
        uint256 amount,
        bytes32 termsHash
    );
    event LinkAccepted(uint256 indexed id);
    event LinkCancelled(uint256 indexed id);
    event LinkFulfilled(uint256 indexed id, uint256 settledAmount);
    event LinkDefaulted(uint256 indexed id);
    event LinkDisputed(uint256 indexed id, address indexed raisedBy);
    event LinkDisputeResolved(uint256 indexed id, bool releasedToCounterpartyBeneficiary);
    event LoanCollateralDeposited(uint256 indexed id, uint256 amount);
    event LoanCollateralLiquidated(uint256 indexed id, uint256 amount);
    event LoanRepayment(uint256 indexed id, uint256 amount, uint256 totalRepaid);
    event InvoicePayment(uint256 indexed id, uint256 amount, uint256 remaining);
    event RecurringInvoiceSpawned(uint256 indexed parentId, uint256 indexed newId);
    event ProtocolFeeUpdated(uint16 newFeeBps);
    event FeeRecipientUpdated(address newRecipient);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotInitiator();
    error NotCounterparty();
    error NotParty();
    error NotArbitrator();
    error WrongStatus();
    error WrongType();
    error LinkExpired();
    error ZeroAmount();
    error ZeroAddress();
    error FeeTooHigh();
    error NothingOwed();
    error DueDateNotReached();
    error AlreadyResolved();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address _usdc, address _feeRecipient, uint16 _protocolFeeBps, address _owner) Ownable(_owner) {
        if (_usdc == address(0) || _feeRecipient == address(0) || _owner == address(0)) revert ZeroAddress();
        if (_protocolFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        usdc = IERC20(_usdc);
        feeRecipient = _feeRecipient;
        protocolFeeBps = _protocolFeeBps;
        reputation = new ReputationRegistry(address(this));
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setProtocolFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _recordLink(LinkTypes.Link memory link) internal {
        links[link.id] = link;
        linksByUser[link.initiator].push(link.id);
        linksByUser[link.counterparty].push(link.id);
        emit LinkCreated(link.id, link.initiator, link.counterparty, link.linkType, link.amount, link.termsHash);
    }

    /// @dev Pulls `amount` from `to's counterpart`... transfers `amount` from
    ///      `from` to this contract or moves escrowed balance to `to`, net of
    ///      protocol fee, which is routed to `feeRecipient`.
    function _settleOut(address to, uint256 amount) internal returns (uint256 settled) {
        uint256 fee = (amount * protocolFeeBps) / 10000;
        settled = amount - fee;
        if (fee > 0) usdc.safeTransfer(feeRecipient, fee);
        usdc.safeTransfer(to, settled);
    }

    function _pull(address from, uint256 amount) internal {
        usdc.safeTransferFrom(from, address(this), amount);
    }

    // =====================================================================
    // SEND
    // =====================================================================

    /// @notice Create a Send Link. Funds are escrowed from the caller
    ///         immediately and released to `counterparty` on acceptance.
    function createSendLink(address counterparty, uint256 amount, uint256 expiresAt, bytes32 termsHash)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (counterparty == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        id = nextLinkId++;
        _pull(msg.sender, amount);

        _recordLink(
            LinkTypes.Link({
                id: id,
                initiator: msg.sender,
                counterparty: counterparty,
                linkType: LinkTypes.LinkType.SEND,
                status: LinkTypes.LinkStatus.PENDING_ACCEPTANCE,
                token: address(usdc),
                amount: amount,
                createdAt: block.timestamp,
                expiresAt: expiresAt,
                termsHash: termsHash
            })
        );
    }

    function acceptSendLink(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.SEND) revert WrongType();
        if (msg.sender != link.counterparty) revert NotCounterparty();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();
        if (link.expiresAt != 0 && block.timestamp > link.expiresAt) revert LinkExpired();

        link.status = LinkTypes.LinkStatus.FULFILLED;
        uint256 settled = _settleOut(link.counterparty, link.amount);

        reputation.recordFulfillment(link.initiator, link.amount);
        emit LinkAccepted(id);
        emit LinkFulfilled(id, settled);
    }

    function cancelSendLink(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.SEND) revert WrongType();
        if (msg.sender != link.initiator) revert NotInitiator();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.CANCELLED;
        usdc.safeTransfer(link.initiator, link.amount);
        emit LinkCancelled(id);
    }

    // =====================================================================
    // LOAN  (collateralized or reputation-only, per PRD §5.2 / §11)
    // =====================================================================

    /// @notice Lender proposes loan terms. No funds move yet — principal and
    ///         any collateral are pulled atomically when the borrower accepts.
    function createLoanLink(
        address borrower,
        uint256 principal,
        uint16 interestBps,
        uint256 dueDate,
        uint8 installments,
        address collateralToken,
        uint256 collateralAmount,
        bytes32 termsHash
    ) external returns (uint256 id) {
        if (borrower == address(0)) revert ZeroAddress();
        if (principal == 0) revert ZeroAmount();
        if (dueDate <= block.timestamp) revert DueDateNotReached();

        id = nextLinkId++;

        _recordLink(
            LinkTypes.Link({
                id: id,
                initiator: msg.sender, // lender
                counterparty: borrower,
                linkType: LinkTypes.LinkType.LOAN,
                status: LinkTypes.LinkStatus.PENDING_ACCEPTANCE,
                token: address(usdc),
                amount: principal,
                createdAt: block.timestamp,
                expiresAt: 0,
                termsHash: termsHash
            })
        );

        loanTerms[id] = LinkTypes.LoanTerms({
            interestBps: interestBps,
            dueDate: dueDate,
            installments: installments,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            amountRepaid: 0,
            collateralDeposited: false,
            collateralClaimed: false
        });
    }

    /// @notice Borrower accepts. Pulls collateral (if any) from borrower,
    ///         then pulls principal from lender and forwards it to borrower.
    function acceptLoanLink(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.LoanTerms storage terms = loanTerms[id];
        if (link.linkType != LinkTypes.LinkType.LOAN) revert WrongType();
        if (msg.sender != link.counterparty) revert NotCounterparty();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.ACTIVE;

        if (terms.collateralAmount > 0) {
            IERC20(terms.collateralToken).safeTransferFrom(msg.sender, address(this), terms.collateralAmount);
            terms.collateralDeposited = true;
            emit LoanCollateralDeposited(id, terms.collateralAmount);
        }

        usdc.safeTransferFrom(link.initiator, link.counterparty, link.amount);
        emit LinkAccepted(id);
    }

    function _totalOwed(uint256 id) internal view returns (uint256) {
        LinkTypes.Link storage link = links[id];
        LinkTypes.LoanTerms storage terms = loanTerms[id];
        return link.amount + (link.amount * terms.interestBps) / 10000;
    }

    /// @notice Borrower repays any amount, any number of times, until the
    ///         loan is fully repaid (principal + flat interest).
    function repayLoan(uint256 id, uint256 amount) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.LoanTerms storage terms = loanTerms[id];
        if (link.linkType != LinkTypes.LinkType.LOAN) revert WrongType();
        if (msg.sender != link.counterparty) revert NotCounterparty();
        if (link.status != LinkTypes.LinkStatus.ACTIVE && link.status != LinkTypes.LinkStatus.DEFAULTED) {
            revert WrongStatus();
        }
        if (amount == 0) revert ZeroAmount();

        uint256 owed = _totalOwed(id);
        uint256 remaining = owed - terms.amountRepaid;
        uint256 payment = amount > remaining ? remaining : amount;

        _pull(msg.sender, payment);
        uint256 settled = _settleOut(link.initiator, payment);
        terms.amountRepaid += payment;

        emit LoanRepayment(id, payment, terms.amountRepaid);

        if (terms.amountRepaid >= owed) {
            link.status = LinkTypes.LinkStatus.FULFILLED;
            if (terms.collateralDeposited && !terms.collateralClaimed) {
                terms.collateralClaimed = true;
                IERC20(terms.collateralToken).safeTransfer(link.counterparty, terms.collateralAmount);
            }
            reputation.recordFulfillment(link.counterparty, owed);
            emit LinkFulfilled(id, settled);
        }
    }

    /// @notice Anyone may trigger default handling once the due date has
    ///         passed with an outstanding balance. Collateralized loans
    ///         liquidate the full posted collateral to the lender (v1 has no
    ///         price oracle for partial liquidation — see contract-level
    ///         docs). Uncollateralized loans simply mark the borrower's
    ///         reputation.
    function checkLoanDefault(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.LoanTerms storage terms = loanTerms[id];
        if (link.linkType != LinkTypes.LinkType.LOAN) revert WrongType();
        if (link.status != LinkTypes.LinkStatus.ACTIVE) revert WrongStatus();
        if (block.timestamp <= terms.dueDate) revert DueDateNotReached();
        if (terms.amountRepaid >= _totalOwed(id)) revert NothingOwed();

        link.status = LinkTypes.LinkStatus.DEFAULTED;
        reputation.recordDefault(link.counterparty);
        emit LinkDefaulted(id);

        if (terms.collateralDeposited && !terms.collateralClaimed) {
            terms.collateralClaimed = true;
            IERC20(terms.collateralToken).safeTransfer(link.initiator, terms.collateralAmount);
            emit LoanCollateralLiquidated(id, terms.collateralAmount);
        }
    }

    function cancelLoanLink(uint256 id) external {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.LOAN) revert WrongType();
        if (msg.sender != link.initiator) revert NotInitiator();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.CANCELLED;
        emit LinkCancelled(id);
    }

    // =====================================================================
    // ESCROW TRADE
    // =====================================================================

    /// @notice Buyer creates the Link and escrows funds immediately.
    function createEscrowLink(
        address seller,
        uint256 amount,
        LinkTypes.EscrowReleaseMode releaseMode,
        uint256 autoReleaseAt,
        address arbitrator,
        bytes32 deliverableHash,
        bytes32 termsHash
    ) external nonReentrant returns (uint256 id) {
        if (seller == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (releaseMode == LinkTypes.EscrowReleaseMode.TIMELOCK && autoReleaseAt <= block.timestamp) {
            revert DueDateNotReached();
        }

        id = nextLinkId++;
        _pull(msg.sender, amount);

        _recordLink(
            LinkTypes.Link({
                id: id,
                initiator: msg.sender, // buyer
                counterparty: seller,
                linkType: LinkTypes.LinkType.ESCROW,
                status: LinkTypes.LinkStatus.PENDING_ACCEPTANCE,
                token: address(usdc),
                amount: amount,
                createdAt: block.timestamp,
                expiresAt: 0,
                termsHash: termsHash
            })
        );

        escrowTerms[id] = LinkTypes.EscrowTerms({
            releaseMode: releaseMode,
            autoReleaseAt: autoReleaseAt,
            arbitrator: arbitrator,
            deliverableHash: deliverableHash,
            buyerConfirmed: false
        });
    }

    function acceptEscrowLink(uint256 id) external {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.ESCROW) revert WrongType();
        if (msg.sender != link.counterparty) revert NotCounterparty();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.ACTIVE;
        emit LinkAccepted(id);
    }

    /// @notice Buyer confirms delivery and releases funds to the seller.
    function confirmDelivery(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.EscrowTerms storage terms = escrowTerms[id];
        if (link.linkType != LinkTypes.LinkType.ESCROW) revert WrongType();
        if (msg.sender != link.initiator) revert NotInitiator();
        if (link.status != LinkTypes.LinkStatus.ACTIVE) revert WrongStatus();

        terms.buyerConfirmed = true;
        link.status = LinkTypes.LinkStatus.FULFILLED;
        uint256 settled = _settleOut(link.counterparty, link.amount);

        reputation.recordFulfillment(link.counterparty, link.amount);
        emit LinkFulfilled(id, settled);
    }

    /// @notice Anyone may trigger the timelocked auto-release once due,
    ///         protecting sellers from a buyer who simply never confirms.
    function autoRelease(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.EscrowTerms storage terms = escrowTerms[id];
        if (link.linkType != LinkTypes.LinkType.ESCROW) revert WrongType();
        if (link.status != LinkTypes.LinkStatus.ACTIVE) revert WrongStatus();
        if (terms.releaseMode != LinkTypes.EscrowReleaseMode.TIMELOCK) revert WrongType();
        if (block.timestamp < terms.autoReleaseAt) revert DueDateNotReached();

        link.status = LinkTypes.LinkStatus.FULFILLED;
        uint256 settled = _settleOut(link.counterparty, link.amount);

        reputation.recordFulfillment(link.counterparty, link.amount);
        emit LinkFulfilled(id, settled);
    }

    function raiseDispute(uint256 id) external {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.ESCROW) revert WrongType();
        if (msg.sender != link.initiator && msg.sender != link.counterparty) revert NotParty();
        if (link.status != LinkTypes.LinkStatus.ACTIVE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.DISPUTED;
        reputation.recordDispute(link.initiator);
        reputation.recordDispute(link.counterparty);
        emit LinkDisputed(id, msg.sender);
    }

    /// @notice Designated arbitrator resolves a disputed Escrow Link.
    function resolveDispute(uint256 id, bool releaseToSeller) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.EscrowTerms storage terms = escrowTerms[id];
        if (link.linkType != LinkTypes.LinkType.ESCROW) revert WrongType();
        if (msg.sender != terms.arbitrator || terms.arbitrator == address(0)) revert NotArbitrator();
        if (link.status != LinkTypes.LinkStatus.DISPUTED) revert WrongStatus();

        if (releaseToSeller) {
            link.status = LinkTypes.LinkStatus.FULFILLED;
            uint256 settled = _settleOut(link.counterparty, link.amount);
            reputation.recordFulfillment(link.counterparty, link.amount);
            emit LinkFulfilled(id, settled);
        } else {
            link.status = LinkTypes.LinkStatus.CANCELLED;
            usdc.safeTransfer(link.initiator, link.amount);
            emit LinkCancelled(id);
        }
        emit LinkDisputeResolved(id, releaseToSeller);
    }

    function cancelEscrowLink(uint256 id) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.ESCROW) revert WrongType();
        if (msg.sender != link.initiator) revert NotInitiator();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.CANCELLED;
        usdc.safeTransfer(link.initiator, link.amount);
        emit LinkCancelled(id);
    }

    // =====================================================================
    // INVOICE
    // =====================================================================

    function createInvoiceLink(
        address payer,
        uint256 amount,
        uint256 dueDate,
        uint16 lateFeeBps,
        bool recurring,
        uint256 cycleSeconds,
        bytes32 termsHash
    ) external returns (uint256 id) {
        id = _createInvoiceLink(msg.sender, payer, amount, dueDate, lateFeeBps, recurring, cycleSeconds, termsHash);
    }

    function _createInvoiceLink(
        address payee,
        address payer,
        uint256 amount,
        uint256 dueDate,
        uint16 lateFeeBps,
        bool recurring,
        uint256 cycleSeconds,
        bytes32 termsHash
    ) internal returns (uint256 id) {
        if (payer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        id = nextLinkId++;

        _recordLink(
            LinkTypes.Link({
                id: id,
                initiator: payee,
                counterparty: payer,
                linkType: LinkTypes.LinkType.INVOICE,
                status: LinkTypes.LinkStatus.PENDING_ACCEPTANCE,
                token: address(usdc),
                amount: amount,
                createdAt: block.timestamp,
                expiresAt: 0,
                termsHash: termsHash
            })
        );

        invoiceTerms[id] = LinkTypes.InvoiceTerms({
            dueDate: dueDate,
            lateFeeBps: lateFeeBps,
            recurring: recurring,
            cycleSeconds: cycleSeconds,
            amountRemaining: amount
        });
    }

    function acceptInvoiceLink(uint256 id) external {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.INVOICE) revert WrongType();
        if (msg.sender != link.counterparty) revert NotCounterparty();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.ACTIVE;
        emit LinkAccepted(id);
    }

    /// @notice Payer pays any amount, any number of times (partial payments
    ///         allowed), even after the invoice has flipped to DEFAULTED.
    function payInvoice(uint256 id, uint256 amount) external nonReentrant {
        LinkTypes.Link storage link = links[id];
        LinkTypes.InvoiceTerms storage terms = invoiceTerms[id];
        if (link.linkType != LinkTypes.LinkType.INVOICE) revert WrongType();
        if (msg.sender != link.counterparty) revert NotCounterparty();
        if (link.status != LinkTypes.LinkStatus.ACTIVE && link.status != LinkTypes.LinkStatus.DEFAULTED) {
            revert WrongStatus();
        }
        if (amount == 0) revert ZeroAmount();

        uint256 payment = amount > terms.amountRemaining ? terms.amountRemaining : amount;
        _pull(msg.sender, payment);
        uint256 settled = _settleOut(link.initiator, payment);
        terms.amountRemaining -= payment;

        emit InvoicePayment(id, payment, terms.amountRemaining);

        if (terms.amountRemaining == 0) {
            link.status = LinkTypes.LinkStatus.FULFILLED;
            reputation.recordFulfillment(link.counterparty, link.amount);
            emit LinkFulfilled(id, settled);

            if (terms.recurring) {
                uint256 newId = _createInvoiceLink(
                    link.initiator,
                    link.counterparty,
                    link.amount,
                    terms.dueDate + terms.cycleSeconds,
                    terms.lateFeeBps,
                    true,
                    terms.cycleSeconds,
                    link.termsHash
                );
                emit RecurringInvoiceSpawned(id, newId);
            }
        }
    }

    /// @notice Anyone may flip an overdue, unpaid invoice to DEFAULTED for
    ///         visibility/reputation purposes. Does not block future payment.
    function checkOverdue(uint256 id) external {
        LinkTypes.Link storage link = links[id];
        LinkTypes.InvoiceTerms storage terms = invoiceTerms[id];
        if (link.linkType != LinkTypes.LinkType.INVOICE) revert WrongType();
        if (link.status != LinkTypes.LinkStatus.ACTIVE) revert WrongStatus();
        if (block.timestamp <= terms.dueDate) revert DueDateNotReached();
        if (terms.amountRemaining == 0) revert NothingOwed();

        link.status = LinkTypes.LinkStatus.DEFAULTED;
        reputation.recordDefault(link.counterparty);
        emit LinkDefaulted(id);
    }

    function cancelInvoiceLink(uint256 id) external {
        LinkTypes.Link storage link = links[id];
        if (link.linkType != LinkTypes.LinkType.INVOICE) revert WrongType();
        if (msg.sender != link.initiator) revert NotInitiator();
        if (link.status != LinkTypes.LinkStatus.PENDING_ACCEPTANCE) revert WrongStatus();

        link.status = LinkTypes.LinkStatus.CANCELLED;
        emit LinkCancelled(id);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getLink(uint256 id) external view returns (LinkTypes.Link memory) {
        return links[id];
    }

    function getLoanTerms(uint256 id) external view returns (LinkTypes.LoanTerms memory) {
        return loanTerms[id];
    }

    function getEscrowTerms(uint256 id) external view returns (LinkTypes.EscrowTerms memory) {
        return escrowTerms[id];
    }

    function getInvoiceTerms(uint256 id) external view returns (LinkTypes.InvoiceTerms memory) {
        return invoiceTerms[id];
    }

    function getLoanTotalOwed(uint256 id) external view returns (uint256) {
        return _totalOwed(id);
    }

    function getLinksByUser(address user) external view returns (uint256[] memory) {
        return linksByUser[user];
    }

    function linkCount() external view returns (uint256) {
        return nextLinkId - 1;
    }
}
