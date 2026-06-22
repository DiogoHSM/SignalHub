import type { ReactNode } from "react";

export function LegacyIsland({ children }: { children: ReactNode }) {
  return <div className="console-legacy-island">{children}</div>;
}
