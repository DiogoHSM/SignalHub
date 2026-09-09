import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui/v2";
import { NAV_GROUPS, type NavSection, type NavMode, type NavItem } from "../nav";

export interface NavRailProps {
  active: NavSection;
  onNavigate(section: NavSection): void;
  incidentCount: number | null;
  mode: NavMode;
  onModeChange(mode: NavMode): void;
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function NavRail({ active, onNavigate, incidentCount, mode, onModeChange, mobileOpen, onClose }: NavRailProps) {
  const [revealed, setRevealed] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const preferenceTrigger = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    navRef.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
    return () => { previous?.focus(); };
  }, [mobileOpen]);
  useEffect(() => {
    if (preferencesOpen) navRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
  }, [preferencesOpen]);
  const expanded = mode === "open" || (mode === "auto" && revealed) || !!mobileOpen;
  const modes: Array<{ value: NavMode; label: string }> = [
    { value: "open", label: "Pinned open" },
    { value: "compact", label: "Pinned compact" },
    { value: "auto", label: "Automatic" },
  ];
  const renderItem = (item: NavItem) => {
    const countLabel = !item.badge ? "" : incidentCount === null ? ", count unavailable" : incidentCount > 0 ? `, ${incidentCount} active in selected environment` : "";
    return <button key={item.id} className={`nv-item sh-hit-target ${active === item.id ? "is-active" : ""}`}
      type="button" title={item.label + countLabel} aria-label={item.label + countLabel}
      aria-current={active === item.id ? "page" : undefined}
      onClick={() => { onNavigate(item.id); onClose?.(); }}>
      <Icon name={item.icon} size={18} />
      <span className="nv-label">{item.label}</span>
      {item.badge && incidentCount !== 0 ? <span className={`nv-count ${incidentCount === null ? "is-unknown" : ""}`} aria-hidden="true">{incidentCount ?? "—"}</span> : null}
      {!expanded ? <span className="nv-tip" aria-hidden="true">{item.label + countLabel}</span> : null}
    </button>;
  };
  return <nav ref={navRef} className="nv" aria-label="Main navigation" data-mode={mode} data-expanded={expanded} data-mobile-open={!!mobileOpen}
    onMouseEnter={() => setRevealed(true)} onMouseLeave={() => { if (!preferencesOpen) setRevealed(false); }}
    onFocus={() => setRevealed(true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setRevealed(false); setPreferencesOpen(false); }
    }}
    onKeyDown={(event) => {
      if (mobileOpen && event.key === "Tab") {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === "Escape") {
        if (preferencesOpen) preferenceTrigger.current?.focus();
        event.stopPropagation(); setPreferencesOpen(false); setRevealed(false); onClose?.();
      }
    }}>
    <div className="nv-brand"><div className="nv-logo" aria-hidden="true"><Icon name="activity" size={22} /></div><span className="nv-label">Sigmon</span>
      <button className="nv-mobile-close sh-hit-target" type="button" aria-label="Close navigation" onClick={onClose}><Icon name="x" size={18} /></button>
    </div>
    <div className="nv-links">
      {NAV_GROUPS.map((group) => <div className="nv-group" data-category={group.id} key={group.id}>
        {group.label ? <div className="nv-group-label">{group.label}</div> : null}
        {group.items.map(renderItem)}
      </div>)}
    </div>
    <div className="nv-preferences">
      <button ref={preferenceTrigger} className="nv-item sh-hit-target" type="button" title="Navigation display" aria-label="Navigation display" aria-haspopup="menu" aria-expanded={preferencesOpen}
        onClick={() => setPreferencesOpen(!preferencesOpen)}><Icon name="sidebar" size={18} /><span className="nv-label">Navigation display</span></button>
      {preferencesOpen ? <div className="nv-mode-menu" role="menu" aria-label="Navigation display" onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
        }
      }}>
        {modes.map((option) => <button type="button" role="menuitemradio" aria-checked={mode === option.value} className="sw-opt sh-hit-target" key={option.value}
          onClick={() => { onModeChange(option.value); setPreferencesOpen(false); preferenceTrigger.current?.focus(); }}>
          <Icon name={mode === option.value ? "check" : "sidebar"} size={15} />{option.label}
        </button>)}
      </div> : null}
    </div>
  </nav>;
}
