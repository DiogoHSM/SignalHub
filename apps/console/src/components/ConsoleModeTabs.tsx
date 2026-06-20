import { Activity, Bell, Gauge, MonitorCheck, SearchCode, Settings, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ConsoleMode =
  | "home"
  | "operations"
  | "analyze"
  | "traces"
  | "errors"
  | "experiments"
  | "configure"
  | "system"
  | "setup"
  | "overview"
  | "investigate"
  | "alerts"
  | "monitors"
  | "artifacts"
  | "project-settings";

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
  const globalModes: ModeItem[] = [{ mode: "home", label: "Home", icon: Gauge }];

  const projectModes: ModeItem[] = [
    { mode: "operations", label: "Operations", icon: Activity },
    { mode: "analyze", label: "Analyze", icon: SearchCode },
    { mode: "traces", label: "Traces", icon: Activity },
    { mode: "errors", label: "Errors", icon: Bell },
    { mode: "experiments", label: "Experiments", icon: ShieldCheck },
    { mode: "configure", label: "Configure", icon: Settings }
  ];

  const adminModes: ModeItem[] = [{ mode: "system", label: "Admin", icon: MonitorCheck }];

  return (
    <div className="mode-tabs" aria-label="Console modes">
      <span aria-label="Global" className="mode-tabs__label" role="group">
        <span aria-hidden="true">Global</span>
        <span className="sr-only">Global</span>
      </span>
      {globalModes.map((item) => (
        <ModeButton activeMode={activeMode} key={item.mode} onChange={onChange} {...item} />
      ))}
      <span aria-label="Project Workspace" className="mode-tabs__label" role="group">
        <span aria-hidden="true">Project</span>
        <span className="sr-only">Project Workspace</span>
      </span>
      {projectModes.map((item) => (
        <ModeButton activeMode={activeMode} key={item.mode} onChange={onChange} {...item} />
      ))}
      <span aria-label="Sigmon Admin" className="mode-tabs__label" role="group">
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
