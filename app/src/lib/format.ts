import { formatUnits, parseUnits } from "viem";
import { USDC_DECIMALS } from "../config/contracts";

export function formatUsdc(amount: bigint | undefined): string {
  if (amount === undefined) return "0.00";
  return Number(formatUnits(amount, USDC_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseUsdc(amount: string): bigint {
  if (!amount || Number.isNaN(Number(amount))) return 0n;
  return parseUnits(amount, USDC_DECIMALS);
}

export function shortAddr(addr?: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const LINK_TYPES = ["SEND", "LOAN", "ESCROW", "INVOICE"] as const;
export type LinkTypeName = (typeof LINK_TYPES)[number];

export const LINK_STATUSES = [
  "PENDING_ACCEPTANCE",
  "ACTIVE",
  "FULFILLED",
  "DEFAULTED",
  "DISPUTED",
  "CANCELLED",
] as const;
export type LinkStatusName = (typeof LINK_STATUSES)[number];

export function linkTypeLabel(t: number): LinkTypeName {
  return LINK_TYPES[t] ?? "SEND";
}

export function linkStatusLabel(s: number): LinkStatusName {
  return LINK_STATUSES[s] ?? "PENDING_ACCEPTANCE";
}

export const STATUS_STYLES: Record<LinkStatusName, { label: string; className: string }> = {
  PENDING_ACCEPTANCE: { label: "Pending acceptance", className: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  ACTIVE: { label: "Active", className: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" },
  FULFILLED: { label: "Fulfilled", className: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  DEFAULTED: { label: "Defaulted", className: "text-red-400 border-red-500/30 bg-red-500/10" },
  DISPUTED: { label: "Disputed", className: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
  CANCELLED: { label: "Cancelled", className: "text-zinc-400 border-zinc-500/30 bg-zinc-500/10" },
};

export const TYPE_META: Record<LinkTypeName, { label: string; icon: string }> = {
  SEND: { label: "Send", icon: "solar:arrow-right-up-linear" },
  LOAN: { label: "Loan", icon: "solar:hand-money-linear" },
  ESCROW: { label: "Escrow Trade", icon: "solar:shield-check-linear" },
  INVOICE: { label: "Invoice", icon: "solar:bill-list-linear" },
};

export function daysUntil(unixSeconds: bigint | number): number {
  const target = typeof unixSeconds === "bigint" ? Number(unixSeconds) : unixSeconds;
  return Math.ceil((target * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

export function toUnixSeconds(dateStr: string): bigint {
  if (!dateStr) return 0n;
  return BigInt(Math.floor(new Date(dateStr).getTime() / 1000));
}
