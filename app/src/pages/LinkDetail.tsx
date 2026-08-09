import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import {
  useLink,
  useLoanTerms,
  useEscrowTerms,
  useInvoiceTerms,
  useLoanTotalOwed,
  useDueLinkActions,
  useUsdcAllowance,
  useApproveUsdc,
} from "../hooks/useDueLink";
import StatusBadge from "../components/StatusBadge";
import { formatUsdc, parseUsdc, linkTypeLabel, linkStatusLabel, shortAddr, TYPE_META } from "../lib/format";

const inputCls =
  "px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-sm font-light text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors";

const btnPrimary =
  "px-5 py-3 rounded-full bg-white text-[#09090b] text-sm font-medium hover:bg-cyan-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const btnSecondary =
  "px-5 py-3 rounded-full border border-white/15 text-white text-sm font-light hover:bg-white/5 disabled:opacity-40 transition-colors";
const btnDanger =
  "px-5 py-3 rounded-full border border-red-500/30 text-red-400 text-sm font-light hover:bg-red-500/10 disabled:opacity-40 transition-colors";

export default function LinkDetail() {
  const { id } = useParams();
  const linkId = id ? BigInt(id) : undefined;
  const { address } = useAccount();
  const actions = useDueLinkActions();

  const { data: link, refetch, isLoading } = useLink(linkId);
  const [error, setError] = useState<unknown>(null);
  const [txPending, setTxPending] = useState(false);

  if (isLoading) return <p className="text-sm font-light text-zinc-500">Loading Link…</p>;
  if (!link) return <p className="text-sm font-light text-zinc-500">Link not found (or contract not deployed).</p>;

  const type = linkTypeLabel(link.linkType);
  const status = linkStatusLabel(link.status);
  const isInitiator = address?.toLowerCase() === link.initiator.toLowerCase();
  const isCounterparty = address?.toLowerCase() === link.counterparty.toLowerCase();

  const wrap = async (fn: () => Promise<unknown>) => {
    setError(null);
    setTxPending(true);
    try {
      await fn();
      await refetch();
    } catch (err) {
      setError(err);
    } finally {
      setTxPending(false);
    }
  };

  return (
    <div className="max-w-[720px] mx-auto space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-light text-zinc-500 uppercase tracking-wide mb-2">
            {TYPE_META[type].label} · Link #{link.id.toString()}
          </p>
          <h1 className="text-3xl font-thin tracking-tight text-white">${formatUsdc(link.amount)} USDC</h1>
        </div>
        <StatusBadge status={link.status} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <PartyCard label={isInitiator ? "You (initiator)" : "Initiator"} addr={link.initiator} />
        <PartyCard label={isCounterparty ? "You (counterparty)" : "Counterparty"} addr={link.counterparty} />
      </div>

      {type === "SEND" && (
        <SendPanel
          link={link}
          isInitiator={isInitiator}
          isCounterparty={isCounterparty}
          actions={actions}
          wrap={wrap}
          txPending={txPending}
        />
      )}
      {type === "LOAN" && (
        <LoanPanel link={link} isInitiator={isInitiator} isCounterparty={isCounterparty} actions={actions} wrap={wrap} txPending={txPending} />
      )}
      {type === "ESCROW" && (
        <EscrowPanel link={link} isInitiator={isInitiator} isCounterparty={isCounterparty} actions={actions} wrap={wrap} txPending={txPending} />
      )}
      {type === "INVOICE" && (
        <InvoicePanel link={link} isInitiator={isInitiator} isCounterparty={isCounterparty} actions={actions} wrap={wrap} txPending={txPending} />
      )}

      {error !== null && (
        <p className="text-xs font-light text-red-400">
          {error instanceof Error ? error.message.split("\n")[0] : String(error)}
        </p>
      )}

      <p className="text-[11px] font-light text-zinc-600 pt-4 border-t border-white/5">
        Status: {status} · Created {new Date(Number(link.createdAt) * 1000).toLocaleString()}
      </p>
    </div>
  );
}

function PartyCard({ label, addr }: { label: string; addr: string }) {
  return (
    <div className="p-4 rounded-2xl bg-[#0f0f12]/40 border border-white/5">
      <p className="text-[11px] font-light text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm font-mono text-white">{shortAddr(addr)}</p>
    </div>
  );
}

type PanelProps = {
  link: { id: bigint; status: number };
  isInitiator: boolean;
  isCounterparty: boolean;
  actions: ReturnType<typeof useDueLinkActions>;
  wrap: (fn: () => Promise<unknown>) => Promise<void>;
  txPending: boolean;
};

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------

