import type { IconName } from "../components/ui/v2/icon";

export type NavSection =
  | "overview"
  | "investigate"
  | "incidents"
  | "llm"
  | "traces"
  | "entities"
  | "users"
  | "events"
  | "analytics"
  | "alerts"
  | "monitors"
  | "experiments"
  | "system"
  | "settings";

export type NavItem = {
  id: NavSection;
  icon: IconName;
  label: string;
  badge?: boolean;
};

export const NAV: NavItem[] = [
  { id: "overview",    icon: "home",      label: "Overview" },
  { id: "investigate", icon: "activity",  label: "Investigate" },
  { id: "incidents",   icon: "error",     label: "Incidents", badge: true },
  { id: "llm",         icon: "sparkles",  label: "LLM" },
  { id: "traces",      icon: "waterfall", label: "Traces" },
  { id: "entities",    icon: "box",       label: "Entities" },
  { id: "users",       icon: "users",     label: "Users" },
  { id: "events",      icon: "activity",  label: "Events" },
  { id: "analytics",   icon: "grid",      label: "Analytics" },
  { id: "alerts",      icon: "bell",      label: "Alerts" },
  { id: "monitors",    icon: "pulse",     label: "Monitors" },
  { id: "experiments", icon: "flag",      label: "Experiments" },
];

export const NAV_BOTTOM: NavItem[] = [
  { id: "system",   icon: "server",   label: "System" },
  { id: "settings", icon: "settings", label: "Settings" },
];
