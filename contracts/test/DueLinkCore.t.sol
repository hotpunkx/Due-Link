// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DueLinkCore} from "../src/DueLinkCore.sol";
import {LinkTypes} from "../src/libraries/LinkTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract DueLinkCoreTest is Test {
    DueLinkCore core;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("feeRecipient");
    address alice = makeAddr("alice"); // often initiator / lender / buyer / payee
    address bob = makeAddr("bob"); // often counterparty / borrower / seller / payer

    uint16 constant FEE_BPS = 25; // 0.25%
    uint256 constant USDC1 = 1_000_000; // 1 USDC at 6 decimals

    function setUp() public {
        usdc = new MockUSDC();
        core = new DueLinkCore(address(usdc), feeRecipient, FEE_BPS, owner);

        usdc.mint(alice, 100_000 * USDC1);
        usdc.mint(bob, 100_000 * USDC1);

        vm.prank(alice);
        usdc.approve(address(core), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(core), type(uint256).max);
    }

    // =====================================================================
    // SEND
    // =====================================================================

    function test_send_createAndAccept_settlesNetOfFee() public {
        vm.prank(alice);
        uint256 id = core.createSendLink(bob, 100 * USDC1, 0, bytes32("memo"));

        // funds escrowed from alice immediately
        assertEq(usdc.balanceOf(address(core)), 100 * USDC1);

        vm.prank(bob);
        core.acceptSendLink(id);

        uint256 fee = (100 * USDC1 * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(bob), 100_000 * USDC1 + 100 * USDC1 - fee);
        assertEq(usdc.balanceOf(feeRecipient), fee);

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.FULFILLED));
    }

    function test_send_onlyCounterpartyCanAccept() public {
        vm.prank(alice);
        uint256 id = core.createSendLink(bob, 10 * USDC1, 0, bytes32(0));

        vm.expectRevert(DueLinkCore.NotCounterparty.selector);
        vm.prank(alice);
        core.acceptSendLink(id);
    }

    function test_send_cancelRefundsInitiator() public {
        vm.prank(alice);
        uint256 id = core.createSendLink(bob, 10 * USDC1, 0, bytes32(0));

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        core.cancelSendLink(id);
        assertEq(usdc.balanceOf(alice), balBefore + 10 * USDC1);
    }

    function test_send_expiredCannotBeAccepted() public {
        vm.prank(alice);
        uint256 id = core.createSendLink(bob, 10 * USDC1, block.timestamp + 1 hours, bytes32(0));

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(DueLinkCore.LinkExpired.selector);
        vm.prank(bob);
        core.acceptSendLink(id);
    }

    // =====================================================================
    // LOAN
    // =====================================================================

    function test_loan_fullLifecycle_collateralized() public {
        uint256 principal = 1000 * USDC1;
        uint16 interestBps = 500; // 5%
        uint256 dueDate = block.timestamp + 30 days;
        uint256 collateral = 1500 * USDC1;

        vm.prank(alice); // lender
        uint256 id =
            core.createLoanLink(bob, principal, interestBps, dueDate, 1, address(usdc), collateral, bytes32(0));

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 bobBalBefore = usdc.balanceOf(bob);

        vm.prank(bob); // borrower accepts: collateral pulled, principal disbursed
        core.acceptLoanLink(id);

        assertEq(usdc.balanceOf(alice), aliceBalBefore - principal);
        assertEq(usdc.balanceOf(bob), bobBalBefore + principal - collateral);

        uint256 owed = core.getLoanTotalOwed(id);
        assertEq(owed, principal + (principal * interestBps) / 10000);

        vm.prank(bob);
        core.repayLoan(id, owed);

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.FULFILLED));

        // borrower: received principal, paid collateral in, paid `owed` out,
        // then got collateral back in full on fulfillment.
        assertEq(usdc.balanceOf(bob), bobBalBefore + principal - owed);

        LinkTypes.LoanTerms memory terms = core.getLoanTerms(id);
        assertTrue(terms.collateralClaimed);
    }

    function test_loan_partialRepaymentsAccumulate() public {
        uint256 principal = 1000 * USDC1;
        vm.prank(alice);
        uint256 id = core.createLoanLink(bob, principal, 0, block.timestamp + 30 days, 3, address(0), 0, bytes32(0));

        vm.prank(bob);
        core.acceptLoanLink(id);

        vm.prank(bob);
        core.repayLoan(id, 400 * USDC1);
        vm.prank(bob);
        core.repayLoan(id, 600 * USDC1);

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.FULFILLED));
    }

    function test_loan_defaultLiquidatesCollateralToLender() public {
        uint256 principal = 1000 * USDC1;
        uint256 collateral = 1200 * USDC1;
        vm.prank(alice);
        uint256 id = core.createLoanLink(
            bob, principal, 0, block.timestamp + 7 days, 1, address(usdc), collateral, bytes32(0)
        );

        vm.prank(bob);
        core.acceptLoanLink(id);

        vm.warp(block.timestamp + 8 days);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        core.checkLoanDefault(id); // callable by anyone

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.DEFAULTED));
        assertEq(usdc.balanceOf(alice), aliceBalBefore + collateral);
        assertEq(core.reputation().fulfillmentRateBps(bob), 0);
    }

    function test_loan_uncollateralizedDefault_noSeizureButReputationHit() public {
        uint256 principal = 500 * USDC1;
        vm.prank(alice);
        uint256 id =
            core.createLoanLink(bob, principal, 0, block.timestamp + 7 days, 1, address(0), 0, bytes32(0));

        vm.prank(bob);
        core.acceptLoanLink(id);

        vm.warp(block.timestamp + 8 days);
        core.checkLoanDefault(id);

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.DEFAULTED));
        assertEq(core.reputation().fulfillmentRateBps(bob), 0);
    }

    function test_loan_cannotDefaultBeforeDueDate() public {
        vm.prank(alice);
        uint256 id = core.createLoanLink(bob, 100 * USDC1, 0, block.timestamp + 7 days, 1, address(0), 0, bytes32(0));
        vm.prank(bob);
        core.acceptLoanLink(id);

        vm.expectRevert(DueLinkCore.DueDateNotReached.selector);
        core.checkLoanDefault(id);
    }

    // =====================================================================
    // ESCROW
    // =====================================================================

    function test_escrow_manualConfirmReleasesToSeller() public {
        vm.prank(alice); // buyer
        uint256 id = core.createEscrowLink(
            bob, 200 * USDC1, LinkTypes.EscrowReleaseMode.MANUAL, 0, address(0), bytes32(0), bytes32(0)
        );

        vm.prank(bob); // seller accepts
        core.acceptEscrowLink(id);

        uint256 bobBalBefore = usdc.balanceOf(bob);
        vm.prank(alice);
        core.confirmDelivery(id);

        uint256 fee = (200 * USDC1 * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(bob), bobBalBefore + 200 * USDC1 - fee);
    }

    function test_escrow_timelockAutoReleaseProtectsSeller() public {
        uint256 releaseAt = block.timestamp + 3 days;
        vm.prank(alice);
        uint256 id = core.createEscrowLink(
            bob, 50 * USDC1, LinkTypes.EscrowReleaseMode.TIMELOCK, releaseAt, address(0), bytes32(0), bytes32(0)
        );
        vm.prank(bob);
        core.acceptEscrowLink(id);

        vm.expectRevert(DueLinkCore.DueDateNotReached.selector);
        core.autoRelease(id);

        vm.warp(releaseAt + 1);
        uint256 bobBalBefore = usdc.balanceOf(bob);
        core.autoRelease(id); // anyone can call
        assertGt(usdc.balanceOf(bob), bobBalBefore);
    }

    function test_escrow_disputeAndArbitratorResolvesToBuyerRefund() public {
        address arbitrator = makeAddr("arbitrator");
        vm.prank(alice);
        uint256 id = core.createEscrowLink(
            bob, 300 * USDC1, LinkTypes.EscrowReleaseMode.ARBITRATED, 0, arbitrator, bytes32(0), bytes32(0)
        );
        vm.prank(bob);
        core.acceptEscrowLink(id);

        vm.prank(bob);
        core.raiseDispute(id);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(arbitrator);
        core.resolveDispute(id, false); // refund buyer

        assertEq(usdc.balanceOf(alice), aliceBalBefore + 300 * USDC1);
        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.CANCELLED));
    }

    function test_escrow_nonArbitratorCannotResolve() public {
        vm.prank(alice);
        uint256 id = core.createEscrowLink(
            bob, 10 * USDC1, LinkTypes.EscrowReleaseMode.MANUAL, 0, address(0), bytes32(0), bytes32(0)
        );
        vm.prank(bob);
        core.acceptEscrowLink(id);
        vm.prank(alice);
        core.raiseDispute(id);

        vm.expectRevert(DueLinkCore.NotArbitrator.selector);
        vm.prank(alice);
        core.resolveDispute(id, true);
    }

    // =====================================================================
    // INVOICE
    // =====================================================================

    function test_invoice_fullPaymentSettlesToPayee() public {
        vm.prank(alice); // payee
        uint256 id =
            core.createInvoiceLink(bob, 800 * USDC1, block.timestamp + 14 days, 500, false, 0, bytes32(0));

        vm.prank(bob); // payer accepts
        core.acceptInvoiceLink(id);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(bob);
        core.payInvoice(id, 800 * USDC1);

        uint256 fee = (800 * USDC1 * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(alice), aliceBalBefore + 800 * USDC1 - fee);

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.FULFILLED));
    }

    function test_invoice_partialPaymentsThenFulfilled() public {
        vm.prank(alice);
        uint256 id = core.createInvoiceLink(bob, 1000 * USDC1, block.timestamp + 30 days, 0, false, 0, bytes32(0));
        vm.prank(bob);
        core.acceptInvoiceLink(id);

        vm.prank(bob);
        core.payInvoice(id, 300 * USDC1);
        LinkTypes.InvoiceTerms memory terms = core.getInvoiceTerms(id);
        assertEq(terms.amountRemaining, 700 * USDC1);

        vm.prank(bob);
        core.payInvoice(id, 700 * USDC1);
        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.FULFILLED));
    }

    function test_invoice_overdueFlipsToDefaultButStillPayable() public {
        vm.prank(alice);
        uint256 id = core.createInvoiceLink(bob, 200 * USDC1, block.timestamp + 5 days, 200, false, 0, bytes32(0));
        vm.prank(bob);
        core.acceptInvoiceLink(id);

        vm.warp(block.timestamp + 6 days);
        core.checkOverdue(id); // anyone can call

        LinkTypes.Link memory link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.DEFAULTED));

        // still payable after default
        vm.prank(bob);
        core.payInvoice(id, 200 * USDC1);
        link = core.getLink(id);
        assertEq(uint8(link.status), uint8(LinkTypes.LinkStatus.FULFILLED));
    }

    function test_invoice_recurringSpawnsNextCycle() public {
        uint256 cycle = 30 days;
        vm.prank(alice);
        uint256 id =
            core.createInvoiceLink(bob, 100 * USDC1, block.timestamp + 1 days, 0, true, cycle, bytes32(0));
        vm.prank(bob);
        core.acceptInvoiceLink(id);

        vm.prank(bob);
        core.payInvoice(id, 100 * USDC1);

        assertEq(core.linkCount(), 2); // original + spawned recurrence
        LinkTypes.Link memory nextLink = core.getLink(2);
        assertEq(uint8(nextLink.linkType), uint8(LinkTypes.LinkType.INVOICE));
        assertEq(nextLink.initiator, alice);
        assertEq(nextLink.counterparty, bob);
    }

    // =====================================================================
    // Protocol fee admin
    // =====================================================================

    function test_admin_onlyOwnerCanSetFee() public {
        vm.expectRevert();
        core.setProtocolFeeBps(100);

        vm.prank(owner);
        core.setProtocolFeeBps(100);
        assertEq(core.protocolFeeBps(), 100);
    }

    function test_admin_feeCappedAt250Bps() public {
        vm.prank(owner);
        vm.expectRevert(DueLinkCore.FeeTooHigh.selector);
        core.setProtocolFeeBps(251);
    }
}
