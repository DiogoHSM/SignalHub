import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

const DEFAULT_CONFIRM_LABEL = "Confirm?";

export function ConfirmButton({ label, confirmLabel = DEFAULT_CONFIRM_LABEL, icon = "check", kind = "primary", ariaLabel, confirmAriaLabel, onConfirm }:
  { label: ReactNode; confirmLabel?: ReactNode; icon?: IconName; kind?: string; ariaLabel?: string; confirmAriaLabel?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);

  // The generic default confirmLabel ("Confirm?") reads identically across
  // every armed instance in a list (e.g. a DLQ row's Replay and Delete
  // buttons both just say "Confirm?"), so a screen reader can't tell which
  // action is pending. When a caller relies on that default and passes a
  // plain-string `label`, announce the specific action instead
  // ("Confirm Replay?"). Callers that already pass a descriptive
  // confirmLabel (e.g. "Confirm resolution?") keep their own wording.
  const actionLabel = typeof label === "string" ? label : null;
  const armedAriaLabel =
    confirmLabel === DEFAULT_CONFIRM_LABEL && actionLabel ? `Confirm ${actionLabel}?` : undefined;

  return (
    <button className={`sh-btn ${armed ? "danger" : kind}`} type="button"
      aria-label={armed ? confirmAriaLabel ?? armedAriaLabel : ariaLabel}
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}>
      <Icon name={armed ? "alert" : icon} size={14} />{armed ? confirmLabel : label}
    </button>
  );
}
