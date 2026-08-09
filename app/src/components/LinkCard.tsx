import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import StatusBadge from "./StatusBadge";
import { formatUsdc, linkTypeLabel, shortAddr, TYPE_META } from "../lib/format";

export interface LinkSummary {
  id: bigint;
  initiator: `0x${string}`;
  counterparty: `0x${string}`;
  linkType: number;
  status: number;
  amount: bigint;
}

export default function LinkCard({ link }: { link: LinkSummary }) {
  const { address } = useAccount();
  const isInitiator = address?.toLowerCase() === link.initiator.toLowerCase();
  const type = TYPE_META[linkTypeLabel(link.linkType)];
  const counterparty = isInitiator ? link.counterparty : link.initiator;

  return (
    <Link
      to={`/links/${link.id}`}
      className="group flex items-center justify-between gap-4 p-5 rounded-2xl bg-[#0f0f12]/40 border border-white/5 hover:border-cyan-500/30 backdrop-blur-md transition-all hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-11 h-11 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-cyan-400">
          <iconify-icon icon={type.icon} class="text-lg"></iconify-icon>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {type.label} · #{link.id.toString()}
          </p>
          <p className="text-xs font-light text-zinc-500">
            {isInitiator ? "To" : "From"} {shortAddr(counterparty)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <p className="text-sm font-medium text-white">${formatUsdc(link.amount)}</p>
          <p className="text-[11px] font-light text-zinc-500">USDC</p>
        </div>
        <StatusBadge status={link.status} />
        <iconify-icon
          icon="solar:alt-arrow-right-linear"
          class="text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all"
        ></iconify-icon>
      </div>
    </Link>
  );
}
