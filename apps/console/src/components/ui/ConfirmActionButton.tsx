import { useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
  confirmMessage: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  title?: string;
};

export function ConfirmActionButton({ children, className, confirmMessage, disabled, onConfirm, onError, title }: Props) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function confirm() {
    if (disabled || pendingRef.current) return;
    if (!window.confirm(confirmMessage)) return;

    pendingRef.current = true;
    setPending(true);

    try {
      await onConfirm();
    } catch (error) {
      onError?.(error);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <button className={className} disabled={disabled || pending} onClick={() => void confirm()} title={title} type="button">
      {children}
    </button>
  );
}
