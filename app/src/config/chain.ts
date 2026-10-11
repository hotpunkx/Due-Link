import { defineChain } from "viem";

/**
 * Arc Mainnet — network parameters per Arc's docs:
 * https://docs.arc.io/arc/references/connect-to-arc
 * Chain ID: 5042
 */
export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: {
    // Native gas token is USDC on Arc, using 18 decimals for the native
    // currency representation. For balances/transfers in the app, we use
    // the separate USDC ERC-20 interface (6 decimals) — see contracts.ts.
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.arc.io"],
      webSocket: ["wss://rpc.mainnet.arc.io"],
    },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://explorer.arc.io" },
  },
  testnet: false,
});

/**
 * Arc Testnet — kept for reference / local testing.
 * Chain ID: 5042002
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

