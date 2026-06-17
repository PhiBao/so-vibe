/**
 * Client-side EIP712 signer for autonomous bot trading.
 *
 * The bot private key is encrypted at rest in localStorage and kept decrypted
 * only in memory while the app is unlocked. Orders are built by the backend,
 * signed here, and submitted directly to SoDEX from the browser.
 */

import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { getCurrentChainId, getNetworkConfig } from "./config";
import type { UnsignedAction, SignedAction } from "./dex/types";
import {
  hasEncryptedBotKeys,
  isBotUnlocked,
  getUnlockedBotConfig,
  unlockBotKeys,
  saveEncryptedBotKeys,
  clearEncryptedBotKeys,
  type UnlockedBotConfig,
} from "./encrypted-store";

export type { UnlockedBotConfig };

export {
  hasEncryptedBotKeys,
  isBotUnlocked,
  getUnlockedBotConfig,
  unlockBotKeys,
  saveEncryptedBotKeys,
  clearEncryptedBotKeys,
};

function getAccount(): PrivateKeyAccount {
  const cfg = getUnlockedBotConfig();
  if (!cfg) throw new Error("Bot keys not unlocked");
  return privateKeyToAccount(cfg.privateKey as Hex);
}

export function isBotConfigured(): boolean {
  return isBotUnlocked();
}

export function computePayloadHash(payload: unknown): Hex {
  return keccak256(toHex(JSON.stringify(payload)));
}

export interface BotSignedAction extends SignedAction {
  apiKeyName: string;
}

export async function signBotAction(action: UnsignedAction, nonce: number): Promise<BotSignedAction> {
  const account = getAccount();
  const cfg = getUnlockedBotConfig();
  if (!cfg) throw new Error("Bot keys not unlocked");

  const payloadHash = action.payloadHash;
  const chainId = getCurrentChainId();

  const domain = {
    name: action.domain.name,
    version: action.domain.version,
    chainId,
    verifyingContract: action.domain.verifyingContract,
  };

  const signature = await account.signTypedData({
    domain,
    types: {
      ExchangeAction: [
        { name: "payloadHash", type: "bytes32" },
        { name: "nonce", type: "uint64" },
      ],
    } as const,
    primaryType: "ExchangeAction",
    message: { payloadHash, nonce: BigInt(nonce) },
  });

  // Normalize v (27/28 -> 0/1) and prepend SoDEX type prefix.
  // Spot actions use 0x02; perps/futures actions use 0x01.
  const raw = signature.slice(2);
  const vByte = parseInt(raw.slice(-2), 16);
  const normalizedV = vByte >= 27 ? vByte - 27 : vByte;
  const normalizedSig = `0x${raw.slice(0, -2)}${normalizedV.toString(16).padStart(2, "0")}` as Hex;
  const prefix = action.domain.name === "spot" ? "02" : "01";
  const typedSignature = `0x${prefix}${normalizedSig.slice(2)}` as Hex;

  return {
    type: action.payload.type,
    params: action.params,
    signature: typedSignature,
    nonce,
    endpoint: action.endpoint,
    signatureChainID: chainId,
    apiKeyName: cfg.apiKeyName,
  };
}

export async function submitSignedAction(signed: BotSignedAction): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const url = `${getNetworkConfig().gwBase}${signed.endpoint}`;

  // SoDEX REST API request body is the params object only.
  const body = signed.params;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": signed.apiKeyName,
        "X-API-Sign": signed.signature,
        "X-API-Nonce": String(signed.nonce),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.code && data.code !== 0)) {
      return { success: false, error: data.error || data.message || `HTTP ${res.status}` };
    }
    return { success: true, data };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
