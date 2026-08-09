# DueLink — Technical Requirements Document (TRD)

**Version:** 1.0 (MVP — matches shipped code in `duelink.zip`)
**Companion to:** `DueLink_PRD.md` (product scope, personas, business rationale)
**Status:** Contracts compiled + tested; frontend builds clean; nothing deployed to a live network yet (see §9)

This document specifies *how* DueLink is built, at the level engineers need
to extend, audit, or deploy it. Where the PRD says *what* and *why*, this
says *with what, exactly, and at what cost*.

---

## 1. Scope & Non-Goals

**In scope for this TRD:** the smart contract layer (`contracts/`) and the
frontend application (`app/`) as actually implemented — not the aspirational
architecture from PRD §9, which this document supersedes wherever the two
disagree (the code is the source of truth).

**Out of scope:** the marketing landing page (static HTML, no build system —
nothing to spec technically beyond "it's a single file"), and any backend
indexing service (not built in this MVP — see §4.3 and §11).

---

## 2. System Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐
│   Landing Page       │        │   DueLink App (SPA)       │
│  duelink_landing.html│───────▶│  Vite + React 18 + TS      │
│  (static, no build)  │  link  │  wagmi + viem + ConnectKit │
└─────────────────────┘        └──────────────┬────────────┘
                                               │ JSON-RPC (eth_call / eth_sendRawTransaction)
                                               ▼
                                ┌──────────────────────────┐
                                │   Arc Testnet (chain 5042002)│
                                │   rpc.testnet.arc.network  │
                                └──────────────┬────────────┘
                                               │
                        ┌──────────────────────┼──────────────────────┐
                        ▼                      ▼                      ▼
              ┌──────────────────┐  ┌────────────────────┐  ┌─────────────────┐
              │  DueLinkCore.sol  │  │ ReputationRegistry  │  │  USDC (ERC-20)   │
              │  (Link state      │─▶│ .sol                │  │  0x3600...0000   │
              │  machine, 4 types)│  │ (owned by Core)      │  │  6 decimals       │
              └──────────────────┘  └────────────────────┘  └─────────────────┘
```

No backend server exists in this MVP. The frontend reads and writes
directly against the chain via RPC. All state — Link terms, status,
balances, reputation — lives onchain; the frontend holds no server-side
state of its own (see §4.3 for the scaling implication of this).

---

## 3. Smart Contract Layer

### 3.1 Toolchain

| Component | Version / detail |
|---|---|
| Solidity | `0.8.24`, optimizer on, 200 runs |
| Framework | Foundry (forge/cast/anvil), v1.7.1 at build time |
| Dependencies | `openzeppelin-contracts` v5.7.0 (`IERC20`, `SafeERC20`, `ReentrancyGuard`, `Ownable`, `ERC20`), `forge-std` |
| Target chain | Arc Testnet, chain ID `5042002` |
| Settlement asset | USDC ERC-20 interface, `0x3600000000000000000000000000000000000000`, 6 decimals |

### 3.2 Contract inventory

| File | Purpose | Deployment cost (gas) |
|---|---|---|
| `src/libraries/LinkTypes.sol` | Shared enums/structs (`Link`, `LoanTerms`, `EscrowTerms`, `InvoiceTerms`) — library, not deployed standalone | — |
| `src/DueLinkCore.sol` | Main protocol contract: storage, state machine, all four type modules, fee logic | `3,713,791` gas |
| `src/ReputationRegistry.sol` | Per-address fulfillment/default/dispute counters; deployed by `DueLinkCore`'s constructor, owned by it | (included in Core's deploy) |
| `script/Deploy.s.sol` | Foundry deployment script, Arc-Testnet-specific constants | n/a |
| `test/DueLinkCore.t.sol` | 19 tests, full lifecycle coverage per type | n/a |
| `test/mocks/MockUSDC.sol` | 6-decimal test double for local `forge test` runs (no network required) | n/a |

### 3.3 Storage layout (on DueLinkCore)

```solidity
IERC20 public immutable usdc;
ReputationRegistry public immutable reputation;
address public feeRecipient;
uint16  public protocolFeeBps;         // capped at 250 (2.5%)
uint256 public nextLinkId;             // starts at 1

