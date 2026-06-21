import { useState } from "react";
import { Icon } from "./icon";

export function SecretField({ value, masked = true }: { value: string; masked?: boolean }) {
  const [reveal, setReveal] = useState(!masked);
  const [copied, setCopied] = useState(false);
  const shown = reveal ? value : value.replace(/.(?=.{4})/g, "•");
  async function copy() {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;
    try {
      await writeText.call(navigator.clipboard, value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied — leave state unchanged */ }
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div className="sh-code" style={{ flex: 1, padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
        <span className="tok-str" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shown}</span>
      </div>
      <button className="sh-btn" onClick={() => setReveal((r) => !r)} title={reveal ? "Ocultar" : "Revelar"} type="button">
        <Icon name={reveal ? "eyeoff" : "eye"} size={13} />
      </button>
      <button className="sh-btn" onClick={() => void copy()} type="button">
        <Icon name={copied ? "check" : "copy"} size={13} />{copied ? "Copiado" : "Copy"}
      </button>
    </div>
  );
}
