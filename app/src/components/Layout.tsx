import { Outlet, Link, useLocation } from "react-router-dom";
import { ConnectKitButton } from "connectkit";
import { IS_CONTRACT_DEPLOYED } from "../config/contracts";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`text-sm font-light transition-colors ${
        active ? "text-cyan-400" : "text-zinc-400 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <div className="ambient-bg">
        <div className="blob-cyan" />
        <div className="blob-purple" />
        <div className="grid-overlay" />
      </div>

      <header className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-12 py-5 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-md">
        <Link to="/" className="text-xl font-medium tracking-widest text-white flex items-center gap-2">
          <iconify-icon icon="solar:link-round-angle-linear" class="text-cyan-400 text-2xl"></iconify-icon>
          DUELINK
        </Link>
        <nav className="hidden md:flex items-center gap-8">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/inbox">Inbox</NavLink>
          <NavLink to="/create">Create Link</NavLink>
        </nav>
        <ConnectKitButton />
      </header>

      {!IS_CONTRACT_DEPLOYED && (
        <div className="px-6 md:px-12 py-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs font-light text-center">
          DueLinkCore isn't deployed yet — set{" "}
          <code className="font-mono bg-black/30 px-1.5 py-0.5 rounded">VITE_DUELINK_CORE_ADDRESS</code> in{" "}
          <code className="font-mono bg-black/30 px-1.5 py-0.5 rounded">app/.env</code> after running the deploy
          script in <code className="font-mono bg-black/30 px-1.5 py-0.5 rounded">/contracts</code>. The UI below is
          fully wired but write actions are disabled until then.
        </div>
      )}

      <main className="max-w-[1200px] mx-auto px-6 md:px-12 py-10">
        <Outlet />
      </main>
    </div>
  );
}
