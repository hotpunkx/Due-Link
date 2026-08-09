import { STATUS_STYLES, linkStatusLabel } from "../lib/format";

export default function StatusBadge({ status }: { status: number }) {
  const meta = STATUS_STYLES[linkStatusLabel(status)];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-light ${meta.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}
