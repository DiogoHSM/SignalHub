import { useEffect, useState, type ReactNode } from "react";

const NARROW_CONSOLE_QUERY = "(max-width: 899px)";

function currentMatch(maxWidth: number): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
}

export function useNarrowConsole(maxWidth = 899): boolean {
  const [isNarrow, setIsNarrow] = useState(() => currentMatch(maxWidth));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    setIsNarrow(mediaQuery.matches);
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [maxWidth]);

  return isNarrow;
}

export function NarrowConsoleBoundary({ children }: { children: ReactNode }) {
  const isNarrow = useNarrowConsole();
  if (!isNarrow) return children;

  return (
    <main className="sh-v2 narrow-console-boundary">
      <section className="narrow-console-boundary__panel" aria-labelledby="narrow-console-title">
        <span className="narrow-console-boundary__mark" aria-hidden="true" />
        <h1 className="sh-h1" id="narrow-console-title">Investigation needs a wider screen</h1>
        <p className="sh-muted">
          Dense traces, dashboards, and operational workflows are available from 900px. The mobile status view keeps
          fleet health and incidents readable here.
        </p>
        <a className="sh-btn primary narrow-console-boundary__link" href="/console/status">
          Open mobile status
        </a>
      </section>
    </main>
  );
}

export { NARROW_CONSOLE_QUERY };
