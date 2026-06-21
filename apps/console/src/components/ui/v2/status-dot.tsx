import { sev, type Status } from "./status";

export function StatusDot({ status, size = 8, pulse = false }: { status: Status; size?: number; pulse?: boolean }) {
  const c = sev(status).color;
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flex: "0 0 auto" }}>
      {pulse && status !== "ok" ? (
        <span style={{ position: "absolute", inset: -2, borderRadius: "50%", background: c, opacity: 0.35, animation: "sh-ping 1.8s cubic-bezier(0,0,.2,1) infinite" }} />
      ) : null}
      <span style={{ width: size, height: size, borderRadius: "50%", background: c, position: "relative" }} />
    </span>
  );
}