mapping(uint256 => LinkTypes.Link)          public links;
mapping(uint256 => LinkTypes.LoanTerms)     public loanTerms;
mapping(uint256 => LinkTypes.EscrowTerms)   public escrowTerms;
mapping(uint256 => LinkTypes.InvoiceTerms)  public invoiceTerms;
mapping(address => uint256[])               public linksByUser;
```

`links[id]` is populated for every type; the type-specific mapping for a
given `id` is only populated for its matching `LinkType`. Reading the wrong
mapping for a given id returns a zero-valued struct — callers must check
`links[id].linkType` first (the frontend hooks in §5.4 do this).

### 3.4 State machine (authoritative — see also PRD §4.2)

```
PENDING_ACCEPTANCE ──accept──▶ ACTIVE ──(type-specific)──▶ FULFILLED
        │                        │
    cancel (initiator only,      ├──(overdue + unpaid)──▶ DEFAULTED
    before acceptance)           │
        ▼                        └──(escrow only)────────▶ DISPUTED ──arbitrator──▶ FULFILLED | CANCELLED
    CANCELLED
```

Enum ordinals (as compiled — **do not reorder in future versions**, this
would silently corrupt already-deployed Link data since status is stored as
`uint8`):

```
LinkType:   0 SEND, 1 LOAN, 2 ESCROW, 3 INVOICE
LinkStatus: 0 PENDING_ACCEPTANCE, 1 ACTIVE, 2 FULFILLED,
            3 DEFAULTED, 4 DISPUTED, 5 CANCELLED
```

### 3.5 Per-type function reference

| Type | Create | Accept | Progress | Terminal |
|---|---|---|---|---|
| **Send** | `createSendLink(counterparty, amount, expiresAt, termsHash)` — pulls `amount` from caller immediately | `acceptSendLink(id)` — counterparty only | — | `FULFILLED` on accept; `cancelSendLink(id)` (initiator, pre-accept) refunds |
| **Loan** | `createLoanLink(borrower, principal, interestBps, dueDate, installments, collateralToken, collateralAmount, termsHash)` — no funds move | `acceptLoanLink(id)` — pulls collateral (if any) from borrower, then principal from lender to borrower | `repayLoan(id, amount)` — any amount, any number of calls | `FULFILLED` at full repayment (collateral returned); `checkLoanDefault(id)` (anyone, post-due-date) → `DEFAULTED`, liquidates 100% of collateral to lender if posted |
| **Escrow** | `createEscrowLink(seller, amount, releaseMode, autoReleaseAt, arbitrator, deliverableHash, termsHash)` — pulls `amount` from buyer immediately | `acceptEscrowLink(id)` — seller only | `raiseDispute(id)` (either party) → `DISPUTED` | `confirmDelivery(id)` (buyer) or `autoRelease(id)` (anyone, timelock mode, post-`autoReleaseAt`) → `FULFILLED`; `resolveDispute(id, bool)` (arbitrator only) → `FULFILLED` or `CANCELLED` |
| **Invoice** | `createInvoiceLink(payer, amount, dueDate, lateFeeBps, recurring, cycleSeconds, termsHash)` — no funds move | `acceptInvoiceLink(id)` — payer only | `payInvoice(id, amount)` — partial payments allowed, even post-default | `FULFILLED` at `amountRemaining == 0` (spawns next cycle if `recurring`); `checkOverdue(id)` (anyone, post-due-date, unpaid) → `DEFAULTED` (still payable) |

All state-transition functions are protected by `nonReentrant` where they
move funds, and by explicit role checks (`NotInitiator`, `NotCounterparty`,
`NotParty`, `NotArbitrator` custom errors) plus status checks (`WrongStatus`,
`WrongType`).

### 3.6 Fee mechanics

`_settleOut(to, amount)` is the single chokepoint for every value-transfer
leg (Send release, each Loan repayment, Escrow release, each Invoice
payment):

```solidity
uint256 fee = (amount * protocolFeeBps) / 10000;
settled = amount - fee;
usdc.safeTransfer(feeRecipient, fee);
usdc.safeTransfer(to, settled);
```

Fee is taken **per leg**, not once at final fulfillment — a Loan repaid in
five installments pays the fee five times, proportionally. `protocolFeeBps`
is owner-adjustable via `setProtocolFeeBps`, hard-capped at `250` (2.5%) at
the contract level (`MAX_FEE_BPS`), independent of whatever the owner sets.

### 3.7 Known technical limitations (carried from PRD §11/§13, restated precisely)

| Limitation | Where in code | Practical implication |
|---|---|---|
| Collateral liquidation is all-or-nothing | `checkLoanDefault()` | No price oracle; over-collateralization is the only protection against undercollateralized loss on volatile collateral (moot for USDC-denominated collateral, relevant if `collateralToken` is ever set to something else) |
| Late fees not auto-compounded onchain | `checkOverdue()` only flips status; `lateFeeBps` is stored but unused in-contract | Frontend computes `lateFeeBps × daysOverdue × amountRemaining` for display (see `LinkDetail.tsx`); contract balance owed does **not** include it |
| Single-arbitrator dispute resolution | `escrowTerms.arbitrator`, `resolveDispute()` | One EOA/contract address decides; no jury, no stake-weighted voting, no appeal path |
| `block.timestamp` for all deadlines | throughout | Acceptable at day/week granularity; do not rely on it for second-scale guarantees (validators have a small manipulation window) |
| No price oracle anywhere | — | `amount` fields are raw USDC units; no FX, no other-asset pricing |

---

## 4. Data Model

### 4.1 Onchain structs (exact field order matters for ABI encoding)

```solidity
struct Link {
    uint256 id;
    address initiator;
    address counterparty;
    LinkType linkType;
    LinkStatus status;
    address token;        // always the USDC address in this MVP
    uint256 amount;
    uint256 createdAt;
    uint256 expiresAt;    // Send only; 0 elsewhere
    bytes32 termsHash;    // keccak256 of off-chain terms text; see §4.2
}

