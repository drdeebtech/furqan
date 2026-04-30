"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  toast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: "border-success/30 bg-success/10 text-success",
  error: "border-error/30 bg-error/10 text-error",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-gold/30 bg-gold/10 text-gold",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { dir } = useLang();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const refs = timeoutRefs.current;
    return () => {
      refs.forEach((timer) => clearTimeout(timer));
      refs.clear();
    };
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timeoutRefs.current.delete(id);
    }, 4000);
    timeoutRefs.current.set(id, timer);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const existing = timeoutRefs.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timeoutRefs.current.delete(id);
    }
  }, []);

  const value: ToastContextType = {
    toast: addToast,
    success: (msg) => addToast("success", msg),
    error: (msg) => addToast("error", msg),
    warning: (msg) => addToast("warning", msg),
    info: (msg) => addToast("info", msg),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container */}
      <div className="fixed start-4 top-4 z-50 flex flex-col gap-2" dir={dir} aria-live="polite" role="log">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              role="alert"
              className={`flex items-center gap-3 glass rounded-xl px-4 py-3 animate-in slide-in-from-left duration-300 ${STYLES[t.type]}`}
              style={{ minWidth: 280, maxWidth: 420 }}
            >
              <Icon size={18} className="shrink-0" aria-hidden="true" />
              <p className="flex-1 text-sm">{t.message}</p>
              <button onClick={() => removeToast(t.id)} aria-label="إغلاق" className="focus-ring shrink-0 rounded-full opacity-60 transition-opacity hover:opacity-100">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
