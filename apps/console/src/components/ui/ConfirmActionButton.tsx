type Props = {
  children: React.ReactNode;
  className?: string;
  confirmMessage: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  title?: string;
};

export function ConfirmActionButton({ children, className, confirmMessage, disabled, onConfirm, title }: Props) {
  async function confirm() {
    if (disabled) return;
    if (!window.confirm(confirmMessage)) return;
    await onConfirm();
  }

  return (
    <button className={className} disabled={disabled} onClick={() => void confirm()} title={title} type="button">
      {children}
    </button>
  );
}
