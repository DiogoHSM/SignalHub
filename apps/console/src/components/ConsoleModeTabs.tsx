import { Activity, Bell, FileCode2, Gauge, HeartPulse, KeyRound, MonitorCheck, SearchCode, Settings, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ConsoleMode =
  | "setup"
  | "overview"
  | "operations"
  | "investigate"
  | "alerts"
  | "monitors"
  | "artifacts"
  | "project-settings"
  | "system";

type Props = {
  activeMode: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
};

type ModeItem = {
  mode: ConsoleMode;
  label: string;
  icon: LucideIcon;
};

type ModeButtonProps = ModeItem & {
  activeMode: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
};

function ModeButton({ activeMode, icon: Icon, label, mode, onChange }: ModeButtonProps) {
  return (
    <button aria-pressed={activeMode === mode} onClick={() => onChange(mode)} title={label} type="button">
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

export function ConsoleModeTabs({ activeMode, onChange }: Props) {
  const projectModes: ModeItem[] = [
    { mode: "overview", label: "Overview", icon: Gauge },
    { mode: "operations", label: "Operations", icon: Activity },
    { mode: "investigate", label: "Investigate", icon: SearchCode },
    { mode: "alerts", label: "Alerts", icon: Bell },
    { mode: "monitors", label: "Monitors", icon: HeartPulse },
    { mode: "artifacts", label: "Artifacts", icon: FileCode2 },
    { mode: "project-settings", label: "Project Settings", icon: Settings }
  ];

  const adminModes: ModeItem[] = [
    { mode: "system", label: "System Health", icon: MonitorCheck },
    { mode: "setup", label: "Onboarding", icon: KeyRound }
  ];

  return (
    <div className="mode-tabs" aria-label="Console modes">
      <span aria-label="Project Workspace" className="mode-tabs__label">
        <span aria-hidden="true">Project</span>
        <span className="sr-only">Project Workspace</span>
      </span>
      {projectModes.map((item) => (
        <ModeButton activeMode={activeMode} key={item.mode} onChange={onChange} {...item} />
      ))}
      <span aria-label="Sigmon Admin" className="mode-tabs__label">
        <span aria-hidden="true">Admin</span>
        <span className="sr-only">Sigmon Admin</span>
      </span>
      {adminModes.map((item) => (
        <ModeButton activeMode={activeMode} key={item.mode} onChange={onChange} {...item} />
      ))}
      <div className="mode-tabs__spacer" />
      <a className="mode-tabs__link" href="/sdk" title="Public SDK documentation">
        <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>SDK Docs</span>
      </a>
    </div>
  );
}
