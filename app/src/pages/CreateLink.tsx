import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { keccak256, stringToHex, zeroAddress, type Hex } from "viem";
import { useDueLinkActions, useUsdcAllowance, useApproveUsdc } from "../hooks/useDueLink";
import { parseUsdc, toUnixSeconds, TYPE_META, type LinkTypeName } from "../lib/format";
import { IS_CONTRACT_DEPLOYED } from "../config/contracts";

const ZERO_HASH: Hex = ("0x" + "00".repeat(32)) as Hex;

function hashMemo(memo: string): Hex {
  return memo ? keccak256(stringToHex(memo)) : ("0x" + "00".repeat(32)) as Hex;
}

function isAddr(v: string): v is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export default function CreateLink() {
  const [type, setType] = useState<LinkTypeName>("SEND");
  const { isConnected } = useAccount();

  return (
    <div className="max-w-[720px] mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-thin tracking-tight text-white mb-1">Create a Link</h1>
        <p className="text-sm font-light text-zinc-500">Choose a type and set your terms. Enforced onchain from acceptance.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(Object.keys(TYPE_META) as LinkTypeName[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border backdrop-blur-md transition-all ${
              type === t
                ? "border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(0,229,255,0.1)]"
                : "border-white/5 bg-[#0f0f12]/40 hover:border-white/20"
            }`}
          >
            <iconify-icon icon={TYPE_META[t].icon} class={`text-xl ${type === t ? "text-cyan-400" : "text-zinc-400"}`}></iconify-icon>
            <span className={`text-xs font-light ${type === t ? "text-white" : "text-zinc-400"}`}>{TYPE_META[t].label}</span>
          </button>
        ))}
      </div>

      {!isConnected && (
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-sm font-light text-zinc-400 text-center">
          Connect a wallet to create a Link.
        </div>
      )}

      {!IS_CONTRACT_DEPLOYED && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-sm font-light text-amber-300">
          Contract not deployed — forms below are fully wired but submission is disabled until{" "}
          <code className="font-mono bg-black/30 px-1.5 py-0.5 rounded">VITE_DUELINK_CORE_ADDRESS</code> is set.
        </div>
      )}

      <div className="p-6 md:p-8 rounded-3xl bg-[#0f0f12]/40 border border-white/5 backdrop-blur-md">
        {type === "SEND" && <SendForm />}
        {type === "LOAN" && <LoanForm />}
        {type === "ESCROW" && <EscrowForm />}
        {type === "INVOICE" && <InvoiceForm />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field primitives
// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-light text-zinc-400 uppercase tracking-wide">{label}</span>
      {children}
      {hint && <span className="block text-[11px] font-light text-zinc-600">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-sm font-light text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors";

function SubmitButton({ children, disabled, pending }: { children: React.ReactNode; disabled?: boolean; pending?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="w-full py-3.5 rounded-full bg-white text-[#09090b] text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-50 transition-colors"
    >
      {pending ? "Confirm in wallet…" : children}
    </button>
  );
}

function TxError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
  return <p className="text-xs font-light text-red-400 mt-2">{message}</p>;
}

/** Approve → Create, when the flow needs to escrow USDC atomically at creation (Send, Escrow). */
function useApproveThenCreate(neededAmount: bigint) {
  const { data: allowance } = useUsdcAllowance();
  const { approve, isPending: approving } = useApproveUsdc();
  const needsApproval = neededAmount > 0n && (allowance === undefined || (allowance as bigint) < neededAmount);

  return { needsApproval, approving, approve: () => approve(neededAmount) };
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------

function SendForm() {
  const navigate = useNavigate();
  const actions = useDueLinkActions();
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<unknown>(null);

  const parsedAmount = parseUsdc(amount);
  const { needsApproval, approving, approve } = useApproveThenCreate(parsedAmount);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!isAddr(counterparty)) throw new Error("Enter a valid counterparty address.");
      const expiresAt = expiry ? toUnixSeconds(expiry) : 0n;
      const id = await actions.createSendLink(counterparty, parsedAmount, expiresAt, hashMemo(memo));
      void id;
      navigate("/inbox");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Send to" hint="Wallet address of the recipient">
        <input className={inputCls} placeholder="0x…" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
      </Field>
      <Field label="Amount (USDC)">
        <input className={inputCls} placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Memo" hint="Stored as an onchain hash pointer, not the raw text — keep your own copy.">
        <input className={inputCls} placeholder="Dinner split, rent, etc." value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <Field label="Expires (optional)" hint="Auto-cancellable by you if unaccepted past this date.">
        <input type="datetime-local" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </Field>

      {needsApproval ? (
        <button
          type="button"
          onClick={approve}
          disabled={approving || !parsedAmount}
          className="w-full py-3.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-white text-sm font-medium disabled:opacity-40"
        >
          {approving ? "Approving USDC…" : "1. Approve USDC"}
        </button>
      ) : (
        <SubmitButton disabled={!IS_CONTRACT_DEPLOYED || !parsedAmount} pending={actions.isPending}>
          Create Send Link
        </SubmitButton>
      )}
      <TxError error={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// LOAN
// ---------------------------------------------------------------------------

function LoanForm() {
  const navigate = useNavigate();
  const actions = useDueLinkActions();
  const [borrower, setBorrower] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interestBps, setInterestBps] = useState("500");
  const [dueDate, setDueDate] = useState("");
  const [collateralized, setCollateralized] = useState(true);
  const [collateralAmount, setCollateralAmount] = useState("");
  const [error, setError] = useState<unknown>(null);

  // Loan principal is pulled from the lender at *acceptance*, not creation —
  // approve here so the borrower's accept() call doesn't fail later.
  const parsedPrincipal = parseUsdc(principal);
  const { needsApproval, approving, approve } = useApproveThenCreate(parsedPrincipal);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!isAddr(borrower)) throw new Error("Enter a valid borrower address.");
      if (!dueDate) throw new Error("Set a due date.");
      const collateralToken = collateralized ? "0x3600000000000000000000000000000000000000" : zeroAddress;
      const collateralAmt = collateralized ? parseUsdc(collateralAmount) : 0n;
      await actions.createLoanLink(
        borrower,
        parsedPrincipal,
        Number(interestBps),
        toUnixSeconds(dueDate),
        1,
        collateralToken as `0x${string}`,
        collateralAmt,
        ZERO_HASH,
      );
      navigate("/inbox");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-xs font-light text-cyan-300">
        You're the lender. Principal is pulled from your wallet only when the borrower accepts — approve now so their
        acceptance doesn't fail.
      </div>
      <Field label="Borrower">
        <input className={inputCls} placeholder="0x…" value={borrower} onChange={(e) => setBorrower(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Principal (USDC)">
          <input className={inputCls} placeholder="0.00" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label="Interest (bps)" hint="500 = 5% flat">
          <input className={inputCls} inputMode="numeric" value={interestBps} onChange={(e) => setInterestBps(e.target.value)} />
        </Field>
      </div>
      <Field label="Due date">
        <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={collateralized} onChange={(e) => setCollateralized(e.target.checked)} className="accent-cyan-500 w-4 h-4" />
        <span className="text-sm font-light text-zinc-300">Require USDC collateral</span>
      </label>
      {collateralized ? (
        <Field
          label="Collateral (USDC)"
          hint="On default, the ENTIRE posted collateral goes to you — no partial liquidation in v1. Borrowers should over-collateralize."
        >
          <input className={inputCls} placeholder="0.00" inputMode="decimal" value={collateralAmount} onChange={(e) => setCollateralAmount(e.target.value)} />
        </Field>
      ) : (
        <p className="text-xs font-light text-amber-400/80 -mt-2">
          Uncollateralized: on default there's no seizure, only a reputation hit for the borrower.
        </p>
      )}

      {needsApproval ? (
        <button
          type="button"
          onClick={approve}
          disabled={approving || !parsedPrincipal}
          className="w-full py-3.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-white text-sm font-medium disabled:opacity-40"
        >
          {approving ? "Approving USDC…" : "1. Approve USDC (for borrower's acceptance)"}
        </button>
      ) : (
        <SubmitButton disabled={!IS_CONTRACT_DEPLOYED || !parsedPrincipal} pending={actions.isPending}>
          Propose Loan Link
        </SubmitButton>
      )}
      <TxError error={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// ESCROW
// ---------------------------------------------------------------------------

function EscrowForm() {
  const navigate = useNavigate();
  const actions = useDueLinkActions();
  const [seller, setSeller] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<0 | 1 | 2>(1); // MANUAL, TIMELOCK, ARBITRATED
  const [autoReleaseAt, setAutoReleaseAt] = useState("");
  const [arbitrator, setArbitrator] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [error, setError] = useState<unknown>(null);

  const parsedAmount = parseUsdc(amount);
  const { needsApproval, approving, approve } = useApproveThenCreate(parsedAmount);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!isAddr(seller)) throw new Error("Enter a valid seller address.");
      if (mode === 1 && !autoReleaseAt) throw new Error("Set an auto-release date for timelock escrow.");
      if (mode === 2 && !isAddr(arbitrator)) throw new Error("Set a valid arbitrator address.");
      await actions.createEscrowLink(
        seller,
        parsedAmount,
        mode,
        mode === 1 ? toUnixSeconds(autoReleaseAt) : 0n,
        mode === 2 ? (arbitrator as `0x${string}`) : zeroAddress,
        hashMemo(deliverable),
        ZERO_HASH,
      );
      navigate("/inbox");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-xs font-light text-cyan-300">
        You're the buyer. Funds are escrowed from your wallet immediately, released on your confirmation (or
        automatically / by an arbitrator, depending on mode below).
      </div>
      <Field label="Seller">
        <input className={inputCls} placeholder="0x…" value={seller} onChange={(e) => setSeller(e.target.value)} />
      </Field>
      <Field label="Amount (USDC)">
        <input className={inputCls} placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Deliverable description" hint="Hashed onchain as a reference, not stored in full — keep your own record.">
        <input className={inputCls} placeholder="What's being delivered" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
      </Field>

      <Field label="Release mode">
        <div className="grid grid-cols-3 gap-2">
          {[
            [0, "Manual"],
            [1, "Timelock"],
            [2, "Arbitrated"],
          ].map(([v, label]) => (
            <button
              type="button"
              key={v as number}
              onClick={() => setMode(v as 0 | 1 | 2)}
              className={`py-2.5 rounded-lg text-xs font-light border transition-colors ${
                mode === v ? "border-cyan-500/50 bg-cyan-500/10 text-white" : "border-white/10 text-zinc-400"
              }`}
            >
              {label as string}
            </button>
          ))}
        </div>
      </Field>

      {mode === 1 && (
        <Field label="Auto-release date" hint="Anyone can trigger release to the seller after this date if you haven't confirmed or disputed.">
          <input type="datetime-local" className={inputCls} value={autoReleaseAt} onChange={(e) => setAutoReleaseAt(e.target.value)} />
        </Field>
      )}
      {mode === 2 && (
        <Field label="Arbitrator address" hint="A single designated address who resolves disputes for this Link.">
          <input className={inputCls} placeholder="0x…" value={arbitrator} onChange={(e) => setArbitrator(e.target.value)} />
        </Field>
      )}

      {needsApproval ? (
        <button
          type="button"
          onClick={approve}
          disabled={approving || !parsedAmount}
          className="w-full py-3.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-white text-sm font-medium disabled:opacity-40"
        >
          {approving ? "Approving USDC…" : "1. Approve USDC"}
        </button>
      ) : (
        <SubmitButton disabled={!IS_CONTRACT_DEPLOYED || !parsedAmount} pending={actions.isPending}>
          Create Escrow Link
        </SubmitButton>
      )}
      <TxError error={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// INVOICE
// ---------------------------------------------------------------------------

function InvoiceForm() {
  const navigate = useNavigate();
  const actions = useDueLinkActions();
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lateFeeBps, setLateFeeBps] = useState("0");
  const [recurring, setRecurring] = useState(false);
  const [cycleDays, setCycleDays] = useState("30");
  const [error, setError] = useState<unknown>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!isAddr(payer)) throw new Error("Enter a valid payer address.");
      if (!dueDate) throw new Error("Set a due date.");
      await actions.createInvoiceLink(
        payer,
        parseUsdc(amount),
        toUnixSeconds(dueDate),
        Number(lateFeeBps),
        recurring,
        recurring ? BigInt(Number(cycleDays) * 86400) : 0n,
        ZERO_HASH,
      );
      navigate("/inbox");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-xs font-light text-cyan-300">
        You're the payee. No funds move at creation — the payer accepts, then pays (in full or partially) whenever
        they're ready.
      </div>
      <Field label="Bill to">
        <input className={inputCls} placeholder="0x…" value={payer} onChange={(e) => setPayer(e.target.value)} />
      </Field>
      <Field label="Amount (USDC)">
        <input className={inputCls} placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Due date">
          <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Late fee (bps)" hint="Shown in the UI once overdue — not auto-compounded onchain in v1.">
          <input className={inputCls} inputMode="numeric" value={lateFeeBps} onChange={(e) => setLateFeeBps(e.target.value)} />
        </Field>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-cyan-500 w-4 h-4" />
        <span className="text-sm font-light text-zinc-300">Recurring (auto-spawns the next cycle on full payment)</span>
      </label>
      {recurring && (
        <Field label="Cycle length (days)">
          <input className={inputCls} inputMode="numeric" value={cycleDays} onChange={(e) => setCycleDays(e.target.value)} />
        </Field>
      )}

      <SubmitButton disabled={!IS_CONTRACT_DEPLOYED || !amount} pending={actions.isPending}>
        Send Invoice Link
      </SubmitButton>
      <TxError error={error} />
    </form>
  );
}
