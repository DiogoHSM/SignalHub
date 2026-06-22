import type { ReactNode } from "react";
import { LegacyIsland } from "./LegacyIsland";
import type { NavSection } from "../nav";

export type ScreenCtx = { /* filled in Task 10 — project, env, navigate, drill */ };
export type ScreenEntry = { kind: "v2" | "legacy"; render: (ctx: ScreenCtx) => ReactNode };

export const SCREENS: Record<NavSection, ScreenEntry> = {
  overview:    { kind: "legacy", render: () => <Stub label="Overview" /> },
  investigate: { kind: "legacy", render: () => <Stub label="Investigate" /> },
  incidents:   { kind: "legacy", render: () => <Stub label="Incidents" /> },
  llm:         { kind: "legacy", render: () => <Stub label="LLM" /> },
  traces:      { kind: "legacy", render: () => <Stub label="Traces" /> },
  alerts:      { kind: "legacy", render: () => <Stub label="Alerts" /> },
  system:      { kind: "legacy", render: () => <Stub label="System" /> },
  settings:    { kind: "legacy", render: () => <Stub label="Settings" /> },
};

function Stub({ label }: { label: string }) {
  return <div data-stub={label}>{label}</div>;
}

export function renderSection(section: NavSection, ctx: ScreenCtx): ReactNode {
  const entry = SCREENS[section];
  const node = entry.render(ctx);
  return entry.kind === "legacy" ? <LegacyIsland>{node}</LegacyIsland> : node;
}
