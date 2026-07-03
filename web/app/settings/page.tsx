"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { useToast } from "@/components/ToastProvider";
import { getNetworkConfig, type NetworkConfig } from "@/lib/config";
import { privateKeyToAddress } from "viem/accounts";
import type { Hex } from "viem";
import {
  hasEncryptedBotKeys,
  isBotUnlocked,
  saveEncryptedBotKeys,
  clearEncryptedBotKeys,
  unlockBotKeys,
  lockBot,
} from "@/lib/encrypted-store";
import Tooltip from "@/components/Tooltip";

function MaskedInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  name,
  type = "password",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  name?: string;
  type?: "text" | "password";
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        type={show ? "text" : type}
        name={name}
        autoComplete="new-password"
        data-lpignore="true"
        data-form-type="other"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="terminal-input flex-1 text-[12px] font-mono"
      />
      <button
        onClick={() => setShow((s) => !s)}
        className="btn-terminal text-[10px] px-2"
        type="button"
      >
        {show ? "HIDE" : "SHOW"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { addToast } = useToast();
  const { address, isConnected } = useAccount();

  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [mounted, setMounted] = useState(false);

  const [apiKeyName, setApiKeyName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [password, setPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");

  const [hasStoredKeys, setHasStoredKeys] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const [listingKeys, setListingKeys] = useState(false);
  const [apiKeysList, setApiKeysList] = useState<Array<{ name: string; publicKey: string }>>([]);

  const derivedAddress = useMemo(() => {
    if (privateKey.length !== 66 || !privateKey.startsWith("0x")) return null;
    try {
      return privateKeyToAddress(privateKey as Hex).toLowerCase();
    } catch {
      return null;
    }
  }, [privateKey]);

  useEffect(() => {
    setMounted(true);
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setConfig({ ...data, name: data.network || data.name }))
      .catch(() => {});

    setHasStoredKeys(hasEncryptedBotKeys());
    setUnlocked(isBotUnlocked());
  }, []);

  const saveBot = async () => {
    if (!apiKeyName || publicKey.length !== 42 || privateKey.length !== 66) {
      addToast("Public key must be 0x + 40 hex chars. Private key must be 0x + 64 hex chars.", "error");
      return;
    }
    if (password.length < 8) {
      addToast("Encryption password must be at least 8 characters", "error");
      return;
    }
    await saveEncryptedBotKeys(
      { apiKeyName, publicKey, privateKey },
      password
    );
    setPrivateKey("");
    setPassword("");
    setHasStoredKeys(true);
    setUnlocked(true);
    addToast("Bot keys encrypted and saved locally", "success");
  };

  const unlock = async () => {
    const cfg = await unlockBotKeys(unlockPassword);
    if (!cfg) {
      addToast("Wrong password", "error");
      return;
    }
    setUnlockPassword("");
    setUnlocked(true);
    setApiKeyName(cfg.apiKeyName);
    setPublicKey(cfg.publicKey);
    addToast("Bot keys unlocked", "success");
  };

  const clearBot = () => {
    clearEncryptedBotKeys();
    setPublicKey("");
    setPrivateKey("");
    setPassword("");
    setUnlockPassword("");
    setHasStoredKeys(false);
    setUnlocked(false);
    addToast("Bot keys cleared", "success");
  };

  const listApiKeys = async () => {
    if (!address) { addToast("Connect your wallet first", "error"); return; }
    setListingKeys(true);
    setApiKeysList([]);
    try {
      const res = await fetch(`/api/bot/list-keys?address=${address}`);
      const data = await res.json();
      if (data.keys && data.keys.length > 0) {
        setApiKeysList(data.keys);
      } else {
        addToast("No API keys found on this account.", "info");
      }
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : "Failed to list keys", "error");
    } finally {
      setListingKeys(false);
    }
  };

  const cfg = config || getNetworkConfig();

  if (!mounted) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-in">
        <div>
          <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">SYSTEM_SETTINGS</h1>
          <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">SYSTEM_SETTINGS</h1>
        <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">
          Configure network and autonomous bot signing. Bot keys stay in your browser.
        </p>
      </div>

      {/* Network Config — read-only; switch via header dropdown */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[12px] font-bold tracking-wider">NETWORK_CONFIG</span>
          <span className={`text-[11px] ml-auto ${cfg.name === "mainnet" ? "text-[var(--orange)]" : "text-[var(--green)]"}`}>
            {cfg.name.toUpperCase()}
          </span>
        </div>
        <div className="p-4 space-y-4">
          <div className="text-[11px] text-[var(--text-secondary)] font-mono leading-relaxed">
            Use the network dropdown in the top bar to switch between TESTNET and MAINNET.
            The active network is shared across all pages.
          </div>
          <div className="grid grid-cols-2 gap-3 text-[11px] font-mono text-[var(--text-secondary)]">
            <div className="p-2 bg-white/[0.02] border border-[var(--border)]">Chain ID: <span className="text-[var(--cyan)]">{cfg.chainId}</span></div>
            <div className="p-2 bg-white/[0.02] border border-[var(--border)]">Gateway: <span className="text-[var(--cyan)]">{cfg.gwBase}</span></div>
            <div className="p-2 bg-white/[0.02] border border-[var(--border)]">RPC: <span className="text-[var(--cyan)]">{cfg.rpcUrl}</span></div>
            <div className="p-2 bg-white/[0.02] border border-[var(--border)]">Explorer: <span className="text-[var(--cyan)]">{cfg.explorerUrl}</span></div>
          </div>
          {cfg.name === "mainnet" && (
            <div className="text-[11px] text-[var(--orange)] font-mono border border-[var(--orange)]/30 p-2 bg-[var(--orange)]/5">
              You are on mainnet. Real funds are at risk.
            </div>
          )}
        </div>
      </div>

          {/* Auto-Trade Bot */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[12px] font-bold tracking-wider">AUTO_TRADE_BOT</span>
          <span className={`text-[11px] ml-auto ${unlocked ? "text-[var(--green)]" : hasStoredKeys ? "text-[var(--yellow)]" : "text-[var(--red)]"}`}>
            {unlocked ? "UNLOCKED" : hasStoredKeys ? "LOCKED" : "NOT CONFIGURED"}
          </span>
        </div>
        <div className="p-4 space-y-5">
          <div className="text-[11px] text-[var(--text-secondary)] font-mono leading-relaxed">
            Auto-trading signs orders locally in your browser with a SoDEX API key.
            <span className="text-[var(--yellow)]"> Visit{" "}
              <a href="https://sodex.com/apikeys" target="_blank" rel="noopener noreferrer" className="underline text-[var(--cyan)]">sodex.com/apikeys</a>{" "}
              to create a key,</span> then
            paste the key name, public key, and private key below.
          </div>

          {/* Step 1: Save encrypted keys */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 text-[10px] font-bold border border-[var(--cyan)] text-[var(--cyan)]">1</span>
              <span className="text-[12px] font-bold text-[var(--cyan)] tracking-wider">SAVE ENCRYPTED KEY PAIR</span>
              <Tooltip text="Create your API key at sodex.com/apikeys, then paste the key name, public key (EVM address), and 32-byte private key below. The private key is encrypted with your password and stored only in this browser.">
                <span className="text-[10px] text-[var(--text-secondary)] cursor-help border border-[var(--border)] rounded-full w-4 h-4 flex items-center justify-center">?</span>
              </Tooltip>
            </div>

            {hasStoredKeys && !unlocked && (
              <div className="space-y-3 border border-[var(--yellow)]/20 bg-[var(--yellow)]/5 p-3">
                <div className="text-[11px] text-[var(--yellow)] font-mono">
                  Encrypted bot keys are stored in this browser. Enter your encryption password to unlock them for this session.
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Unlock Password</label>
                  <MaskedInput value={unlockPassword} onChange={setUnlockPassword} placeholder="Enter encryption password" name="sovibe-unlock-password" />
                </div>
                <div className="flex gap-2">
                  <button onClick={unlock} className="btn-terminal btn-terminal-green text-[11px] py-1.5 px-4 font-bold">
                    [ UNLOCK ]
                  </button>
                  <button onClick={clearBot} className="btn-terminal text-[11px] py-1.5 px-4">
                    [ CLEAR ]
                  </button>
                </div>
              </div>
            )}

            {unlocked && (
              <div className="space-y-3 border border-[var(--green)]/20 bg-[var(--green)]/5 p-3">
                <div className="text-[11px] text-[var(--green)] font-mono">
                  Bot keys are unlocked in memory. Auto-trading is available until you lock or reload the page.
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-[var(--text-secondary)]">
                  <div className="p-2 bg-black/30 border border-[var(--border)]">Key Name: <span className="text-[var(--cyan)]">{apiKeyName}</span></div>
                  <div className="p-2 bg-black/30 border border-[var(--border)]">Public Key: <span className="text-[var(--cyan)]">{publicKey.slice(0, 10)}...{publicKey.slice(-8)}</span></div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      lockBot();
                      setUnlocked(false);
                      addToast("Bot keys locked", "success");
                    }}
                    className="btn-terminal text-[11px] py-1.5 px-4"
                  >
                    [ LOCK ]
                  </button>
                  <button onClick={clearBot} className="btn-terminal text-[11px] py-1.5 px-4">
                    [ LOCK & CLEAR ]
                  </button>
                </div>
              </div>
            )}

            {!hasStoredKeys && (
              <div className="space-y-3 pl-7">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">API Key Name</label>
                    {isConnected && (
                      <button onClick={listApiKeys} disabled={listingKeys} className="btn-terminal text-[9px] py-0.5 px-2">
                        {listingKeys ? "..." : "[ FETCH FROM SODEX ]"}
                      </button>
                    )}
                  </div>
                  {apiKeysList.length > 0 && (
                    <div className="space-y-1">
                      {apiKeysList.map((key) => (
                        <button
                          key={key.name}
                          onClick={() => { setApiKeyName(key.name); setPublicKey(key.publicKey); }}
                          className={`w-full text-left text-[11px] font-mono py-1.5 px-3 border transition-colors ${
                            apiKeyName === key.name ? "border-[var(--cyan)] bg-[var(--cyan)]/10 text-[var(--cyan)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30"
                          }`}
                        >
                          <span className="text-[var(--text)]">{key.name}</span>
                          <span className="text-[var(--text-dim)] ml-3">{key.publicKey.slice(0, 10)}...{key.publicKey.slice(-6)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    name="sovibe-api-key-name"
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                    value={apiKeyName}
                    onChange={(e) => setApiKeyName(e.target.value)}
                    placeholder="e.g. SODEX_API_KEY"
                    className="terminal-input w-full text-[12px] font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">API Public Key</label>
                  <MaskedInput name="sovibe-public-key" value={publicKey} onChange={setPublicKey} placeholder="0x..." />
                  {derivedAddress && (
                    <div className={`text-[10px] font-mono ${derivedAddress === publicKey.toLowerCase() ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                      {derivedAddress === publicKey.toLowerCase()
                        ? "Key pair matches"
                        : `Key pair mismatch — derived ${derivedAddress.slice(0, 10)}...${derivedAddress.slice(-6)}`}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Bot Private Key</label>
                  <MaskedInput name="sovibe-private-key" value={privateKey} onChange={setPrivateKey} placeholder="0x..." />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Encryption Password</label>
                  <MaskedInput name="sovibe-encryption-password" value={password} onChange={setPassword} placeholder="Min 8 chars" />
                </div>

                <button onClick={saveBot} className="btn-terminal btn-terminal-green text-[11px] py-1.5 px-4 font-bold">
                  [ SAVE ENCRYPTED ]
                </button>
              </div>
            )}
          </div>

          {/* Step 2 hint */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 text-[10px] font-bold border border-[var(--cyan)] text-[var(--cyan)]">2</span>
              <span className="text-[12px] font-bold text-[var(--cyan)] tracking-wider">ENABLE AUTO MODE</span>
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono pl-7">
              Go to <span className="text-[var(--cyan)]">/bots</span>, select AUTO execution, and start the bot. Orders will be signed locally with your decrypted key.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
