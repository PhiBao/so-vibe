/**
 * Minimal encrypted browser store for sensitive values (e.g., bot private keys).
 *
 * The raw secret is encrypted with a user-supplied password using PBKDF2 + AES-GCM
 * and stored in localStorage as base64 ciphertext. The plaintext is kept only in
 * memory while the app is unlocked.
 */

const BOT_STORE_KEY = "sovibe-bot-keystore-v1";

export interface EncryptedBotConfig {
  apiKeyName: string;
  publicKey: string;
  encryptedPrivateKey: string;
  salt: string;
  iv: string;
}

export interface UnlockedBotConfig {
  apiKeyName: string;
  publicKey: string;
  privateKey: string;
}

let unlockedConfig: UnlockedBotConfig | null = null;

function bufferToBase64(buf: ArrayBuffer): string {
  if (typeof window === "undefined") return "";
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  if (typeof window === "undefined") return new ArrayBuffer(0);
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 250_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function hasEncryptedBotKeys(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(BOT_STORE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as EncryptedBotConfig;
    return !!parsed.encryptedPrivateKey && !!parsed.salt && !!parsed.iv;
  } catch {
    return false;
  }
}

export function isBotUnlocked(): boolean {
  return !!unlockedConfig;
}

export function getUnlockedBotConfig(): UnlockedBotConfig | null {
  return unlockedConfig;
}

export async function lockBot(): Promise<void> {
  unlockedConfig = null;
}

export async function saveEncryptedBotKeys(
  config: UnlockedBotConfig,
  password: string
): Promise<void> {
  if (typeof window === "undefined") return;
  const enc = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    enc.encode(config.privateKey)
  );

  const stored: EncryptedBotConfig = {
    apiKeyName: config.apiKeyName,
    publicKey: config.publicKey,
    encryptedPrivateKey: bufferToBase64(ciphertext),
    salt: bufferToBase64(salt.buffer),
    iv: bufferToBase64(iv.buffer),
  };
  window.localStorage.setItem(BOT_STORE_KEY, JSON.stringify(stored));
  unlockedConfig = { ...config };
}

export async function unlockBotKeys(password: string): Promise<UnlockedBotConfig | null> {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(BOT_STORE_KEY);
  if (!raw) return null;
  const stored: EncryptedBotConfig = JSON.parse(raw);
  const salt = new Uint8Array(base64ToBuffer(stored.salt));
  const iv = new Uint8Array(base64ToBuffer(stored.iv));
  const ciphertext = base64ToBuffer(stored.encryptedPrivateKey);

  try {
    const key = await deriveKey(password, salt);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext
    );
    const privateKey = new TextDecoder().decode(decrypted);
    unlockedConfig = {
      apiKeyName: stored.apiKeyName,
      publicKey: stored.publicKey,
      privateKey,
    };
    return unlockedConfig;
  } catch {
    return null;
  }
}

export function clearEncryptedBotKeys(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BOT_STORE_KEY);
  unlockedConfig = null;
}
