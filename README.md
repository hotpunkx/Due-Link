DueLink
One P2P financial primitive for every direct obligation between two wallets — payments, loans, escrow, and invoices — built on Arc.
Problem
P2P finance on-chain is fragmented. A wallet-to-wallet loan, an escrowed marketplace trade, a freelance invoice, and a simple payment all use different tools, different trust assumptions, and no shared record. There's no single object that represents "what one address owes another, and under what terms."
Solution
DueLink introduces a single primitive — the Link — a direct on-chain obligation between exactly two wallets. Every Link has a type (Payment, Loan, Escrow, Invoice), terms, and a lifecycle. One contract, one mental model, four use cases.
Key Features
Unified P2P primitive — one Link struct covers payments, loans, escrow, and invoices
Bilateral trust, no intermediary — funds move only per the Link's agreed terms
On-chain repayment schedules — loans and invoices carry due dates and installments
Escrow release conditions — funds held until both parties confirm, or a dispute window elapses
Portable reputation — a wallet's Link history (on-time repayments, completed escrows) is public and composable
USDC-native, Arc-native gas
Use Cases
Link type
Description
Payment
Direct one-off or split USDC transfer between two wallets
Loan
Peer-to-peer loan with principal, interest, and due date
Escrow
Marketplace-style trade held until delivery is confirmed
Invoice
Freelancer/business invoice with due date and late-fee terms
Architecture
Code
Tech Stack
Chain: Arc Network (EVM-compatible, Chain ID 2135)
Contracts: Solidity ^0.8.20, OpenZeppelin (ReentrancyGuard, Ownable)
Wallets: Circle Developer Controlled Wallets (SCA)
Token deploy: Circle Smart Contract Platform (ERC-20 template)
Backend: Node.js, viem, TypeScript
Frontend: HTML/CSS/JS + ethers.js v6 (single-file demo app)
Contract
LinkCore.sol — core P2P obligation logic.
Struct Link: id, sender, recipient, linkType (PAYMENT/LOAN/ESCROW/INVOICE), amount, dueDate, interestBps, escrowReleaseCondition, status (PENDING, ACTIVE, DISPUTED, SETTLED, DEFAULTED).
Functions: createLink, fundLink, repayLink, releaseEscrow, disputeLink, resolveDispute, getLink, getLinksByAddress.
Events: LinkCreated, LinkFunded, LinkSettled, LinkDisputed, LinkDefaulted.
Security: nonReentrant on all state-changing functions, only the two Link parties can act on it (plus arbiter on disputes), checks-effects-interactions, custom errors.
Deployed (Arc Testnet):
Contract address: TBD
Network: Arc Testnet, Chain ID 2135
RPC: https://testnet.rpc.arc.network
Explorer: https://testnet.arcscan.app
Run Locally
Bash
Demo
Demo video: TBD
Landing page / waitlist: TBD
Built With
Arc Network · Circle Developer Wallets · Circle Smart Contract Platform