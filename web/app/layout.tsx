import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import TerminalLayout from "@/components/TerminalLayout";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: "SoVibe — AI-Powered Perp Trading Terminal",
  description: "Agentic swarm trading on SoDEX perpetuals with SoSoValue sentiment integration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <Providers>
          <ToastProvider>
            <TerminalLayout>{children}</TerminalLayout>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
