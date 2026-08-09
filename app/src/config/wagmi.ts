import { createConfig, http } from "wagmi";
import { mainnet } from "viem/chains";
import { getDefaultConfig } from "connectkit";
import { arcTestnet } from "./chain";

// A WalletConnect Cloud project id is required for ConnectKit to surface the
// full universe of EVM wallets (mobile wallets via QR, injected wallets,
// Coinbase Wallet, Rainbow, etc.) — not just browser-injected MetaMask.
// Get one free at https://cloud.walletconnect.com and set
// VITE_WALLETCONNECT_PROJECT_ID in app/.env. Without it, ConnectKit still
// works for browser-injected wallets (MetaMask, Rabby, Coinbase extension),
// it just can't offer WalletConnect's mobile-wallet QR flow.
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "";

export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [arcTestnet, mainnet],
    transports: {
      // mainnet transport included per Arc's own guidance: ConnectKit needs
      // a CORS-safe mainnet transport for ENS lookups even when the app
      // itself only operates on Arc Testnet.
      [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
      [mainnet.id]: http("https://cloudflare-eth.com"),
    },
    walletConnectProjectId,
    appName: "DueLink",
    appDescription: "One Link for any obligation — Send, Loan, Escrow, Invoice — on Arc.",
    appUrl: typeof window !== "undefined" ? window.location.origin : "https://duelink.app",
  }),
);
