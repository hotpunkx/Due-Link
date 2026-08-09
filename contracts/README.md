# DueLink Contracts

Foundry project implementing the DueLink protocol: `DueLinkCore.sol` (the
`Link` object + state machine for Send / Loan / Escrow / Invoice) and
`ReputationRegistry.sol` (per-address fulfillment tracking).

Verified against real Arc Testnet network parameters as of this writing
(chain ID `5042002`, USDC ERC-20 interface at
`0x3600000000000000000000000000000000000000`) — see
[Arc's Connect docs](https://docs.arc.io/arc/references/connect-to-arc) and
[Contract Addresses reference](https://docs.arc.io/arc/references/contract-addresses).
Re-check those pages before deploying — testnet addresses can change.

## What's in here

```
src/
  DueLinkCore.sol          Main protocol contract
  ReputationRegistry.sol   Fulfillment/default/dispute tracking, owned by DueLinkCore
  libraries/LinkTypes.sol  Shared enums/structs (Link, LoanTerms, EscrowTerms, InvoiceTerms)
script/
  Deploy.s.sol             Deployment script targeting Arc Testnet
test/
  DueLinkCore.t.sol         19 tests covering all 4 Link types end-to-end
  mocks/MockUSDC.sol        6-decimal mock mirroring Arc's USDC ERC-20 interface
```

## Setup

This repo was built and tested with Foundry v1.7.1. A note on solc: Foundry's
default auto-installer fetches compiler binaries from
`binaries.soliditylang.org`, which may be blocked in locked-down network
environments (it was in the one this was built in). If `forge build` fails
with a decoding/network error, fetch solc directly from GitHub releases
instead:

```bash
mkdir -p ~/.svm/0.8.24
curl -L -o ~/.svm/0.8.24/solc-0.8.24 \
  https://github.com/ethereum/solidity/releases/download/v0.8.24/solc-static-linux
chmod +x ~/.svm/0.8.24/solc-0.8.24
forge build --use ~/.svm/0.8.24/solc-0.8.24
```

On a normal, unrestricted machine, `forge build` alone should work fine.

```bash
forge install                 # pulls forge-std + OpenZeppelin (already vendored here)
forge build
forge test -vv                # 19/19 passing
forge test --gas-report       # per-function gas costs
```

## Deploy to Arc Testnet

1. Get a wallet funded with testnet USDC (pays gas *and* is what Links
   settle in): [faucet.circle.com](https://faucet.circle.com).
2. `cp .env.example .env` and fill in `PRIVATE_KEY` (and optionally
   `FEE_RECIPIENT` / `PROTOCOL_OWNER` if they should differ from the
   deployer).
3. Run:

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url arc_testnet \
  --broadcast \
  --use ~/.svm/0.8.24/solc-0.8.24   # omit --use if forge build works natively for you
```

`arc_testnet` resolves via the `[rpc_endpoints]` block in `foundry.toml` to
`https://rpc.testnet.arc.network`. The script prints the deployed
`DueLinkCore` and `ReputationRegistry` addresses and a direct ArcScan link —
copy the `DueLinkCore` address into `app/.env` as `VITE_DUELINK_CORE_ADDRESS`.

### Verification

ArcScan's contract-verification API details weren't published in the docs
consulted for this build. Once confirmed, uncomment and fill in the
`[etherscan]` block in `foundry.toml` and run:

```bash
forge verify-contract <DEPLOYED_ADDRESS> src/DueLinkCore.sol:DueLinkCore \
  --chain arc_testnet \
  --constructor-args $(cast abi-encode "constructor(address,address,uint16,address)" \
    0x3600000000000000000000000000000000000000 <FEE_RECIPIENT> 25 <OWNER>)
```

## Design notes / MVP limitations (see root PRD §11 for full context)

- **Loan collateral liquidation** transfers the *entire* posted collateral to
  the lender on default — there's no price oracle or partial liquidation in
  v1. Borrowers should over-collateralize conservatively; this is a UX/risk
  warning the frontend must surface clearly, not just a contract comment.
- **Invoice late fees** (`lateFeeBps`) are stored on-chain but *not*
  compounded automatically by the contract — the frontend computes and
  displays the accrued late fee from `lateFeeBps × days overdue`. Enforcing
  on-chain accrual is deferred to avoid compounding-interest edge cases
  within this MVP's audit scope.
- **Escrow arbitration** is a single designated address per Link (set at
  creation), not a decentralized jury or oracle network.
- **`block.timestamp`** is used for due dates/expiries; `forge build` flags
  this (correctly) as validator-manipulable within a small window. Acceptable
  for day/week-scale deadlines; not suitable if you extend this toward
  second-scale timing guarantees.
- Protocol fee is capped at 2.5% (`MAX_FEE_BPS = 250`) and taken at every
  value-transfer leg (Send release, each Loan repayment, Escrow release, each
  Invoice payment) — not just once at final fulfillment.

## Gas (Arc Testnet, sub-cent target)

Run `forge test --gas-report` for exact per-function numbers. Combined with
Arc's [Stable Fee Design](https://docs.arc.io/arc/concepts/stable-fee-design),
priced directly in USDC, everyday Link actions (accept, repay, pay invoice)
should land at fractions of a cent — validate the actual figure once live on
testnet, since gas pricing depends on network conditions this repo can't
observe from a sandboxed build environment.