struct LoanTerms {
    uint16 interestBps; uint256 dueDate; uint8 installments;
    address collateralToken; uint256 collateralAmount;
    uint256 amountRepaid; bool collateralDeposited; bool collateralClaimed;
}

struct EscrowTerms {
    EscrowReleaseMode releaseMode; uint256 autoReleaseAt;
    address arbitrator; bytes32 deliverableHash; bool buyerConfirmed;
}

struct InvoiceTerms {
    uint256 dueDate; uint16 lateFeeBps; bool recurring;
    uint256 cycleSeconds; uint256 amountRemaining;
}
```

### 4.2 Off-chain terms storage — **not implemented in this MVP**

`termsHash` / `deliverableHash` fields are populated client-side via
`keccak256(stringToHex(memoText))` (see `app/src/pages/CreateLink.tsx`,
`hashMemo()`). **The raw text itself is not persisted anywhere** — not on
IPFS, not in a database. The hash is a verification pointer with nothing to
point to yet. This is flagged, not hidden: PRD §9.1 calls for IPFS/Arweave
storage; it wasn't built for MVP. Until it is, users must keep their own
copy of memo/deliverable text — the hash alone can't be used to recover or
display it.

### 4.3 Off-chain read layer — **not implemented in this MVP**

The frontend currently sources all data live from RPC calls:
`getLinksByUser(address)` → array of ids → batched `getLink(id)` multicall
via wagmi's `useReadContracts`. This works correctly but doesn't scale:

- `getLinksByUser` returns an unbounded array with no pagination — gas cost
  of the *call itself* is fine (it's a view call, off explicit gas metering
  for reads via `eth_call`), but the array grows forever and the frontend
  fetches the whole thing every load.
- No filtering/sorting happens onchain; the frontend does it client-side
  after fetching everything.

PRD §9.1 specs a Postgres-backed indexer reading contract events
(`LinkCreated`, `LinkFulfilled`, etc.) as the intended production
architecture. **Not built.** Acceptable for personal-wallet-scale testing
(dozens of Links); will need to happen before a few hundred Links per
address, or before any "browse all open Links" type feature is added.

---

## 5. Frontend Layer

### 5.1 Toolchain

| Component | Choice |
|---|---|
| Build tool | Vite |
| Framework | React `18.3.1` (pinned down from Vite's default 19 — ConnectKit's wagmi connectors weren't compatible with 19 at build time) |
| Language | TypeScript, strict mode, `resolveJsonModule` on |
| Styling | Tailwind CSS v3 (matches the landing page's utility classes exactly; v4 was avoided since the landing page relies on the Tailwind CDN's v3-era arbitrary-value syntax) |
| Routing | `react-router-dom` v6, client-side only, 4 routes |
| Chain interaction | `wagmi` + `viem`, wrapped by `connectkit` for wallet UI |
| Data fetching/caching | `@tanstack/react-query` (wagmi's dependency, used directly for its cache) |
| Icons | `iconify-icon` web component, loaded via the same CDN script tag as the landing page (kept for visual consistency, not bundled as an npm dependency) |

### 5.2 Wallet connectivity

`connectkit`'s `getDefaultConfig` is configured with:
- Chains: `[arcTestnet, mainnet]` — mainnet is included **only** because
  ConnectKit needs a CORS-safe transport for ENS name resolution, not
  because the app operates on mainnet.
- `walletConnectProjectId` from `VITE_WALLETCONNECT_PROJECT_ID` — without
  it, WalletConnect's mobile-wallet QR flow is unavailable but
  browser-injected wallets (MetaMask, Rabby, Coinbase Wallet extension)
  still work.

This surfaces the practical "all EVM wallets" superset requested for this
build: any wallet ConnectKit/WalletConnect supports is reachable, without
DueLink maintaining its own connector list.

Circle Developer Wallets is a **documented stub**, not a working connector
— see `app/src/lib/circleWallets.ts`. `connectCircleWallet()` throws a clear
error naming exactly what's missing (env vars + SDK install) until wired to
a real Circle Developer account. No UI path currently calls it silently;
it's not wired into the ConnectKit modal in this build.

### 5.3 Route map

| Path | Component | Purpose |
|---|---|---|
| `/` | `Dashboard.tsx` | USDC balance, active-Link counts, fulfillment rate, recent Links (last 8, client-truncated) |
| `/inbox` | `Inbox.tsx` | Tabbed: incoming (pending your accept), outgoing (pending counterparty), all |
| `/create` | `CreateLink.tsx` | Type selector + 4 forms (Send/Loan/Escrow/Invoice), each with its own approve→create flow |
| `/links/:id` | `LinkDetail.tsx` | Full terms + status-and-role-aware action buttons for all 4 types |

### 5.4 Contract interaction pattern

All reads/writes are centralized in `app/src/hooks/useDueLink.ts`:
- Read hooks (`useLink`, `useLoanTerms`, `useEscrowTerms`, `useInvoiceTerms`,
  `useUserLinkIds`, `useLinks` (batched), `useReputation`) wrap
  `wagmi`'s `useReadContract` / `useReadContracts`, each gated by
  `IS_CONTRACT_DEPLOYED` so they no-op cleanly pre-deployment.
- `useDueLinkActions()` returns one function per write call, all sharing a
  single `useWriteContract` instance.
- USDC approval is handled per-form via `useApproveThenCreate` /
  `useUsdcAllowance` / `useApproveUsdc`, comparing live allowance against
  the amount about to be spent and gating the submit button on it — this
  produces the two-step "Approve → Create/Repay/Pay" UX visible in
  `CreateLink.tsx` and `LinkDetail.tsx`.

### 5.5 ABI handling — a build note worth keeping

The compiled ABI (`forge build` output, 76 entries) is embedded as a
**hand-generated TypeScript literal** (`app/src/config/DueLinkCore.abi.ts`,
`export const DueLinkCoreAbi = [...] as const`), not imported from the raw
JSON artifact. Importing the `.json` directly and casting `as const` fails
TypeScript's const-assertion rule (`TS1355` — a const assertion can't be
applied to an already-typed import reference, only to a literal at the
assertion site). Regenerate this file after any contract ABI change with:

```bash
cd contracts && forge build
python3 -c "
import json
abi = json.load(open('out/DueLinkCore.sol/DueLinkCore.json'))['abi']
open('../app/src/config/DueLinkCore.abi.ts','w').write(
  'export const DueLinkCoreAbi = ' + json.dumps(abi, indent=2) + ' as const;\n'
)"
```

### 5.6 Environment configuration

| Variable | Required | Purpose |
|---|---|---|
| `VITE_DUELINK_CORE_ADDRESS` | For write functionality | Deployed contract address; app runs read-only-disabled ("not deployed" banner) without it |
| `VITE_WALLETCONNECT_PROJECT_ID` | For full wallet coverage | Free at cloud.walletconnect.com; injected wallets work without it |
| `VITE_CIRCLE_APP_ID` / `VITE_CIRCLE_API_KEY` | For Circle Wallets | Unused/unimplemented beyond the stub — see §5.2 |

---

## 6. Network Configuration Reference

Pulled live from Arc's documentation at build time (re-verify before
deploying — testnet parameters can change):

| Parameter | Value | Source |
|---|---|---|
| Chain ID | `5042002` | docs.arc.io/arc/references/connect-to-arc |
| RPC URL | `https://rpc.testnet.arc.network` | same |
| WebSocket | `wss://rpc.testnet.arc.network` | same |
| Block explorer | `https://testnet.arcscan.app` | same |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` (6 decimals) | docs.arc.io/arc/references/contract-addresses |
| Native gas token | Also called USDC, but a **distinct 18-decimal representation** — not the same address/decimals as the ERC-20 interface above | same |
| Faucet | `https://faucet.circle.com` | same |

