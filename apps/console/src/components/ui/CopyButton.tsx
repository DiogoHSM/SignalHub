import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  value: string;
  label?: string;
};

export function CopyButton({ label = "Copy", value }: Props) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed" | "unavailable">("idle");
  const isMounted = useRef(true);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (resetTimer.current !== undefined) {
        window.clearTimeout(resetTimer.current);
      }
    };
  }, []);

  function showTemporaryStatus(nextStatus: typeof status) {
    if (!isMounted.current) return;

    if (resetTimer.current !== undefined) {
      window.clearTimeout(resetTimer.current);
    }
    setStatus(nextStatus);
    resetTimer.current = window.setTimeout(() => {
      if (isMounted.current) {
        setStatus("idle");
      }
    }, 1500);
  }

  async function copy() {
    const writeText = navigator.clipboard?.writeText;

    if (!writeText) {
      showTemporaryStatus("unavailable");
      return;
    }

    try {
      await writeText.call(navigator.clipboard, value);
      showTemporaryStatus("copied");
    } catch {
      showTemporaryStatus("failed");
    }
  }

  const Icon = status === "copied" ? Check : Copy;
  const buttonLabel =
    status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : status === "unavailable" ? "Copy unavailable" : label;

  return (
    <button className="copy-button" onClick={() => void copy()} title={buttonLabel} type="button">
      <Icon aria-hidden="true" size={15} />
      <span>{buttonLabel}</span>
    </button>
  );
}
