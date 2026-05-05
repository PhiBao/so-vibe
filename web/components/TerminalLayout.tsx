"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useToast } from "@/components/ToastProvider";
import { useSodexTx } from "@/lib/use-sodex-tx";

const NAV = [
  { href: "/", label: "dashboard", icon: "◈" },
  { href: "/trade", label: "trade", icon: "⚡" },
  { href: "/positions", label: "positions", icon: "◉" },
  { href: "/bots", label: "bots", icon: "▣" },
  { href: "/backtest", label: "backtest", icon: "◊" },
  { href: "/news", label: "news", icon: "◉" },
];

function hasMetaMask(): boolean {
  return typeof window !== "undefined" && !!(window as any).ethereum?.isMetaMask;
}

const SODEX_CHAIN_ID = 138565;

function NetworkChecker() {
  const { chainId, isConnected } = useAccount();
  const [switching, setSwitching] = useState(false);

  if (!isConnected) return null;
  if (chainId === SODEX_CHAIN_ID) return null;

  const handleSwitch = async () => {
    setSwitching(true);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) return;
      const sodexChain = {
        chainId: "0x21d45",
        chainName: "SoDEX Testnet",
        nativeCurrency: {
          name: "SOSO",
          symbol: "SOSO",
          decimals: 18,
        },
        rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-v2.valuechain.xyz/"],
        blockExplorerUrls: ["https://testnet.sodex.com/"],
      };
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: sodexChain.chainId }],
        });
      } catch (switchError: any) {
        // MetaMask may throw -32603 (unrecognized chain) instead of 4902
        // Always try to add the chain first, then switch again
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [sodexChain],
          });
        } catch (addError: any) {
          // If chain already exists, add throws; ignore and try switch again
          if (addError.code !== -32603 && addError.code !== 4001) {
            console.error("Add chain failed:", addError);
          }
        }
        // Retry switch after add
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: sodexChain.chainId }],
        });
      }
    } catch (err: any) {
      console.error("Network switch failed:", err);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="text-[9px] text-[var(--red)] font-mono flex items-center gap-1">
        <span>◉</span>
        <span>WRONG NETWORK ({chainId ?? "unknown"})</span>
      </div>
      <button
        onClick={handleSwitch}
        disabled={switching}
        className="btn-terminal btn-terminal-yellow text-[9px] py-1 px-2 w-full"
      >
        {switching ? "SWITCHING..." : "[ SWITCH TO SODEX ]"}
      </button>
    </div>
  );
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