**This distinction matters and is a common integration mistake:** Link
`amount` fields, balances, and allowances all use the 6-decimal ERC-20 USDC
address. Gas is paid in the native 18-decimal USDC automatically by the
wallet/RPC layer — the app never manually manages gas-token decimals.

---

## 7. Security Considerations

| Control | Implementation |
|---|---|
| Reentrancy | `ReentrancyGuard` (`nonReentrant`) on every function that moves USDC or ERC-20 collateral |
| Access control | Custom errors per role (`NotInitiator`, `NotCounterparty`, `NotParty`, `NotArbitrator`), checked before any state mutation |
| Integer safety | Solidity `0.8.24` has built-in overflow/underflow checks; no `unchecked` blocks used anywhere in `DueLinkCore.sol` |
| Fee bounds | `MAX_FEE_BPS = 250` enforced in both the constructor and `setProtocolFeeBps`, independent of caller input |
| Admin surface | `Ownable` (OZ v5) gates `setProtocolFeeBps` / `setFeeRecipient` only — there is no admin path to pause, freeze, or seize a Link's escrowed funds. Owner compromise cannot drain existing Links, only redirect *future* fees. |
| Token trust assumption | `SafeERC20` used throughout, but the contract still assumes USDC's transfer/transferFrom behave as a standard, non-fee-on-transfer, non-rebasing ERC-20. Confirmed true for Circle's USDC; would break silently if `token`/`collateralToken` were ever a non-conforming token. |

