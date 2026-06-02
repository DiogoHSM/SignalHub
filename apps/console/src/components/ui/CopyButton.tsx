import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  value: string;
  label?: string;
};

export function CopyButton({ label = "Copy", value }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const Icon = copied ? Check : Copy;

  return (
    <button className="copy-button" onClick={() => void copy()} title={copied ? "Copied" : label} type="button">
      <Icon aria-hidden="true" size={15} />
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
