# DueLink — Product Requirements Document

**Version:** 1.0 (MVP)
**Chain:** Arc Testnet (EVM-compatible, USDC-native gas)
**Stack:** Arc L1 + Circle Developer Wallets + App Kit + USDC
**Author:** Product/Architecture — DueLink
**Status:** Ready for engineering

---

## 1. Executive Summary

**DueLink turns "I owe you" into a single, enforceable onchain object.**

Every direct financial relationship between two people or businesses — *"pay me back Friday," "hold this until I ship," "you owe me for the invoice," "send $50 now"* — currently lives in someone's memory, a group chat, or a spreadsheet. It is unenforceable, untracked, and trust-dependent. Meanwhile, existing crypto rails give you either a raw wallet-to-wallet transfer (no terms, no memory, no protection) or a fragmented mess of single-purpose dApps (one for escrow, one for lending, one for invoicing) — each requiring its own onboarding, its own liquidity, its own trust model.

**DueLink unifies all of it into one primitive: the Link.**

A Link is a single onchain object representing *any* direct two-party financial obligation. It has a counterparty, a type, and terms. Once created, funds move only according to those terms — enforced by smart contract, not by goodwill. Built on **Arc**, where **USDC is the native gas token** and finality is sub-second, a Link settles in under a second for about **$0.01**, making it viable for obligations as small as a $5 IOU or as large as a $50,000 invoice.

One object. Four use cases. Zero new mental models per use case.

| Use Case | What it replaces |
|---|---|
| **Send** | Venmo/Zelle/wire — instant P2P payment |
| **Loan** | The "Splitwise + trust + hope" stack for informal lending between individuals |
| **Escrow Trade** | Craigslist/Facebook Marketplace risk, freelance milestone disputes, no-recourse P2P trades |
| **Invoice** | Emailed PDF invoices with no enforcement, no automatic settlement, manual chasing |

---

## 2. Problem Statement

1. **Informal P2P finance has no infrastructure.** Roughly $1.5T+ in informal lending, IOUs, and P2P trade happens every year through cash, Venmo notes, and spreadsheets — with zero enforcement and total reliance on relationship trust.
2. **Existing crypto primitives are fragmented.** A user who wants to escrow a trade needs one dApp; one who wants to invoice a client needs another; P2P lending protocols are pooled/collateralized and built for DeFi degens, not a freelancer owed $800.
3. **Gas costs and settlement times make small-dollar obligations irrational onchain.** A $20 IOU costing $3 in gas and taking minutes to confirm defeats the purpose. Arc's USDC-denominated, sub-cent gas and sub-second finality remove this barrier entirely.
4. **Trust-based settlement doesn't scale past your immediate circle.** You can loan money to your brother on a handshake. You can't do that with a stranger on a marketplace, a client three time zones away, or a DAO contributor you've never met.
5. **Every existing solution requires the counterparty to also adopt a new tool.** DueLink's bet: if the primitive is generic enough (any obligation, any type) and cheap enough (fractions of a cent), *the Link itself* becomes the shared surface — one side creates it, the other just accepts and pays.

---

## 3. Product Vision & Positioning

> **DueLink is the settlement layer for "you owe me."**

Positioning statement:
*"DueLink turns any agreement between two wallets — a payment, a loan, a trade, or an invoice — into one onchain object that enforces itself. Terms are set once. Funds move exactly as agreed. Built on Arc, so it settles in under a second for about a penny."*

**Audience framing (dual-track copy):**
- **Trust layer (crypto-native readers):** Arc L1, USDC-native gas, Circle Developer Wallets, EVM-compatible, ERC-8004/8183-ready for agentic use cases, sub-second deterministic finality.
- **UX layer (mainstream readers):** No gas tokens to buy, no seed phrase anxiety (Circle Wallets abstract custody options), "create a Link, share it, get paid" — as simple as a payment link.

