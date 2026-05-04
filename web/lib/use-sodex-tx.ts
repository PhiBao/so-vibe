"use client";

import { useCallback } from "react";
import { useAccount } from "wagmi";
import type { UnsignedAction, SignedAction } from "@/lib/dex/types";
import { PERPS_BASE, GW_BASE } from "@/lib/dex/sodex-adapter";

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

  const signAction = useCallback(
    async (action: UnsignedAction): Promise<SignedAction> => {
      if (!address) throw new Error("Wallet not connected");
      if (!isConnected) throw new Error("Wallet disconnected");

      // Get wallet's current chainId (official sends signatureChainID: 1)
      const ethereum = (typeof window !== "undefined" && (window as any).ethereum) as any;
      let walletChainId = 1;
      try {
        const hex = await ethereum.request({ method: "eth_chainId" });
        walletChainId = parseInt(hex, 16);
      } catch {}

      // Use wallet chainId in domain so MetaMask accepts it
      const domain = { ...action.domain, chainId: walletChainId };

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

      const signedAction: SignedAction = {
        type: action.payload.type,
        params: action.params,
        signature: typedSignature,
        nonce: action.message.nonce,
        endpoint: action.endpoint || "/exchange",
        signatureChainID: walletChainId,
      };
      // eslint-disable-next-line no-console
      console.log("[SodexTx] signed action:", signedAction);
      return signedAction;
    },
    [address, isConnected]
  );

  const sendAction = useCallback(
    async (signed: SignedAction): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      try {
        const url = signed.type === "addAPIKey"
          ? `${GW_BASE}/api/v1/spot/exchange`
          : `${PERPS_BASE}/exchange`;

        const body = {
          type: signed.type,
          params: signed.params,
          nonce: signed.nonce,
          signature: signed.signature,
          signatureChainID: signed.signatureChainID,
        };

        // eslint-disable-next-line no-console
        console.log("[SodexTx] POST", url, JSON.stringify(body, null, 2));

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Accept": "application/json, text/plain, */*",
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
    []
  );

  const sendInstructions = useCallback(
    async (action: UnsignedAction) => {
      const signed = await signAction(action);
      return sendAction(signed);
    },
    [signAction, sendAction]
  );

  return { address, isConnected, signAction, sendAction, sendInstructions };
}
