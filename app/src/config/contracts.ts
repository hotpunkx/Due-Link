import { DueLinkCoreAbi } from "./DueLinkCore.abi";

export { DueLinkCoreAbi };

/**
 * USDC ERC-20 interface on Arc Testnet. 6 decimals — this is the address to
 * use for balances/allowances/transfers, per Arc's guidance (the *native*
 * gas token is also called USDC but uses 18 decimals and is a distinct
 * representation of the same underlying balance).
 * https://docs.arc.io/arc/references/contract-addresses
 */
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;

/**
 * DueLinkCore deployment address. Filled in after running
 * `forge script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast`
 * from /contracts. Until then this is an unset placeholder and the app runs
 * in a clearly-labeled "not deployed" state (see useDueLink.ts).
 */
export const DUELINK_CORE_ADDRESS = (import.meta.env.VITE_DUELINK_CORE_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const IS_CONTRACT_DEPLOYED =
  DUELINK_CORE_ADDRESS !== "0x0000000000000000000000000000000000000000";

export const MINIMAL_ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
