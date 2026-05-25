import { Bell, Boxes, Gauge, HeartPulse, KeyRound, Layers, MonitorCheck, SearchCode, Settings } from "lucide-react";

export type ConsoleMode = "setup" | "overview" | "investigate" | "alerts" | "monitors" | "artifacts" | "system";

type Props = {
  activeMode: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
};

export function ConsoleModeTabs({ activeMode, onChange }: Props) {
  const modes: Array<{ mode: ConsoleMode; label: string; icon: typeof Gauge }> = [
    { mode: "overview", label: "Overview", icon: Gauge },
    { mode: "investigate", label: "Investigate", icon: SearchCode },
    { mode: "alerts", label: "Alerts", icon: Bell },
    { mode: "monitors", label: "Monitors", icon: HeartPulse },
    { mode: "artifacts", label: "Artifacts", icon: Layers },
    { mode: "system", label: "System", icon: MonitorCheck },
    { mode: "setup", label: "Setup", icon: KeyRound }
  ];

  return (
    <div className="mode-tabs" aria-label="Console modes">
      {modes.map(({ icon: Icon, label, mode }) => (
        <button aria-pressed={activeMode === mode} key={mode} onClick={() => onChange(mode)} title={label} type="button">
          <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>{label}</span>
        </button>
      ))}
      <div className="mode-tabs__spacer" />
      <button aria-label="Documentation" aria-pressed="false" title="Documentation" type="button">
        <Boxes aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>Docs</span>
      </button>
      <button aria-label="Settings" aria-pressed="false" title="Settings" type="button">
        <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>Settings</span>
      </button>
    </div>
  );
}