**Non-goals for MVP:**
- Not a pooled lending protocol (no liquidity pools, no interest-rate curves, no collateralized borrowing against a basket of assets).
- Not a general marketplace (DueLink is the settlement rail *under* a trade, not a listings site).
- Not a multi-party (3+) contract system in v1 — every Link is strictly bilateral.
- Not attempting undercollateralized credit-scoring in v1 — loans are either collateralized, socially-vouched, or reputation-gated (see §6.2).

---

## 4. The Core Primitive: "The Link"

A **Link** is a single onchain struct representing one obligation between exactly two wallet addresses (`initiator` and `counterparty`).

### 4.1 Universal Link Anatomy

Every Link — regardless of type — shares this base schema:

```solidity
struct Link {
    uint256 id;
    address initiator;
    address counterparty;
    LinkType linkType;       // SEND | LOAN | ESCROW | INVOICE
    LinkStatus status;       // see 4.2
    address token;           // USDC on Arc (extensible to EURC etc.)
    uint256 amount;
    uint256 createdAt;
    uint256 expiresAt;       // optional deadline; 0 = no expiry
    bytes32 termsHash;       // hash of off-chain terms doc (IPFS/Arweave pointer)
    bytes   typeData;        // ABI-encoded type-specific terms (interest, milestones, due date...)
}
```

### 4.2 Universal Lifecycle (State Machine)

```
DRAFTED → PENDING_ACCEPTANCE → ACTIVE → [FULFILLED | DEFAULTED | DISPUTED | CANCELLED]
                                   ↓
                              (type-specific sub-states, see §5)
```

| State | Meaning |
|---|---|
| `DRAFTED` | Created, not yet sent (initiator can still edit/delete) |
| `PENDING_ACCEPTANCE` | Sent to counterparty, awaiting their onchain acceptance |
| `ACTIVE` | Accepted; funds may be locked (escrow/loan) or obligation is live (invoice) |
| `FULFILLED` | Terms met, funds settled to the correct party, Link closed |
| `DEFAULTED` | Deadline passed without fulfillment; triggers type-specific default logic |
| `DISPUTED` | Either party flags a dispute; freezes fund movement pending resolution path |
| `CANCELLED` | Mutually cancelled or cancelled pre-acceptance by initiator |

### 4.3 Why One Object Instead of Four Contracts

- **Shared UX:** One "Create Link" flow, one inbox of incoming/outgoing Links, one activity feed, one notification system — regardless of type.
- **Shared trust infrastructure:** Reputation, dispute resolution, and identity (ERC-8004-style onchain agent/user identity) apply uniformly across all four types.
- **Composability:** A Link can *reference* another Link (e.g., an Escrow Trade's payment leg is itself a Send Link; a Loan's repayment schedule is a series of Send Links). This lets v2 build compound financial products without new primitives.
- **Cheaper to build & audit:** One core contract (`LinkCore`) with pluggable type modules is a smaller attack surface than four bespoke protocols.

---

## 5. The Four Use Cases (Detailed)

### 5.1 Send — Instant P2P Payment

**Terms:** amount, optional memo, optional expiry (auto-cancel if unaccepted).
**Flow:** Initiator creates Link with funds pre-attached (escrowed in contract at creation) → Counterparty accepts → instant settlement to counterparty, OR initiator can send "no-acceptance-needed" direct sends for known/trusted addresses (skips `PENDING_ACCEPTANCE`, mirrors a normal transfer but still logged as a Link for record-keeping).
**Differentiator vs. raw wallet transfer:** Every Send is logged with a memo, timestamp, and optional termsHash — giving both parties a permanent, shared receipt. Useful for splitting bills, reimbursements, gifting, remittances.
**typeData:** `{ memo: string }`

### 5.2 Loan — P2P Lending

