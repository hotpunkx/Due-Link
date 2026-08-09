import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useUserLinkIds, useLinks } from "../hooks/useDueLink";
import LinkCard from "../components/LinkCard";
import { IS_CONTRACT_DEPLOYED } from "../config/contracts";

type Tab = "incoming" | "outgoing" | "all";

export default function Inbox() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("incoming");
  const { data: linkIds } = useUserLinkIds();
  const ids = useMemo(() => [...(linkIds ?? [])].reverse(), [linkIds]);
  const { data: linkResults, isLoading } = useLinks(ids);

  const links = (linkResults ?? [])
    .map((r) => r.result)
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  const incoming = links.filter(
    (l) => l.counterparty.toLowerCase() === address?.toLowerCase() && l.status === 0,
  );
  const outgoing = links.filter(
    (l) => l.initiator.toLowerCase() === address?.toLowerCase() && l.status === 0,
  );

  const shown = tab === "incoming" ? incoming : tab === "outgoing" ? outgoing : links;

  if (!isConnected) {
    return <p className="text-sm font-light text-zinc-500 text-center py-32">Connect a wallet to view your inbox.</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-thin tracking-tight text-white mb-1">Inbox</h1>
        <p className="text-sm font-light text-zinc-500">Links awaiting acceptance, and everything else tied to you.</p>
      </div>

      <div className="flex items-center gap-2 p-1 rounded-full bg-[#0f0f12]/60 border border-white/5 w-fit">
        {(
          [
            ["incoming", `Awaiting your accept (${incoming.length})`],
            ["outgoing", `Awaiting counterparty (${outgoing.length})`],
            ["all", "All Links"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-full text-xs font-light transition-colors ${
              tab === key ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30" : "text-zinc-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!IS_CONTRACT_DEPLOYED ? (
        <p className="text-sm font-light text-zinc-500 py-16 text-center border border-dashed border-white/10 rounded-2xl">
          Contract not deployed yet — see the banner above.
        </p>
      ) : isLoading ? (
        <p className="text-sm font-light text-zinc-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm font-light text-zinc-500 py-16 text-center border border-dashed border-white/10 rounded-2xl">
          Nothing here.
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((l) => (
            <LinkCard key={l.id.toString()} link={l} />
          ))}
        </div>
      )}
    </div>
  );
}
