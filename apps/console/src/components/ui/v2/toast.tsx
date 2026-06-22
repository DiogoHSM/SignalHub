import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type Toast = { id: number; title: ReactNode; sub?: ReactNode; icon?: IconName; tone?: "ok" | "warn" | "critical" };

export function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  return (
    <div className="toast" data-tone={toast.tone}>
      <span className="toast__icon"><Icon name={toast.icon ?? "check"} size={15} /></span>
      <div style={{ flex: 1 }}>
        <div className="toast__title">{toast.title}</div>
        {toast.sub ? <div className="toast__sub">{toast.sub}</div> : null}
      </div>
      <button className="toast__x" onClick={() => onDismiss(toast.id)} aria-label="Dismiss" type="button">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
