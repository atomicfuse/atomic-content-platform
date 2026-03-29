"use client";

import { createContext, useContext, useState, useCallback } from "react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => undefined,
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: "border-green-500 bg-green-500/10 text-green-300",
  error: "border-red-500 bg-red-500/10 text-red-300",
  info: "border-cyan bg-cyan/10 text-cyan",
};

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info"): void => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-lg border text-sm font-medium shadow-lg animate-[slideIn_0.2s_ease-out] ${TYPE_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
