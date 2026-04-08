import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ToastContext,
  type ToastItem,
  type ToastOptions,
} from "@/components/shared/Toast.context";

// ─── Internal state for exit animation ────────────────────────────────────

interface ToastState extends ToastItem {
  exiting?: boolean;
}

// ─── Provider ──────────────────────────────────────────────────────────────

interface ToastProviderProps {
  children: ReactNode;
}

const TOAST_DURATION = 3000;
const EXIT_ANIMATION_MS = 200;

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  /** Start exit animation, then remove after transition. */
  const dismiss = useCallback(
    (id: string) => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      );
      setTimeout(() => remove(id), EXIT_ANIMATION_MS);
    },
    [remove],
  );

  /** Schedule auto-dismiss. */
  const scheduleDismiss = useCallback(
    (id: string) => {
      // Clear existing timer if any
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => dismiss(id), TOAST_DURATION);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  /** Pause auto-dismiss (on hover). */
  const pauseDismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    ({ message, variant = "default" }: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      scheduleDismiss(id);
    },
    [scheduleDismiss],
  );

  // Clean up all timers on unmount
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismiss}
        onMouseEnter={pauseDismiss}
        onMouseLeave={scheduleDismiss}
      />
    </ToastContext.Provider>
  );
}

// ─── Container ─────────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: ToastState[];
  onDismiss: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
}

export function ToastContainer({
  toasts,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          item={t}
          onDismiss={onDismiss}
          onMouseEnter={() => onMouseEnter(t.id)}
          onMouseLeave={() => onMouseLeave(t.id)}
        />
      ))}
    </div>
  );
}

// ─── Single toast card ─────────────────────────────────────────────────────

interface ToastCardProps {
  item: ToastState;
  onDismiss: (id: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function ToastCard({ item, onDismiss, onMouseEnter, onMouseLeave }: ToastCardProps) {
  return (
    <div
      role="alert"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 shadow-2xl",
        "border text-sm font-medium",
        "transition-all duration-200",
        // Enter animation
        !item.exiting && "animate-in slide-in-from-bottom-2 fade-in",
        // Exit animation
        item.exiting && "opacity-0 translate-y-2",
        // Variant colors — using design tokens
        item.variant === "error" &&
          "bg-destructive/15 border-destructive/30 text-destructive",
        item.variant === "success" &&
          "bg-success/15 border-success/30 text-success",
        item.variant === "default" &&
          "bg-surface-1 border-border text-foreground",
      )}
    >
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="shrink-0 p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity text-current"
      >
        <X size={14} />
      </button>
    </div>
  );
}