**Terms:** principal, interest (flat fee in USDC or bps APR), due date, repayment schedule (lump sum or installments), collateral (optional).
**Flow:** Initiator (lender) proposes terms → Borrower accepts (this pulls principal from lender to borrower) → Borrower repays per schedule → each repayment is itself a Send-type sub-Link referencing the parent Loan Link → on final repayment, Loan Link → `FULFILLED`.
**Default handling:** If due date passes with an outstanding balance:
 - **Collateralized loans:** contract auto-liquidates posted collateral to the lender up to the owed amount.
 - **Uncollateralized (reputation) loans:** Link → `DEFAULTED`, borrower's onchain repayment reputation score (see §6.2) is decremented; no seizure (v1 has no undercollateralized recourse beyond reputation).
**typeData:** `{ interestBps: uint16, dueDate: uint256, installments: uint8, collateralToken: address, collateralAmount: uint256 }`

### 5.3 Escrow Trade — Trustless P2P Trade

**Terms:** amount held in escrow, release condition (manual dual-confirm, timelock auto-release, or arbitrator-gated), optional counterparty deliverable description (off-chain, hashed).
**Flow:** Buyer creates Escrow Link, deposits USDC into contract → Seller accepts and ships/delivers off-chain → Buyer confirms receipt → funds release to Seller. If Buyer doesn't confirm within timelock, **auto-release** to Seller (protects sellers from buyer ghosting). If either party disputes before release, Link → `DISPUTED` → routed to arbitration path (v1: designated arbitrator address or Kleros-style oracle; v2: DueLink native jury).
**Differentiator:** No marketplace fee, no chargeback risk, works for any P2P trade (freelance milestone, marketplace item, in-person meetup trade, OTC token swap).
**typeData:** `{ releaseMode: enum{MANUAL, TIMELOCK, ARBITRATED}, autoReleaseAt: uint256, arbitrator: address, deliverableHash: bytes32 }`

### 5.4 Invoice — Payable Invoice

**Terms:** amount owed, due date, line-item description (hashed off-chain doc), optional late fee, recurring flag.
**Flow:** Initiator (payee/vendor) creates Invoice Link addressed to counterparty (payer) → Payer receives notification, reviews, and pays (full or partial, if partial payments enabled) → each payment reduces `amountRemaining` → when `amountRemaining == 0`, Link → `FULFILLED`.
**Default handling:** Past due date, invoice accrues configured late fee (bps/day) and flips to `DEFAULTED` status (visual/notification escalation) without freezing funds — payer can still pay late.
**Differentiator:** Unlike an emailed PDF, the Invoice Link is a live payable object — the payer taps "Pay" and it settles in the same UI, no bank details, no manual reconciliation. Supports recurring invoices (subscriptions/retainers) by auto-spawning a new Invoice Link each cycle.
**typeData:** `{ dueDate: uint256, lateFeeBps: uint16, recurring: bool, cycleSeconds: uint256, amountRemaining: uint256 }`

---

## 6. Trust, Identity & Compliance Layer

