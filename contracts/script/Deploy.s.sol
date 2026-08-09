// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DueLinkCore} from "../src/DueLinkCore.sol";

/// @notice Deploys DueLinkCore to Arc Testnet against the real USDC ERC-20
///         interface. Addresses per https://docs.arc.io/arc/references/contract-addresses
///
///         Usage:
///           source .env
///           forge script script/Deploy.s.sol:Deploy \
///             --rpc-url arc_testnet \
///             --broadcast \
///             --use $HOME/.svm/0.8.24/solc-0.8.24   # or your local solc 0.8.24
///
///         Requires in .env:
///           PRIVATE_KEY=0x...            (must hold testnet USDC for gas; get from https://faucet.circle.com)
///           FEE_RECIPIENT=0x...          (protocol fee treasury address)
///           PROTOCOL_OWNER=0x...         (admin address, can differ from deployer)
contract Deploy is Script {
    // Arc Testnet USDC ERC-20 interface (6 decimals). Native gas token is
    // also USDC but uses 18 decimals — do NOT use for Link amounts.
    // https://docs.arc.io/arc/references/contract-addresses
    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    uint16 constant DEFAULT_PROTOCOL_FEE_BPS = 25; // 0.25%

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", vm.addr(deployerKey));
        address owner = vm.envOr("PROTOCOL_OWNER", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        DueLinkCore core = new DueLinkCore(ARC_TESTNET_USDC, feeRecipient, DEFAULT_PROTOCOL_FEE_BPS, owner);

        vm.stopBroadcast();

        console.log("DueLinkCore deployed at:      ", address(core));
        console.log("ReputationRegistry deployed at:", address(core.reputation()));
        console.log("USDC (Arc Testnet):            ", ARC_TESTNET_USDC);
        console.log("Fee recipient:                 ", feeRecipient);
        console.log("Owner:                         ", owner);
        console.log("");
        console.log("Verify on ArcScan:", string.concat("https://testnet.arcscan.app/address/", vm.toString(address(core))));
    }
}
