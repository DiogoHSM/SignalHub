import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function EmptyHint({
  icon = "check",
  title,
  sub,
  cta,
}: {
  icon?: IconName;
  title: ReactNode;
  sub?: ReactNode;
  cta?: ReactNode;
}) {
  return (
    <div style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "48px 24px", gap: 10 }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bg-surface-2)", color: "var(--fg-muted)" }}>
        <Icon name={icon} size={20} />
      </span>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      {sub ? <div className="sh-muted" style={{ fontSize: 12.5, maxWidth: 320 }}>{sub}</div> : null}
      {cta ? <div style={{ marginTop: 6 }}>{cta}</div> : null}
    </div>
  );
}