**Not done:** no external audit, no formal verification, no fuzz/invariant
testing beyond the 19 example-based unit tests in §8. **Do not deploy to
mainnet or handle real user funds without an audit.** This is explicit MVP
/ testnet-grade code.

---

## 8. Test Coverage

`forge test` — 19/19 passing, run against Solidity `0.8.24`:

| Area | Tests |
|---|---|
| Send | create+accept settles net of fee, only-counterparty-can-accept, cancel refunds initiator, expired link rejected |
| Loan | full lifecycle (collateralized), partial repayments accumulate, default liquidates collateral to lender, uncollateralized default has no seizure but hits reputation, cannot default before due date |
| Escrow | manual confirm releases to seller, timelock auto-release protects seller, dispute + arbitrator resolves to buyer refund, non-arbitrator cannot resolve |
| Invoice | full payment settles to payee, partial payments accumulate to fulfilled, overdue flips to defaulted but remains payable, recurring spawns next cycle |
| Admin | only-owner can set fee, fee capped at 250 bps |

**Not covered by this suite** (explicit gaps, not oversights):
fuzz/property-based tests, reentrancy-attack simulations (mitigated by
`nonReentrant` but not adversarially tested), multi-user concurrent-Link
stress tests, fee-recipient=zero-address edge cases beyond the constructor
check, gas-limit exhaustion on `linksByUser` at scale.

---

## 9. Deployment Status & Runbook

