import { useEffect, useRef, useState } from "react";
import type { Toast } from "../components/ui/v2";

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounterRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    return () => {
      // Clear all timers on unmount
      timersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      timersRef.current.clear();
    };
  }, []);

  const toast = (t: Omit<Toast, "id">) => {
    const id = ++idCounterRef.current;
    const newToast: Toast = { ...t, id };
    setToasts((prev) => [...prev, newToast]);

    // Set auto-dismiss timer
    const timerId = window.setTimeout(() => {
      dismiss(id);
    }, 3400);

    timersRef.current.set(id, timerId);
  };

  const dismiss = (id: number) => {
    // Clear timer if it exists
    const timerId = timersRef.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timersRef.current.delete(id);
    }

    // Remove toast
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, toast, dismiss };
}
