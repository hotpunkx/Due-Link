import { defineChain } from "viem";

/**
 * Arc Testnet — network parameters confirmed against Arc's docs at build time:
 * https://docs.arc.io/arc/references/connect-to-arc
 *
 * Note: `viem` ships `arcTestnet` as a built-in chain (`import { arcTestnet } from "viem/chains"`)
 * as of the version referenced in Arc's docs. It's redefined explicitly here so this
 * config keeps working even if the installed viem version predates that export, and so
 * the RPC URL / explorer are visible and easy to audit in one place.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
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
      http: ["https://rpc.testnet.arc.network"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});
