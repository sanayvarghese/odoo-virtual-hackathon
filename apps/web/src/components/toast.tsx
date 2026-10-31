"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { X } from "lucide-react";

type Kind = "error" | "success" | "info";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

interface ToastApi {
  toast: (kind: Kind, text: string) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });

export function useToast() {
  return useContext(Ctx);
}

/** Fixed toasts in the bottom-right, above the copilot dock. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[90] flex flex-col gap-2 w-[320px]">
        {items.map((t) => (
          <div
            key={t.id}
            className="card flex items-start gap-2 px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] text-sm"
          >
            <span
              className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                t.kind === "error" ? "bg-negative" : t.kind === "success" ? "bg-positive" : "bg-muted"
              }`}
            />
            <div className="leading-snug flex-1">{t.text}</div>
            <button
              className="text-faint hover:text-ink cursor-pointer"
              onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
