"use client";

import { AlertTriangle, Check, Info, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const ToastCtx = React.createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-20 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 md:bottom-4" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-rise items-start gap-3 rounded-xl border border-border bg-elevated px-4 py-3 shadow-float" role={t.tone === "error" ? "alert" : "status"}>
            <span className={cn("mt-0.5", t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-info")} aria-hidden>
              {t.tone === "success" ? <Check className="h-4 w-4" /> : t.tone === "error" ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-subtle">{t.body}</div>}
            </div>
            <button className="text-muted hover:text-foreground" aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastCtx);
}
