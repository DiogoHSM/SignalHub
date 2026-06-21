import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function ConfirmButton({ label, confirmLabel = "Confirmar?", icon = "check", kind = "primary", onConfirm }:
  { label: ReactNode; confirmLabel?: ReactNode; icon?: IconName; kind?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`sh-btn ${armed ? "danger" : kind}`} type="button"
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}>
      <Icon name={armed ? "alert" : icon} size={14} />{armed ? confirmLabel : label}
    </button>
  );
}
