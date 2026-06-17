"use client";

import { useCallback, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import type { UnsignedAction, SignedAction } from "@/lib/dex/types";
import {
  getCurrentChainId,
  getCurrentChainHex,
  getCurrentRpcUrl,
  getNetworkConfig,
  getCurrentNetwork,
  setNetwork,
  type NetworkName,
} from "@/lib/config";

// Raw EIP712 signing via window.ethereum
async function rawSignTypedData(
  address: string,
  domain: any,
  types: any,
  message: any
): Promise<`0x${string}`> {
  const ethereum = (typeof window !== "undefined" && (window as any).ethereum) as any;
  if (!ethereum) throw new Error("MetaMask not found");

  const data = { domain, types, primaryType: "ExchangeAction", message };

  const signature = await ethereum.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(data)],
  });

  return signature as `0x${string}`;
}

export function useSodexTx() {
  const { address, isConnected } = useAccount();
  const [walletChainId, setWalletChainId] = useState<number>(1);
  const [needsNetworkSwitch, setNeedsNetworkSwitch] = useState(false);
  const [network, setNetworkState] = useState<NetworkName>(getCurrentNetwork());

  // Poll current chainId
  useEffect(() => {
    if (!isConnected) { setWalletChainId(1); setNeedsNetworkSwitch(false); return; }
    const ethereum = (typeof window !== "undefined" && (window as any).ethereum) as any;
    if (!ethereum) return;

    const check = async () => {
      try {
        const hex = await ethereum.request({ method: "eth_chainId" });
        const id = parseInt(hex, 16);
        setWalletChainId(id);
        setNeedsNetworkSwitch(id !== getCurrentChainId());
      } catch {}
    };
    check();

    if (ethereum.on) {
      const handler = (chainId: string) => {
        const id = parseInt(chainId, 16);
        setWalletChainId(id);
        setNeedsNetworkSwitch(id !== getCurrentChainId());
      };
      ethereum.on("chainChanged", handler);
      return () => { ethereum.removeListener?.("chainChanged", handler); };
    }
  }, [isConnected]);

  const switchToSodex = useCallback(async () => {
    const ethereum = (typeof window !== "undefined" && (window as any).ethereum) as any;
    if (!ethereum) throw new Error("MetaMask not found");

    const cfg = getNetworkConfig();

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.chainHex }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: cfg.chainHex,
              chainName: cfg.displayName,
              nativeCurrency: { name: "SOSO", symbol: "SOSO", decimals: 18 },
              rpcUrls: [cfg.rpcUrl],
              blockExplorerUrls: [cfg.explorerUrl],
            }],
          });
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: cfg.chainHex }],
          });
        } catch {
          throw new Error(`Please add ${cfg.displayName} manually in MetaMask settings.`);
        }
      } else {
        throw switchError;
      }
    }
  }, []);

  const signAction = useCallback(
    async (action: UnsignedAction): Promise<SignedAction> => {
      if (!address) throw new Error("Wallet not connected");
      if (!isConnected) throw new Error("Wallet disconnected");

      const ethereum = (typeof window !== "undefined" && (window as any).ethereum) as any;
      let currentChainId = walletChainId;

      // EIP712 domain must match the currently selected SoDEX network.
      const domain = { ...action.domain, chainId: getCurrentChainId() };

      const signature = await rawSignTypedData(address, domain, {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ExchangeAction: [
          { name: "payloadHash", type: "bytes32" },
          { name: "nonce", type: "uint64" },
        ],
      }, action.message);

      // Normalize v (27/28 -> 0/1)
      const raw = signature.slice(2);
      const vByte = parseInt(raw.slice(-2), 16);
      const normalizedV = vByte >= 27 ? vByte - 27 : vByte;
      const normalizedSig = `0x${raw.slice(0, -2)}${normalizedV.toString(16).padStart(2, "0")}` as `0x${string}`;

      // Prefix: 01 = perps/futures, 02 = spot (addAPIKey)
      const prefix = action.payload.type === "addAPIKey" ? "02" : "01";
      const typedSignature = `0x${prefix}${normalizedSig.slice(2)}` as `0x${string}`;

      return {
        type: action.payload.type,
        params: action.params,
        signature: typedSignature,
        nonce: action.message.nonce,
        endpoint: action.endpoint || "/exchange",
        signatureChainID: getCurrentChainId(),
      };
    },
    [address, isConnected, walletChainId]
  );

  const sendAction = useCallback(
    async (signed: SignedAction): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      try {
        const url = `${getNetworkConfig().gwBase}${signed.endpoint}`;

        // SoDEX REST API request body is the params object only.
        const body = signed.params;

        // Master-wallet signed requests omit X-API-Key; API-key signed requests include it.
        const headers: Record<string, string> = {
          "Content-Type": "application/json;charset=UTF-8",
          "Accept": "application/json, text/plain, */*",
          "X-API-Nonce": String(signed.nonce),
          "X-API-Sign": signed.signature,
        };

        const res = await fetch(url, {
          method: "POST",
          headers,
          credentials: "omit",
          body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || data?.code !== 0) {
          return { success: false, error: data?.error || data?.msg || `HTTP ${res.status}` };
        }
        return { success: true, data };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [address]
  );

  const sendInstructions = useCallback(
    async (action: UnsignedAction) => {
      const signed = await signAction(action);
      return sendAction(signed);
    },
    [signAction, sendAction]
  );

  const switchNetwork = useCallback(async (target: NetworkName) => {
    setNetwork(target);
    setNetworkState(target);
    await switchToSodex();
  }, [switchToSodex]);

  return {
    address,
    isConnected,
    walletChainId,
    needsNetworkSwitch,
    network,
    switchToSodex,
    switchNetwork,
    signAction,
    sendAction,
    sendInstructions,
  };
}
