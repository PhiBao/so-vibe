/**
 * Curated list of wallets used for the copy-trading leaderboard.
 *
 * SoDEX does not expose a global trader index, so discovery starts from
 * known profitable addresses. Users can paste any address into the wallet
 * analyzer; this list seeds the leaderboard with examples.
 */

export interface LeaderboardWallet {
  address: string;
  label?: string;
}

export const DEFAULT_LEADERBOARD_WALLETS: LeaderboardWallet[] = [
  { address: "0x0123456789070ce8f0d6bab722103d12674bc257", label: "Demo Alpha" },
];

/**
 * Build the active leaderboard address list.
 * Priority: runtime env > DEFAULT_LEADERBOARD_WALLETS.
 */
export function getLeaderboardWallets(): LeaderboardWallet[] {
  const env = process.env.LEADERBOARD_WALLETS || "";
  if (env.trim()) {
    return env
      .split(",")
      .map((a) => a.trim())
      .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a))
      .map((address) => ({ address }));
  }
  return DEFAULT_LEADERBOARD_WALLETS;
}
