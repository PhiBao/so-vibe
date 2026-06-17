"use client";

import { useState, ReactNode } from "react";

export default function Tooltip({ children, text }: { children: ReactNode; text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-[10px] text-[var(--text)] font-mono bg-[var(--bg-secondary)] border border-[var(--border)] shadow-xl z-[300]">
          {text}
        </span>
      )}
    </span>
  );
}
