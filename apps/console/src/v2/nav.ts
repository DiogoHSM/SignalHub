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
  | "settings"
  | "installation"
  | "administration";

export type NavItem = {
  id: NavSection;
  icon: IconName;
  label: string;
  badge?: boolean;
};

export type NavMode = "open" | "compact" | "auto";
export type NavGroup = { id: string; label: string; items: NavItem[] };
export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "", items: [{ id: "overview", icon: "home", label: "Overview" }] },
  { id: "operate", label: "Operate", items: [
    { id: "incidents", icon: "error", label: "Incidents", badge: true },
    { id: "monitors", icon: "pulse", label: "Monitors" },
    { id: "alerts", icon: "bell", label: "Alert rules" },
  ] },
  { id: "investigate", label: "Investigate", items: [
    { id: "investigate", icon: "alert", label: "Errors" },
    { id: "events", icon: "activity", label: "Events" },
    { id: "traces", icon: "waterfall", label: "Traces" },
    { id: "llm", icon: "sparkles", label: "AI calls" },
  ] },
  { id: "understand", label: "Understand", items: [
    { id: "analytics", icon: "grid", label: "Analytics" },
    { id: "users", icon: "users", label: "Users" },
    { id: "entities", icon: "cube", label: "Accounts" },
    { id: "experiments", icon: "flag", label: "Experiments" },
  ] },
  { id: "configure", label: "Configure", items: [
    { id: "settings", icon: "settings", label: "Project settings" },
    { id: "installation", icon: "book", label: "Installation & SDK" },
  ] },
  { id: "instance", label: "Instance", items: [
    { id: "system", icon: "server", label: "Sigmon health" },
    { id: "administration", icon: "shield", label: "Administration" },
  ] },
];

export function navGroup(section: NavSection): NavGroup {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === section)) ?? NAV_GROUPS[0];
}

export function isInstanceSection(section: NavSection): boolean {
  return section === "system" || section === "administration";
}

export const NAV: NavItem[] = NAV_GROUPS.filter((group) => group.id !== "instance").flatMap((group) => group.items);
export const NAV_BOTTOM: NavItem[] = NAV_GROUPS.find((group) => group.id === "instance")!.items;
