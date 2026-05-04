"use client";

import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// SoDEX uses its own chain IDs but we connect via standard EVM wallets
export const sodexTestnetChain = {
  id: 138565,
  name: "SoDEX Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-gw.sodex.dev"] },
    public: { http: ["https://testnet-gw.sodex.dev"] },
  },
  blockExplorers: {
    default: { name: "SoDEX Explorer", url: "https://testnet.sodex.dev" },
  },
} as const;

// Lazy WalletConnect to avoid indexedDB SSR crash
function getWalletConnectConnector() {
  if (typeof window === "undefined") return null;
  const { walletConnect } = require("wagmi/connectors");
  return walletConnect({
    projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "c4f79cc821944d9680842e34466bfb",
    metadata: {
      name: "Swarm Terminal",
      description: "Agentic perp trading terminal",
      url: window.location.origin,
      icons: [],
    },
  });
}

export const config = createConfig({
  chains: [sodexTestnetChain, sepolia, mainnet],
  connectors: [
    injected({ target: "metaMask" }),
    // WalletConnect is injected dynamically on client to avoid SSR indexedDB crash
  ],
  transports: {
    [sodexTestnetChain.id]: http(),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
});