function SendPanel({ link, isInitiator, isCounterparty, actions, wrap, txPending }: PanelProps) {
  const pending = link.status === 0;
  return (
    <div className="flex flex-wrap gap-3">
      {pending && isCounterparty && (
        <button className={btnPrimary} disabled={txPending} onClick={() => wrap(() => actions.acceptSendLink(link.id))}>
          Accept &amp; Receive
        </button>
      )}
      {pending && isInitiator && (
        <button className={btnDanger} disabled={txPending} onClick={() => wrap(() => actions.cancelSendLink(link.id))}>
          Cancel &amp; Refund Me
        </button>
      )}
      {!pending && <p className="text-sm font-light text-zinc-500">No actions available in this status.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOAN
// ---------------------------------------------------------------------------

function LoanPanel({ link, isInitiator, isCounterparty, actions, wrap, txPending }: PanelProps) {
  const { data: terms } = useLoanTerms(link.id);
  const { data: owed } = useLoanTotalOwed(link.id);
  const [repayAmount, setRepayAmount] = useState("");
  const { data: allowance } = useUsdcAllowance();
  const { approve, isPending: approving } = useApproveUsdc();

  if (!terms) return null;
  const remaining = owed !== undefined ? (owed as bigint) - terms.amountRepaid : 0n;
  const overdue = link.status === 1 && Date.now() / 1000 > Number(terms.dueDate);
  const parsedRepay = parseUsdc(repayAmount);
  const needsApproval = parsedRepay > 0n && (allowance === undefined || (allowance as bigint) < parsedRepay);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <Stat label="Interest" value={`${terms.interestBps / 100}%`} />
        <Stat label="Total owed" value={`$${formatUsdc(owed as bigint | undefined)}`} />
        <Stat label="Repaid so far" value={`$${formatUsdc(terms.amountRepaid)}`} />
        <Stat label="Remaining" value={`$${formatUsdc(remaining)}`} />
        <Stat label="Due date" value={new Date(Number(terms.dueDate) * 1000).toLocaleDateString()} />
        <Stat
          label="Collateral"
          value={terms.collateralAmount > 0n ? `$${formatUsdc(terms.collateralAmount)} (${terms.collateralDeposited ? "posted" : "not yet"})` : "None (reputation-only)"}
        />
      </div>

      {overdue && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-light text-red-300">
          Past due date with an outstanding balance.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {link.status === 0 && isCounterparty && (
          <button className={btnPrimary} disabled={txPending} onClick={() => wrap(() => actions.acceptLoanLink(link.id))}>
            Accept Loan {terms.collateralAmount > 0n ? "(deposits collateral, receives principal)" : ""}
          </button>
        )}
        {link.status === 0 && isInitiator && (
          <button className={btnDanger} disabled={txPending} onClick={() => wrap(() => actions.cancelLoanLink(link.id))}>
            Cancel Proposal
          </button>
        )}
        {(link.status === 1 || link.status === 3) && overdue && (
          <button className={btnSecondary} disabled={txPending} onClick={() => wrap(() => actions.checkLoanDefault(link.id))}>
            Trigger Default Handling
          </button>
        )}
      </div>

      {link.status === 1 && isCounterparty && (
        <div className="p-5 rounded-2xl bg-[#0f0f12]/60 border border-white/5 space-y-3">
          <p className="text-xs font-light text-zinc-400 uppercase tracking-wide">Repay</p>
          <div className="flex gap-3">
            <input className={inputCls + " flex-1"} placeholder="0.00" inputMode="decimal" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} />
            {needsApproval ? (
              <button className={btnSecondary} disabled={approving} onClick={() => approve(parsedRepay)}>
                {approving ? "Approving…" : "Approve"}
              </button>
            ) : (
              <button className={btnPrimary} disabled={txPending || !parsedRepay} onClick={() => wrap(() => actions.repayLoan(link.id, parsedRepay))}>
                Repay
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ESCROW
// ---------------------------------------------------------------------------

function EscrowPanel({ link, isInitiator, isCounterparty, actions, wrap, txPending }: PanelProps) {
  const { data: terms } = useEscrowTerms(link.id);
  const { address } = useAccount();
  if (!terms) return null;

  const releaseModeLabel = ["Manual", "Timelock", "Arbitrated"][terms.releaseMode];
  const timelockReady = terms.releaseMode === 1 && Date.now() / 1000 >= Number(terms.autoReleaseAt);
  const isArbitrator = address?.toLowerCase() === terms.arbitrator.toLowerCase();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <Stat label="Release mode" value={releaseModeLabel} />
        {terms.releaseMode === 1 && <Stat label="Auto-release at" value={new Date(Number(terms.autoReleaseAt) * 1000).toLocaleString()} />}
        {terms.releaseMode === 2 && <Stat label="Arbitrator" value={shortAddr(terms.arbitrator)} />}
      </div>

      <div className="flex flex-wrap gap-3">
        {link.status === 0 && isCounterparty && (
          <button className={btnPrimary} disabled={txPending} onClick={() => wrap(() => actions.acceptEscrowLink(link.id))}>
            Accept as Seller
          </button>
        )}
        {link.status === 0 && isInitiator && (
          <button className={btnDanger} disabled={txPending} onClick={() => wrap(() => actions.cancelEscrowLink(link.id))}>
            Cancel &amp; Refund Me
          </button>
        )}
        {link.status === 1 && isInitiator && (
          <button className={btnPrimary} disabled={txPending} onClick={() => wrap(() => actions.confirmDelivery(link.id))}>
            Confirm Delivery &amp; Release Funds
          </button>
        )}
        {link.status === 1 && timelockReady && (
          <button className={btnSecondary} disabled={txPending} onClick={() => wrap(() => actions.autoRelease(link.id))}>
            Trigger Auto-Release
          </button>
        )}
        {link.status === 1 && (isInitiator || isCounterparty) && (
          <button className={btnDanger} disabled={txPending} onClick={() => wrap(() => actions.raiseDispute(link.id))}>
            Raise Dispute
          </button>
        )}
        {link.status === 4 && isArbitrator && (
          <>
            <button className={btnPrimary} disabled={txPending} onClick={() => wrap(() => actions.resolveDispute(link.id, true))}>
              Resolve: Release to Seller
            </button>
            <button className={btnSecondary} disabled={txPending} onClick={() => wrap(() => actions.resolveDispute(link.id, false))}>
              Resolve: Refund Buyer
            </button>
          </>
        )}
        {link.status === 4 && !isArbitrator && (
          <p className="text-sm font-light text-orange-400">Disputed — awaiting the designated arbitrator.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INVOICE
// ---------------------------------------------------------------------------

function InvoicePanel({ link, isInitiator, isCounterparty, actions, wrap, txPending }: PanelProps) {
  const { data: terms } = useInvoiceTerms(link.id);
  const [payAmount, setPayAmount] = useState("");
  const { data: allowance } = useUsdcAllowance();
  const { approve, isPending: approving } = useApproveUsdc();

  if (!terms) return null;
  const overdue = link.status === 1 && Date.now() / 1000 > Number(terms.dueDate);
  const daysLate = overdue ? Math.floor((Date.now() / 1000 - Number(terms.dueDate)) / 86400) : 0;
  const lateFee = overdue ? (terms.amountRemaining * BigInt(terms.lateFeeBps) * BigInt(daysLate)) / 10000n : 0n;
  const parsedPay = parseUsdc(payAmount);
  const needsApproval = parsedPay > 0n && (allowance === undefined || (allowance as bigint) < parsedPay);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <Stat label="Amount remaining" value={`$${formatUsdc(terms.amountRemaining)}`} />
        <Stat label="Due date" value={new Date(Number(terms.dueDate) * 1000).toLocaleDateString()} />
        <Stat label="Recurring" value={terms.recurring ? `Every ${Number(terms.cycleSeconds) / 86400} days` : "No"} />
        <Stat label="Late fee (est.)" value={overdue ? `$${formatUsdc(lateFee)} (${terms.lateFeeBps / 100}%/day × ${daysLate}d)` : "Not overdue"} />
      </div>

      <div className="flex flex-wrap gap-3">
        {link.status === 0 && isCounterparty && (
          <button className={btnPrimary} disabled={txPending} onClick={() => wrap(() => actions.acceptInvoiceLink(link.id))}>
            Accept Invoice
          </button>
        )}
        {link.status === 0 && isInitiator && (
          <button className={btnDanger} disabled={txPending} onClick={() => wrap(() => actions.cancelInvoiceLink(link.id))}>
            Cancel
          </button>
        )}
        {link.status === 1 && overdue && (
          <button className={btnSecondary} disabled={txPending} onClick={() => wrap(() => actions.checkOverdue(link.id))}>
            Mark Overdue
          </button>
        )}
      </div>

      {(link.status === 1 || link.status === 3) && isCounterparty && terms.amountRemaining > 0n && (
        <div className="p-5 rounded-2xl bg-[#0f0f12]/60 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-light text-zinc-400 uppercase tracking-wide">Pay</p>
            <button className="text-xs font-light text-cyan-400" onClick={() => setPayAmount(formatUsdc(terms.amountRemaining).replace(/,/g, ""))}>
              Pay full remaining
            </button>
          </div>
          <div className="flex gap-3">
            <input className={inputCls + " flex-1"} placeholder="0.00" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            {needsApproval ? (
              <button className={btnSecondary} disabled={approving} onClick={() => approve(parsedPay)}>
                {approving ? "Approving…" : "Approve"}
              </button>
            ) : (
              <button className={btnPrimary} disabled={txPending || !parsedPay} onClick={() => wrap(() => actions.payInvoice(link.id, parsedPay))}>
                Pay
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-light text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm font-light text-white">{value}</p>
    </div>
  );
}
