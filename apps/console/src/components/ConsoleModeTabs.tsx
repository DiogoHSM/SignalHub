export type ConsoleMode = "setup" | "investigate";

type Props = {
  activeMode: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
};

export function ConsoleModeTabs({ activeMode, onChange }: Props) {
  return (
    <div className="mode-tabs" aria-label="Console modes">
      <button aria-pressed={activeMode === "setup"} onClick={() => onChange("setup")} type="button">
        Setup
      </button>
      <button aria-pressed={activeMode === "investigate"} onClick={() => onChange("investigate")} type="button">
        Investigate
      </button>
    </div>
  );
}
