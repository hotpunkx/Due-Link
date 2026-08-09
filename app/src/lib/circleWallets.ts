/**
 * Circle Developer-Controlled Wallets integration point.
 *
 * PRD §9.1 calls for Circle Developer Wallets as the default onboarding path
 * for non-crypto-native users (email-based, no seed phrase). This build ships
 * without Circle API credentials (per the build decision to prioritize broad
 * EVM wallet support via ConnectKit first — see wagmi.ts), so this file is a
 * real integration point with the SDK call shape filled in, gated behind env
 * vars that are currently unset. Nothing here fakes a working connection.
 *
 * To wire this up for real:
 *   1. Create a Circle Developer account: https://console.circle.com
 *   2. Create a Wallet Set (Developer-Controlled) and note its App ID.
 *   3. Generate an API key.
 *   4. Set VITE_CIRCLE_APP_ID and VITE_CIRCLE_API_KEY in app/.env.
 *      IMPORTANT: a raw Circle secret API key must never ship to the
 *      browser. In production, VITE_CIRCLE_API_KEY should instead be a
 *      short-lived user token minted by your own backend via Circle's
 *      /users/token endpoint — the direct API key env var here is a
 *      local-dev convenience only. See:
 *      https://developers.circle.com/w3s/docs/user-controlled-wallets-quickstart
 *   5. Install the SDK: `npm install @circle-fin/w3s-pw-web-sdk`
 *   6. Replace the body of `connectCircleWallet()` below with real calls
 *      per Circle's quickstart, and swap CIRCLE_CONFIGURED's return value
 *      for a real readiness check.
 */

export const CIRCLE_APP_ID = import.meta.env.VITE_CIRCLE_APP_ID ?? "";
export const CIRCLE_API_KEY = import.meta.env.VITE_CIRCLE_API_KEY ?? "";

export const CIRCLE_CONFIGURED = Boolean(CIRCLE_APP_ID && CIRCLE_API_KEY);

export interface CircleWalletSession {
  address: `0x${string}`;
  walletId: string;
}

/**
 * Placeholder entry point for email-based wallet creation/login via Circle.
 * Throws until real credentials + the Circle SDK are wired in, so callers
 * must handle the rejection (the UI does — see WalletConnectModal.tsx,
 * which disables this option with a tooltip when CIRCLE_CONFIGURED is false).
 */
export async function connectCircleWallet(_email: string): Promise<CircleWalletSession> {
  if (!CIRCLE_CONFIGURED) {
    throw new Error(
      "Circle Developer Wallets isn't configured. Set VITE_CIRCLE_APP_ID and " +
        "VITE_CIRCLE_API_KEY (see .env.example) and implement this function " +
        "per Circle's Web SDK quickstart.",
    );
  }
  // Real implementation sketch (uncomment and adapt once the SDK is installed):
  //
  // import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
  // const sdk = new W3SSdk({ appSettings: { appId: CIRCLE_APP_ID } });
  // const { userToken, encryptionKey } = await requestUserTokenFromYourBackend(_email);
  // return await new Promise((resolve, reject) => {
  //   sdk.execute(challengeId, (error, result) => {
  //     if (error) return reject(error);
  //     resolve({ address: result.data.address, walletId: result.data.walletId });
  //   });
  // });

  throw new Error("Not implemented — see comments in src/lib/circleWallets.ts");
}