function TransferModal({
  isOpen,
  onClose,
  mode,
  balance,
  address,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: "deposit" | "withdraw";
  balance: { spot: number; perp: number } | null;
  address: string;
}) {
  const { addToast } = useToast();
  const { sendInstructions } = useSodexTx();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const available = mode === "deposit" ? (balance?.spot || 0) : (balance?.perp || 0);
  const title = mode === "deposit" ? "DEPOSIT TO PERPS" : "WITHDRAW TO SPOT";
  const subtitle = mode === "deposit" ? "Transfer from spot to perp balance" : "Transfer from perp to spot balance";

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0 || val > available) {
      addToast("Invalid amount or insufficient balance", "error");
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === "deposit" ? "/api/wallet/deposit" : "/api/wallet/withdraw";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, amount: val }),
      });
      const data = await res.json();
      if (!data.success || !data.action) {
        addToast(data.error || "Build failed", "error");
        setLoading(false);
        return;
      }

      // Sign and submit with MetaMask
      const result = await sendInstructions(data.action);
      if (result.success) {
        addToast(`${title} submitted successfully`, "success");
      } else {
        addToast(result.error || `${title} failed`, "error");
      }
      onClose();
      setAmount("");
    } catch (err: any) {
      addToast(err?.message || "Failed", "error");
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-72 bg-[var(--bg-secondary)] border border-[var(--border)] p-4 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-wider text-[var(--cyan)]">{title}</span>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text)] text-[12px]">×</button>
        </div>
        <div className="text-[10px] text-[var(--text-secondary)] font-mono">{subtitle}</div>
        <div className="text-[10px] text-[var(--text-secondary)] font-mono">Available: <span className="text-[var(--cyan)]">${available.toFixed(2)}</span></div>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="terminal-input w-full text-[12px] py-1.5"
          min={0}
          step={0.01}
        />
        <div className="flex gap-2">
          <button onClick={() => setAmount(available.toFixed(2))} className="flex-1 btn-terminal text-[9px] py-1">MAX</button>
          <button onClick={handleSubmit} disabled={loading} className="flex-[2] btn-terminal btn-terminal-green text-[10px] py-1.5 font-bold">
            {loading ? "..." : "CONFIRM"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletBalance() {
  const { address, isConnected } = useAccount();
  const { addToast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [balance, setBalance] = useState<{ spot: number; perp: number; accountID: number | null; positions: number } | null>(null);
  const [modal, setModal] = useState<{ open: boolean; mode: "deposit" | "withdraw" }>({ open: false, mode: "deposit" });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isConnected || !address) { setBalance(null); return; }
    const fetchBalance = async () => {
      try {
        const res = await fetch(`/api/wallet/balance?address=${address}`);
        const data = await res.json();
        setBalance({
          spot: data.spot || 0,
          perp: data.perp || 0,
          accountID: data.accountID || null,
          positions: (data.positions || []).length,
        });
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  if (!mounted) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">Spot</div>
            <div className="text-[11px] font-mono text-[var(--text-tertiary)]">--</div>
          </div>
          <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">Perp</div>
            <div className="text-[11px] font-mono text-[var(--text-tertiary)]">--</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isConnected) return null;

  return (
    <>
      <TransferModal
        isOpen={modal.open}
        onClose={() => setModal({ ...modal, open: false })}
        mode={modal.mode}
        balance={balance}
        address={address || ""}
      />
      <div className="space-y-2">
        {/* Buttons — single line, centered */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setModal({ open: true, mode: "deposit" })}
            disabled={!balance || balance.spot <= 0}
            className="flex-1 btn-terminal text-[9px] py-1 px-0.5 flex items-center justify-center text-center disabled:opacity-40"
            title="Deposit spot to perp"
          >
            [+]
          </button>
          <button
            onClick={() => setModal({ open: true, mode: "withdraw" })}
            disabled={!balance || balance.perp <= 0}
            className="flex-1 btn-terminal text-[9px] py-1 px-0.5 flex items-center justify-center text-center disabled:opacity-40"
            title="Withdraw perp to spot"
          >
            [-]
          </button>
          <a
            href="https://testnet.sodex.com/faucet"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 btn-terminal text-[9px] py-1 px-0.5 flex items-center justify-center text-center no-underline"
            title="SoDEX Faucet"
          >
            FAUCET
          </a>
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">Spot</div>
            <div className="text-[11px] font-mono text-[var(--text-secondary)]">${balance ? balance.spot.toFixed(2) : "0.00"}</div>
          </div>
          <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">Perp</div>
            <div className="text-[11px] font-mono text-[var(--cyan)]">${balance ? balance.perp.toFixed(2) : "0.00"}</div>
          </div>
        </div>

        {/* Account info */}
        {balance?.accountID && (
          <div className="text-[9px] text-[var(--text-secondary)] font-mono">
            ID: <span className="text-[var(--cyan)]">{balance.accountID}</span> · {balance.positions} pos
          </div>
        )}

        {/* Address at bottom */}
        <div className="text-[9px] text-[var(--text-secondary)] font-mono break-all">
          {address}
        </div>
      </div>
    </>
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
      <span className="text-[var(--text-secondary)]">UTC</span>
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

      <div className={`flex h-screen transition-opacity duration-500 ${booted ? "opacity-100" : "opacity-0"}`}>
        {/* Sidebar — fixed, no scroll */}
        <aside className="w-56 flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]/80 backdrop-blur-sm shrink-0 h-screen overflow-hidden">
          {/* Logo */}
          <div className="p-4 border-b border-[var(--border)]">
            <Link href="/" className="block">
              <div className="text-[var(--cyan)] text-lg font-bold tracking-wider glow-cyan">
                SoVibe
              </div>
              <div className="text-[10px] text-[var(--text-tertiary)] tracking-[0.2em] mt-0.5">
                TERMINAL v1.0
              </div>
            </Link>
          </div>

          {/* Nav — takes remaining space, pushes wallet down via justify-between on parent */}
          <div className="flex-1 flex flex-col justify-between min-h-0">
            <nav className="p-2 space-y-0.5">
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
                    <span className={`text-sm ${active ? "text-[var(--cyan)]" : "text-[var(--text-secondary)] group-hover:text-[var(--text-secondary)]"}`}>
                      {link.icon}
                    </span>
                    <span className="font-mono tracking-wide">
                      {active ? `> ${link.label}` : `  ${link.label}`}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {/* Wallet panel — always at bottom */}
            <div className="p-3 border-t border-[var(--border)] space-y-2">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">wallet</div>
              <WalletConnect />
              <NetworkChecker />
              <WalletBalance />
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-[var(--border)]">
            <SystemStatus />
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col h-screen overflow-auto">
          {/* Top bar */}
          <header className="h-12 border-b border-[var(--border)] flex items-center justify-between px-6 bg-[var(--bg-secondary)]/50 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              <span className="text-[var(--cyan)]">root@sovibe:~$</span>
              <span className="animate-blink">_</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-[var(--text-secondary)]">NET:</span>
                <span className="text-[var(--green)]">TESTNET</span>
              </div>
              <div className="h-4 w-px bg-[var(--border)]" />
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-[var(--text-secondary)]">DEX:</span>
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