**Current status: nothing is deployed anywhere.** Contracts compile and
pass tests locally (no network required for `forge test` — it uses an
in-memory EVM via `forge-std`'s `Test`). The frontend's production build
succeeds. Neither has touched Arc Testnet's actual RPC.

To deploy (see root `README.md` for the full copy-paste version):

```bash
cd contracts
cp .env.example .env    # PRIVATE_KEY, funded via faucet.circle.com
forge script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast
```

The script prints the deployed `DueLinkCore` and `ReputationRegistry`
addresses. Copy `DueLinkCore`'s address into `app/.env` as
`VITE_DUELINK_CORE_ADDRESS`.

**Verification:** ArcScan's contract-verification API shape wasn't
published in the docs consulted for this build. `foundry.toml` has a
commented `[etherscan]` block ready to fill in once confirmed.

---

## 10. Performance / Gas Reference

From `forge test --gas-report` (gas units — actual USD cost depends on
Arc's live gas price at call time, which this sandboxed build environment
had no way to observe; validate on testnet before quoting a dollar figure
to users):

| Function | Min | Avg | Max |
|---|---|---|---|
| `createSendLink` | 295,064 | 305,032 | 315,012 |
| `acceptSendLink` | 29,024 | 70,743 | 151,736 |
| `createLoanLink` | 312,494 | 324,549 | 352,594 |
| `acceptLoanLink` | 55,411 | 76,982 | 109,339 |
| `checkLoanDefault` | 31,252 | 79,771 | 115,030 |
| `createEscrowLink` | 307,167 | 327,148 | 347,219 |
| `acceptEscrowLink` | 28,299 | 28,299 | 28,299 |
| `confirmDelivery` | 170,829 | 170,829 | 170,829 |
| `autoRelease` | 33,454 | 92,131 | 150,808 |
| `createInvoiceLink` | 306,979 | 326,897 | 346,815 |
| `acceptInvoiceLink` | 28,295 | 28,295 | 28,295 |
| `checkOverdue` | 83,754 | 83,754 | 83,754 |
| **Contract deployment** | — | 3,713,791 | — |

Deployment cost is a one-time cost paid by whoever runs `Deploy.s.sol`, not
by end users. Per-Link creation costs (~300k gas) are the highest
recurring cost — largely `SSTORE` cost for a fresh `Link` struct plus its
type-specific terms struct; a gas-optimization pass (e.g. packing `Link`'s
fields into fewer storage slots) is a reasonable v1.5 target if per-Link
cost needs to shrink further, but wasn't prioritized for this MVP.

---

## 11. Non-Functional Requirements & Gaps vs. PRD

| Requirement (from PRD) | Status |
|---|---|
| Sub-second finality | Inherited from Arc's consensus — not independently benchmarked in this build (no live deployment yet) |
| $0.01-scale gas | Plausible given Arc's USDC-denominated Stable Fee Design and the gas units above, but not verified against a live gas price — flagged, not claimed |
| Onchain reputation | Implemented (`ReputationRegistry.sol`), read by frontend (`useReputation`) |
| Recurring invoices | Implemented in-contract (`InvoiceModule` logic inside `DueLinkCore`), UI supports creating them |
| Multi-stablecoin (EURC) | Not implemented — `token` is effectively always USDC in this MVP; the field exists in the struct for future extensibility only |
| Indexer / subgraph | Not implemented — see §4.3 |
| Off-chain terms storage (IPFS) | Not implemented — see §4.2 |
| ERC-8004/8183 agent identity | Not implemented — PRD scopes this to v1.5+ |

---

## 12. Open Technical TODOs (prioritized)

1. Deploy to Arc Testnet for real; benchmark actual gas cost in USD at
   live network gas price.
2. Build the event-indexed read layer (§4.3) before Link volume per address
   grows past what `getLinksByUser` + client-side batching can handle
   comfortably.
3. Wire real IPFS/Arweave storage behind `termsHash` / `deliverableHash`
   (§4.2) so the hash has something to verify against.
4. Get a real security review before any mainnet consideration — this
   codebase has zero external audit coverage.
5. Add fuzz/invariant tests (Foundry supports both natively) for the fee
   math and the Loan repayment accounting in particular — those are the
   two places with the most arithmetic surface area.
6. Confirm ArcScan's verification API and fill in `foundry.toml`'s
   `[etherscan]` block.
