import { sev, type Status } from "./status";

export function StatusDot({ status, size = 8, pulse = false }: { status: Status; size?: number; pulse?: boolean }) {
  const c = sev(status).color;
  return (
    <span className="sh-status-dot" style={{ position: "relative", display: "inline-flex", width: size, height: size, flex: "0 0 auto" }}>
      {pulse && status !== "ok" ? (
        <span className="sh-status-dot__ping" style={{ position: "absolute", inset: -2, borderRadius: "50%", background: c, opacity: 0.35 }} />
      ) : null}
      <span className="sh-status-dot__core" style={{ width: size, height: size, borderRadius: "50%", background: c, position: "relative" }} />
    </span>
  );
}
