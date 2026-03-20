"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3 border-2 shadow-lg pointer-events-auto min-w-[280px] max-w-[380px]",
              t.variant === "success" && "bg-sq-white border-sq-green text-sq-black",
              t.variant === "error" && "bg-sq-white border-sq-red text-sq-black",
              t.variant === "info" && "bg-sq-white border-sq-blue text-sq-black"
            )}
          >
            {t.variant === "success" && <CheckCircle className="w-4 h-4 text-sq-green shrink-0" />}
            {t.variant === "error" && <AlertCircle className="w-4 h-4 text-sq-red shrink-0" />}
            {t.variant === "info" && <Info className="w-4 h-4 text-sq-blue shrink-0" />}
            <span className="font-sans text-[13px] font-semibold flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-sq-gray-400 hover:text-sq-black">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
