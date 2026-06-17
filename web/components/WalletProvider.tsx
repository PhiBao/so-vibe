"use client";

import { ReactNode, useMemo } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SODEX_NETWORKS,
  getCurrentNetwork,
  getCurrentRpcUrl,
} from "@/lib/config";

export const SODEX_TESTNET = {
  id: SODEX_NETWORKS.testnet.chainId,
  name: SODEX_NETWORKS.testnet.displayName,
  nativeCurrency: {
    name: "SOSO",
    symbol: "SOSO",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [SODEX_NETWORKS.testnet.rpcUrl] },
    public: { http: [SODEX_NETWORKS.testnet.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "SoDEX Explorer", url: SODEX_NETWORKS.testnet.explorerUrl },
  },
  testnet: true,
} as const;

export const SODEX_MAINNET = {
  id: SODEX_NETWORKS.mainnet.chainId,
  name: SODEX_NETWORKS.mainnet.displayName,
  nativeCurrency: {
    name: "SOSO",
    symbol: "SOSO",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [SODEX_NETWORKS.mainnet.rpcUrl] },
    public: { http: [SODEX_NETWORKS.mainnet.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "SoDEX Explorer", url: SODEX_NETWORKS.mainnet.explorerUrl },
  },
  testnet: false,
} as const;

function createWagmiConfig() {
  return createConfig({
    chains: [mainnet, SODEX_TESTNET, SODEX_MAINNET],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [mainnet.id]: http(),
      [SODEX_TESTNET.id]: http(),
      [SODEX_MAINNET.id]: http(),
    },
  });
}

const queryClient = new QueryClient();

export default function WalletContextProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => createWagmiConfig(), []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