### 6.1 Identity
- Every wallet gets an implicit **DueLink Profile**: address, ENS/Circle handle if available, Link history (counts by type/status), and reputation score.
- V1.5: integrate **ERC-8004** onchain identity (per Arc's Agentic Economy stack) so AI agents can hold Links and be counterparties — enabling agent-to-agent or agent-to-human obligations (an AI agent invoicing a human for a completed task, or a human loaning USDC to an agent for gas/compute with an onchain repayment obligation).

### 6.2 Reputation Score
- Derived onchain from: Links fulfilled on time / total Links, default rate, dispute rate, total volume settled, account age.
- Displayed before accepting a Link ("This wallet has fulfilled 94% of 32 Links, 0 disputes") — the core trust signal that lets DueLink work with strangers, not just people you already trust.
- Not a credit score export in v1; purely in-app signal.

### 6.3 Compliance
- No custody of funds outside the smart contract's escrow window (non-custodial; DueLink Inc. never holds user funds).
- Circle Developer Wallets provide optional KYC'd wallet tier for users/businesses who want fiat on/off ramp (via Circle Mint / USDC redemption) directly tied to their DueLink activity.
- Travel Rule / large-transaction flagging deferred to Circle's compliance tooling on funded wallets; DueLink itself is a protocol, not a money transmitter (standard non-custodial DeFi posture) — **flagged as a legal review item**, not a settled decision.
- Dispute/arbitration path in v1 is opt-in and off-chain-adjacent (a designated arbitrator address); not a claim of legal dispute resolution.

---

## 7. Personas

| Persona | Use Case | Why DueLink |
|---|---|---|
| **Amara, freelance designer** | Invoice | Sends Invoice Links to clients instead of PDFs; gets paid same-day instead of net-30 chasing |
| **Jordan & Priya, roommates/friends** | Loan / Send | Formalize a $300 "I'll pay you back" without awkwardness; auto-tracked, auto-reminded |
| **Ben, marketplace seller** | Escrow Trade | Sells a used GPU to a stranger online without fear of a chargeback or no-show |
| **Circle Wallet-holding SMB** | Invoice (recurring) | Sends monthly retainer invoices to 6 clients, auto-collects via recurring Invoice Links |
| **AI agent (Arc Agentic Economy)** | Send / Invoice | An agent completing an ERC-8183 job invoices the requester via a DueLink Invoice Link, settled autonomously |

---

## 8. Information Architecture & Core User Flows

### 8.1 Navigation (App Shell)
- **Dashboard** — active Links summary (owed to you / you owe), recent activity
- **Create Link** — type selector (Send / Loan / Escrow / Invoice) → dynamic form
- **Links Inbox** — incoming (pending your acceptance/payment) vs outgoing (awaiting counterparty)
- **Link Detail** — full terms, status timeline, action buttons (accept / pay / dispute / cancel), onchain tx history
- **Reputation/Profile** — your score, history, connected wallet, KYC tier (if applicable)
- **Settings** — wallet management (Circle Developer Wallet / external wallet connect), notification preferences

### 8.2 Critical Flow: Create → Accept → Settle (generic)
1. User A selects Link type, fills terms, reviews gas estimate (in USDC), signs & submits → Link created in `PENDING_ACCEPTANCE`.
2. User B receives notification (email/push/in-app), opens Link Detail, reviews terms + User A's reputation, taps Accept.
3. Contract executes type-specific entry logic (escrow lock, loan disbursement, invoice activation, or instant send).
4. Both users see live status on Dashboard; Link progresses through its state machine until `FULFILLED`.

---

## 9. Technical Architecture

### 9.1 Stack

| Layer | Choice |
|---|---|
| Chain | Arc Testnet (EVM, USDC-native gas, sub-second finality) |
| Smart contracts | Solidity, Foundry/Hardhat, deployed via Circle Contracts / manual deploy per Arc docs |
| Wallets | Circle Developer-Controlled Wallets (default, custodial-abstracted onboarding) + external wallet connect (MetaMask/Viem/Ethers) for crypto-native users |
| Bridging/liquidity | Arc App Kit — Unified Balance (spend USDC held on other chains directly into a Link without manual bridging), Bridge, Swap |
| Frontend | React + Viem/Ethers adapters per App Kit setup, Tailwind |
| Backend/indexing | Event-indexed off-chain service (Links, statuses, notifications) reading Arc RPC; Postgres for indexed cache (source of truth remains onchain) |
| Notifications | Off-chain service (email/push) triggered by indexed contract events |
| Off-chain terms storage | IPFS/Arweave for `termsHash` payloads (invoice line items, deliverable descriptions) |
| AI agent support | ERC-8004 identity + ERC-8183 job registry integration (Arc Agentic Economy) |

### 9.2 Contract Architecture

```
LinkCore.sol          // struct storage, state machine, access control, events
  ├── SendModule.sol      // Send-specific accept/settle logic
  ├── LoanModule.sol      // Loan-specific disbursement/repayment/default logic
  ├── EscrowModule.sol    // Escrow-specific lock/release/dispute logic
  └── InvoiceModule.sol   // Invoice-specific partial-pay/recurring/late-fee logic

LinkFactory.sol        // creates Links, routes to correct module
ReputationRegistry.sol // tracks fulfillment/default/dispute stats per address
ArbitrationRegistry.sol// v1: whitelisted arbitrator addresses per Escrow Link
```

- All modules operate on USDC (Arc's native gas/settlement asset); EURC support stubbed for v1.5 per Arc's multi-stablecoin roadmap.
- Gas paid in USDC per Arc's Stable Fee Design — displayed in-app as "$0.01" not "0.000004 ETH", removing gas-token literacy as an onboarding barrier.
- Contract addresses resolved dynamically per Arc's [Contract Addresses reference](https://docs.arc.io/arc/references/contract-addresses.md) (USDC, CCTP, Gateway).

### 9.3 Data Model (indexed, off-chain read layer)

```
links(id, initiator, counterparty, type, status, amount, token,
      created_at, expires_at, terms_hash, type_data_json, tx_hash)
reputation(address, links_fulfilled, links_defaulted, links_disputed,
           total_volume_usdc, first_link_at)
notifications(user_address, link_id, event_type, read, created_at)
```

---

## 10. Fee Model / Monetization

| Revenue stream | Mechanism |
|---|---|
| **Protocol fee** | Small bps fee (e.g., 10–25 bps) on settled Link volume, taken in USDC at fulfillment — never on failed/cancelled Links |
| **Premium tier** | Advanced reputation exports, custom branded Invoice Links for businesses, higher recurring-invoice automation limits |
| **Arbitration fee** | Small flat fee on disputed Escrow Trades routed to arbitration, split with arbitrator |
| **Not monetized** | Gas (paid directly in USDC to network, not marked up); Send between trusted/known parties kept near-zero-fee to drive adoption |

---

## 11. MVP Scope (Ship First)

**In scope for MVP:**
- Send, Invoice (non-recurring), Escrow Trade (manual + timelock release) — 3 of 4 types
- Circle Developer Wallet onboarding + external wallet connect
- Basic reputation score (fulfillment rate only)
- Dashboard, Create flow, Inbox, Link Detail
- Arc Testnet deployment only

**Deferred to v1.5+:**
- Loan module (interest, collateral, installments) — highest complexity, ships second
- Recurring Invoices
- Arbitrated Escrow disputes (v1 ships manual+timelock only; no arbitration UI yet)
- ERC-8004/8183 agent-to-agent Links
- Mainnet deployment (pending Arc mainnet availability)
- Multi-stablecoin support (EURC)

---

## 12. Success Metrics (North Star + Supporting)

- **North Star:** Total Link volume settled (USDC), weekly active Link-creators
- Supporting: Link acceptance rate (created → accepted), fulfillment rate (accepted → fulfilled), average time-to-settlement, dispute rate (<2% target for Escrow), repeat-usage rate (users creating a 2nd Link within 30 days)

---

## 13. Risks & Open Questions

| Risk | Mitigation / Status |
|---|---|
| Regulatory classification of P2P lending/escrow as money transmission | Legal review required before mainnet; non-custodial architecture is the primary defense |
| Cold-start trust problem (reputation is meaningless with zero history) | Launch incentive: early users get a "Founding Link" badge; consider optional social/KYC vouching for first-time counterparties |
| Arc is testnet-only today | MVP ships and iterates on testnet; mainnet launch gated on Arc's own mainnet timeline |
| Default/dispute handling for uncollateralized loans has no real recourse | v1 explicitly scopes Loan module to collateralized-first; uncollateralized "reputation-only" loans ship with heavy risk warnings |
| Counterparty may not have a wallet yet | Invite flow: Link can be created against an email/phone, with a claim link that provisions a Circle Wallet on acceptance |

---

## 14. Build Sequence (This Engagement)

1. ✅ **PRD** (this document)
2. **Landing page** — marketing site on the existing dark glassmorphism template, DueLink content, dual-track copy (trust layer + plain-English)
3. **Functional port** — working app: wallet connect (Circle Developer Wallet + external), Create Link flow (Send / Escrow / Invoice for MVP), Dashboard/Inbox, real Arc Testnet contract calls, real USDC gas
