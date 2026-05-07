"use client";

import { useCallback, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import type { UnsignedAction, SignedAction } from "@/lib/dex/types";
import { PERPS_BASE, GW_BASE, getChainId } from "@/lib/dex/sodex-adapter";

const SODEX_CHAIN_ID = 138565;
const SODEX_CHAIN_HEX = "0x21d45";

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
        setNeedsNetworkSwitch(id !== SODEX_CHAIN_ID);
      } catch {}
    };
    check();

    if (ethereum.on) {
      const handler = (chainId: string) => {
        const id = parseInt(chainId, 16);
        setWalletChainId(id);
        setNeedsNetworkSwitch(id !== SODEX_CHAIN_ID);
      };
      ethereum.on("chainChanged", handler);
      return () => { ethereum.removeListener?.("chainChanged", handler); };
    }
  }, [isConnected]);

  const switchToSodex = useCallback(async () => {
    const ethereum = (typeof window !== "undefined" && (window as any).ethereum) as any;
    if (!ethereum) throw new Error("MetaMask not found");

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SODEX_CHAIN_HEX }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: SODEX_CHAIN_HEX,
              chainName: "SoDEX Testnet",
              nativeCurrency: { name: "SOSO", symbol: "SOSO", decimals: 18 },
              rpcUrls: ["http://127.0.0.1:8545"],
              blockExplorerUrls: [],
            }],
          });
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SODEX_CHAIN_HEX }],
          });
        } catch {
          throw new Error("Please add SoDEX Testnet manually in MetaMask settings.");
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

      // SoDEX testnet requires chainId 138565 in the signing domain.
      // If MetaMask is not on 138565, we try to sign anyway — the server
      // may accept it via headers, or MetaMask may allow it.
      const domain = { ...action.domain, chainId: SODEX_CHAIN_ID };

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
        signatureChainID: SODEX_CHAIN_ID,
      };
    },
    [address, isConnected, walletChainId]
  );

  const sendAction = useCallback(
    async (signed: SignedAction): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      try {
        let url: string;
        if (signed.endpoint?.includes("/spot/")) {
          url = `${GW_BASE}${signed.endpoint}`;
        } else if (signed.type === "addAPIKey") {
          url = `${GW_BASE}/api/v1/spot/exchange`;
        } else {
          url = `${PERPS_BASE}/exchange`;
        }

        const body = {
          type: signed.type,
          params: signed.params,
          nonce: signed.nonce,
          signature: signed.signature,
          signatureChainID: signed.signatureChainID,
        };

        // eslint-disable-next-line no-console
        console.log("[SodexTx] POST", url);
        // eslint-disable-next-line no-console
        console.log("[SodexTx] headers:", {
          "X-API-Key": address,
          "X-API-Nonce": signed.nonce,
          "X-API-Sign": signed.signature.slice(0, 20) + "...",
        });
        // eslint-disable-next-line no-console
        console.log("[SodexTx] body:", JSON.stringify(body, null, 2));

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Accept": "application/json, text/plain, */*",
            "X-API-Key": address || "",
            "X-API-Nonce": String(signed.nonce),
            "X-API-Sign": signed.signature,
          },
          credentials: "omit",
          body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-console
        console.log("[SodexTx] response:", res.status, data);

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

  return {
    address,
    isConnected,
    walletChainId,
    needsNetworkSwitch,
    switchToSodex,
    signAction,
    sendAction,
    sendInstructions,
  };
}
