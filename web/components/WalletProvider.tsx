"use client";

import { ReactNode, useMemo } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// We only need mainnet for wallet connection.
// SoDEX is NOT a real public EVM chain — it's a REST API gateway.
// All SoDEX interactions use EIP712-signed payloads sent to their REST API.
function createWagmiConfig() {
  return createConfig({
    chains: [mainnet],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [mainnet.id]: http(),
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
