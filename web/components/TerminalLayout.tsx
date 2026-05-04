"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";

const NAV = [
  { href: "/", label: "dashboard", icon: "◈" },
  { href: "/trade", label: "trade", icon: "⚡" },
  { href: "/positions", label: "positions", icon: "◉" },
  { href: "/bots", label: "bots", icon: "▣" },
  { href: "/backtest", label: "backtest", icon: "◊" },
];

function hasMetaMask(): boolean {
  return typeof window !== "undefined" && !!(window as any).ethereum?.isMetaMask;
}

function WalletConnect() {
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect({
    mutation: {
      onError: (err: any) => setError(err?.message || "Connection failed"),
      onSuccess: () => setError(null),
    },
  });
  const { disconnect } = useDisconnect();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleConnect = () => {
    setError(null);
    const injected = connectors.find((c) => c.id === "injected");
    if (injected) {
      connect({ connector: injected });
    } else if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    } else {
      setError("No wallet connector available");
    }
  };

  if (!mounted) {
    return (
      <button className="btn-terminal text-[11px] py-1.5 px-3 w-full opacity-50" disabled>
        [ loading... ]
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="btn-terminal text-[11px] py-1.5 px-3 w-full"
        title="Disconnect wallet"
      >
        <span className="status-dot online mr-2" />
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  if (!hasMetaMask()) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-terminal btn-terminal-yellow text-[11px] py-1.5 px-3 w-full block text-center"
      >
        [ INSTALL METAMASK ]
      </a>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleConnect}
        disabled={isPending}
        className="btn-terminal btn-terminal-green text-[11px] py-1.5 px-3 w-full"
      >
        {isPending ? "CONNECTING..." : "[ CONNECT WALLET ]"}
      </button>
      {error && (
        <div className="text-[9px] text-[var(--red)] font-mono mt-1">{error}</div>
      )}
    </div>
  );
}

function SystemStatus() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toISOString().replace("T", " ").slice(0, 19));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-4 text-[10px] text-[var(--text-tertiary)]">
      <span>{time}</span>
      <span className="text-[var(--text-dim)]">UTC</span>
    </div>
  );
}

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setBooted(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)] grid-bg terminal-flicker">
      <div className="crt-overlay" />
      <div className="scanline" />

      <div className={`flex min-h-screen transition-opacity duration-500 ${booted ? "opacity-100" : "opacity-0"}`}>
        {/* Sidebar */}
        <aside className="w-56 flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]/80 backdrop-blur-sm shrink-0">
          {/* Logo */}
          <div className="p-4 border-b border-[var(--border)]">
            <Link href="/" className="block">
              <div className="text-[var(--cyan)] text-lg font-bold tracking-wider glow-cyan">
                SWARM
              </div>
              <div className="text-[10px] text-[var(--text-tertiary)] tracking-[0.2em] mt-0.5">
                TERMINAL v3.0
              </div>
            </Link>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-2 space-y-0.5">
            {NAV.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 px-3 py-2 text-[12px] transition-all group ${
                    active
                      ? "bg-[var(--cyan)]/10 text-[var(--cyan)] border-l-2 border-[var(--cyan)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-white/[0.02] border-l-2 border-transparent"
                  }`}
                >
                  <span className={`text-sm ${active ? "text-[var(--cyan)]" : "text-[var(--text-dim)] group-hover:text-[var(--text-secondary)]"}`}>
                    {link.icon}
                  </span>
                  <span className="font-mono tracking-wide">
                    {active ? `> ${link.label}` : `  ${link.label}`}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* Wallet */}
          <div className="p-3 border-t border-[var(--border)] space-y-2">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">wallet</div>
            <WalletConnect />
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-[var(--border)]">
            <SystemStatus />
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-h-screen overflow-auto">
          {/* Top bar */}
          <header className="h-12 border-b border-[var(--border)] flex items-center justify-between px-6 bg-[var(--bg-secondary)]/50 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              <span className="text-[var(--cyan)]">root@sodex:~$</span>
              <span className="animate-blink">_</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-[var(--text-dim)]">NET:</span>
                <span className="text-[var(--green)]">TESTNET</span>
              </div>
              <div className="h-4 w-px bg-[var(--border)]" />
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-[var(--text-dim)]">DEX:</span>
                <span className="text-[var(--cyan)]">sodex.dev</span>
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
