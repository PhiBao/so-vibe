"use client";

import { ReactNode, useMemo } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export const SODEX_TESTNET = {
  id: 138565,
  name: "SoDEX Testnet",
  nativeCurrency: {
    name: "SOSO",
    symbol: "SOSO",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-v2.valuechain.xyz/"] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-v2.valuechain.xyz/"] },
  },
  blockExplorers: {
    default: { name: "SoDEX Explorer", url: "https://testnet.sodex.com/" },
  },
  testnet: true,
} as const;

function createWagmiConfig() {
  return createConfig({
    chains: [mainnet, SODEX_TESTNET],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [mainnet.id]: http(),
      [SODEX_TESTNET.id]: http(),
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
