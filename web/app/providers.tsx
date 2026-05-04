"use client";
import WalletContextProvider from "@/components/WalletProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <WalletContextProvider>{children}</WalletContextProvider>;
}
