import { Icon } from "../../components/ui/v2";
import type { NavSection } from "../nav";
import { NAV, NAV_BOTTOM } from "../nav";

export interface NavRailProps {
  active: NavSection;
  onNavigate(section: NavSection): void;
  fleetCritical: number;
}

export function NavRail({ active, onNavigate, fleetCritical }: NavRailProps) {
  const renderItem = (it: typeof NAV[number]) => (
    <button
      key={it.id}
      className={`nv-item sh-hit-target ${active === it.id ? "is-active" : ""}`}
      type="button"
      title={it.label}
      onClick={() => onNavigate(it.id)}
    >
      <Icon name={it.icon} size={19} />
      {it.badge && fleetCritical > 0 ? <span className="nv-dot" /> : null}
      <span className="nv-tip">{it.label}</span>
    </button>
  );

  return (
    <nav className="nv">
      <div className="nv-logo" title="SignalMonitor">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 13l5-3 4 4 5-6 4 3"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="20" cy="11" r="2" fill="currentColor" />
        </svg>
      </div>
      {NAV.map(renderItem)}
      <div className="nv-spacer" />
      {NAV_BOTTOM.map(renderItem)}
    </nav>
  );
}
