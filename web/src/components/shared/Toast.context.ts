import { createContext, useContext } from "react";

export type ToastVariant = "default" | "error" | "success";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let hasWarnedMissingToastProvider = false;

const fallbackToastContext: ToastContextValue = {
  toast: ({ message, variant = "default" }) => {
    if (hasWarnedMissingToastProvider) return;
    hasWarnedMissingToastProvider = true;
    console.warn("ToastProvider is missing; dropping toast", { message, variant });
  },
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return ctx ?? fallbackToastContext;
}
