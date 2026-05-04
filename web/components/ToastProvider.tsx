"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextType {
  addToast: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextType>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] space-y-2 font-mono">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 text-[11px] border bg-black/90 backdrop-blur animate-in ${
              t.type === "success"
                ? "border-[var(--green)] text-[var(--green)]"
                : t.type === "error"
                ? "border-[var(--red)] text-[var(--red)]"
                : "border-[var(--cyan)] text-[var(--cyan)]"
            }`}
          >
            {t.type === "success" ? "[OK] " : t.type === "error" ? "[ERR] " : "[INFO] "}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
