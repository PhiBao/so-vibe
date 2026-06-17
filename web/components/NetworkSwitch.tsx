"use client";

import { useState, useEffect, useRef } from "react";
import { getCurrentNetwork, setNetwork, type NetworkName } from "@/lib/config";
import { useSodexTx } from "@/lib/use-sodex-tx";

export function useNetwork() {
  const [network, setNetworkState] = useState<NetworkName>("testnet");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setNetworkState(getCurrentNetwork());
  }, []);

  return { network, mounted };
}

export default function NetworkSwitch() {
  const { network, mounted } = useNetwork();
  const { switchToSodex } = useSodexTx();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!mounted) {
    return (
      <span className="text-[10px] text-[var(--text-tertiary)] font-mono">...</span>
    );
  }

  const isMainnet = network === "mainnet";

  const handleSelect = async (target: NetworkName) => {
    setOpen(false);
    if (target === network) return;

    try {
      setNetwork(target);
      // Attempt to switch MetaMask in the background; don't block on failure.
      try { await switchToSodex(); } catch {}

      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: target }),
      });
    } catch {
      // Ignore — reload will show current persisted state.
    }
    window.location.reload();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 border transition-colors ${
          isMainnet
            ? "border-[var(--orange)] text-[var(--orange)] hover:bg-[var(--orange)]/10"
            : "border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)]/10"
        }`}
        title="Select network"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isMainnet ? "bg-[var(--orange)]" : "bg-[var(--green)]"}`} />
        {network.toUpperCase()}
        <span className="text-[8px] ml-1">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl z-[200]">
          <button
            onClick={() => handleSelect("testnet")}
            className={`w-full text-left px-3 py-2 text-[10px] font-mono transition-colors ${
              network === "testnet" ? "bg-[var(--green)]/10 text-[var(--green)]" : "text-[var(--text-secondary)] hover:bg-white/[0.03]"
            }`}
          >
            TESTNET
          </button>
          <button
            onClick={() => handleSelect("mainnet")}
            className={`w-full text-left px-3 py-2 text-[10px] font-mono transition-colors border-t border-[var(--border)] ${
              network === "mainnet" ? "bg-[var(--orange)]/10 text-[var(--orange)]" : "text-[var(--text-secondary)] hover:bg-white/[0.03]"
            }`}
          >
            MAINNET
          </button>
        </div>
      )}
    </div>
  );
}
