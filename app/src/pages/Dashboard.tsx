import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { useUsdcBalance, useUserLinkIds, useLinks, useReputation } from "../hooks/useDueLink";
import LinkCard from "../components/LinkCard";
import { formatUsdc } from "../lib/format";
import { IS_CONTRACT_DEPLOYED } from "../config/contracts";

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useUsdcBalance();
  const { data: linkIds } = useUserLinkIds();
  const ids = useMemo(() => [...(linkIds ?? [])].reverse().slice(0, 8), [linkIds]);
  const { data: linkResults, isLoading } = useLinks(ids);
  const { data: fulfillmentRateBps } = useReputation(address);

  const links = (linkResults ?? [])
    .map((r) => r.result)
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  const owedToYou = links.filter(
    (l) => l.counterparty.toLowerCase() !== address?.toLowerCase() && l.status === 1,
  );
  const youOwe = links.filter((l) => l.counterparty.toLowerCase() === address?.toLowerCase() && l.status === 1);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-32">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-cyan-400 mb-6">
          <iconify-icon icon="solar:link-round-angle-linear" class="text-2xl"></iconify-icon>
        </div>
        <h1 className="text-2xl font-light text-white mb-3">Connect a wallet to see your Links</h1>
        <p className="text-sm font-light text-zinc-500 max-w-sm">
          Your Dashboard shows everything you're owed, everything you owe, and your onchain fulfillment record.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-thin tracking-tight text-white mb-1">Dashboard</h1>
        <p className="text-sm font-light text-zinc-500">Everything tied to your wallet, live from Arc Testnet.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-6 rounded-2xl bg-[#0f0f12]/40 border border-white/5 backdrop-blur-md">
          <p className="text-xs font-light text-zinc-500 mb-2 uppercase tracking-wide">USDC Balance</p>
          <p className="text-2xl font-light text-white">${formatUsdc(balance as bigint | undefined)}</p>
        </div>
        <div className="p-6 rounded-2xl bg-[#0f0f12]/40 border border-white/5 backdrop-blur-md">
          <p className="text-xs font-light text-zinc-500 mb-2 uppercase tracking-wide">Active — Owed to You</p>
          <p className="text-2xl font-light text-white">{owedToYou.length}</p>
        </div>
        <div className="p-6 rounded-2xl bg-[#0f0f12]/40 border border-white/5 backdrop-blur-md">
          <p className="text-xs font-light text-zinc-500 mb-2 uppercase tracking-wide">Fulfillment Rate</p>
          <p className="text-2xl font-light text-white">
            {fulfillmentRateBps !== undefined ? `${(Number(fulfillmentRateBps) / 100).toFixed(0)}%` : "—"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-light text-white">Recent Links</h2>
        <Link to="/create" className="text-sm font-light text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
          Create a Link <iconify-icon icon="solar:add-circle-linear"></iconify-icon>
        </Link>
      </div>

      {!IS_CONTRACT_DEPLOYED ? (
        <EmptyState
          title="Contract not deployed"
          body="Deploy DueLinkCore to Arc Testnet and set VITE_DUELINK_CORE_ADDRESS to see real data here."
        />
      ) : isLoading ? (
        <p className="text-sm font-light text-zinc-500">Loading your Links…</p>
      ) : links.length === 0 ? (
        <EmptyState title="No Links yet" body="Create your first Link to send, borrow, trade, or invoice." />
      ) : (
        <div className="space-y-3">
          {links.map((l) => (
            <LinkCard key={l.id.toString()} link={l} />
          ))}
        </div>
      )}

      {youOwe.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-sm font-light text-amber-300">
          You have {youOwe.length} active obligation{youOwe.length > 1 ? "s" : ""} where you're the counterparty —
          check your Inbox.
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-16 rounded-2xl border border-dashed border-white/10">
      <p className="text-base font-light text-white mb-2">{title}</p>
      <p className="text-sm font-light text-zinc-500">{body}</p>
    </div>
  );
}
