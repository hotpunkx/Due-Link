# DueLink 🔗

One onchain object — the **Link** — for any direct obligation between two wallets: a payment (**Send**), a peer-to-peer loan (**Loan**), a trustless trade (**Escrow**), or a payable bill (**Invoice**). Built on [Arc](https://docs.arc.io), settled in USDC.

This repository contains the full end-to-end codebase:
- 📃 **Product Requirements Document**: [DueLink_PRD.md](file:///d:/ARC%20DEV/Due%20Link/DueLink_PRD.md)
- 🎨 **Marketing Landing Page**: [duelink_landing.html](file:///d:/ARC%20DEV/Due%20Link/duelink_landing.html)
- 🎛️ **Smart Contracts (Foundry / Hardhat)**: [contracts/](file:///d:/ARC%20DEV/Due%20Link/contracts)
- 📱 **Frontend App (Vite + React + wagmi/viem)**: [app/](file:///d:/ARC%20DEV/Due%20Link/app)

---

## 🚀 Live Deployment Status

The protocol has been successfully deployed to the **Arc Testnet**:

*   **`DueLinkCore` Address**: [`0x16bE9E3F21d4CD02B046a85CA99D009785C5Eb12`](https://testnet.arcscan.app/address/0x16bE9E3F21d4CD02B046a85CA99D009785C5Eb12)
*   **`ReputationRegistry` Address**: [`0xC3F1104492B8b4D0bE2f2c411cab18A411335708`](https://testnet.arcscan.app/address/0xC3F1104492B8b4D0bE2f2c411cab18A411335708)
*   **USDC Token (Arc Testnet)**: `0x3600000000000000000000000000000000000000`

---

## 🛠️ Tech Stack & Features

*   **Smart Contracts**: solidity `^0.8.24`, OpenZeppelin v5, 19/19 tests passing.
*   **Frontend**: React (Vite), TypeScript, TailwindCSS, ConnectKit + Wagmi/Viem for Web3 wallet integrations.
*   **Settlement**: Purely in 6-decimal USDC on Arc. Native gas fee paid in USDC (18-decimal).

---

## 💻 Running the App Locally

### 1. Configure the Environment
Ensure your frontend has the correct contract address configured. In the `app/` folder, create `.env` from `.env.example`:

```bash
# app/.env
VITE_DUELINK_CORE_ADDRESS=0x16bE9E3F21d4CD02B046a85CA99D009785C5Eb12
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

### 2. Start the Dev Server
Install dependencies and run the local development server:

```bash
cd app
npm install
npm run dev
```

Visit the app at **[http://localhost:5173/](http://localhost:5173/)**.

---

## 📜 Contract Deployment Notes (Hardhat / Foundry)

The contracts were compiled and deployed using Hardhat. If you wish to redeploy or modify contracts, you can configure your environment in `contracts/.env`:

```bash
PRIVATE_KEY=0x...
FEE_RECIPIENT=0x...
PROTOCOL_OWNER=0x...
```

To deploy via Hardhat (located in adjacent workspace if needed):
```bash
npx hardhat run deploy-duelink.js --network arc_testnet
```

---

## 📐 Design Decisions & Scope

*   **Collateral Liquidation**: Loan collateral liquidation transfers the entire posted collateral to the lender upon default. There is no partial liquidation in v1.
*   **Late Fees**: Invoice late fees are tracked on-chain but calculated/displayed client-side to prevent compounding interest edge cases within the smart contract.
*   **Arbitration**: Escrow arbitration is configured as a single trusted address specified during Link creation.
