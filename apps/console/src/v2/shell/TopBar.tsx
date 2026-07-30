import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Environment, Project } from "../../api/types";
import { Icon } from "../../components/ui/v2";
import { StatusDot } from "../../components/ui/v2";
import type { Status } from "../../components/ui/v2";

export type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

export interface TopBarProps {
  projects: Project[];
  project: Project;
  environments: Environment[];
  env: Environment;
  onSelectProject: (id: string) => void;
  onSelectEnv: (id: string) => void;
  crumb: BreadcrumbItem[];
  railCollapsed: boolean;
  onToggleRail: () => void;
  onRefresh: () => void;
  onOpenSearch: () => void;
  /** Authenticated user — initials derived from email; falls back to "OP". */
  userEmail?: string;
  onSignOut?: () => Promise<void>;
}

// Projects and environments don't carry a `status` field in the API types,
// so we cast to accept an optional status and fall back to "idle".
type WithOptionalStatus<T> = T & { status?: Status };

function ProjectSwitcher({
  projects,
  project,
  environments,
  env,
  onSelectProject,
  onSelectEnv,
}: {
  projects: Project[];
  project: Project;
  environments: Environment[];
  env: Environment;
  onSelectProject: (id: string) => void;
  onSelectEnv: (id: string) => void;
}) {
  const [open, setOpen] = useState<"project" | "env" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const p = project as WithOptionalStatus<Project>;
  const e = env as WithOptionalStatus<Environment>;

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6 }}
      ref={wrapperRef}
      onClick={(ev) => ev.stopPropagation()}
    >
      {/* Project pill */}
      <div style={{ position: "relative" }}>
        <button
          className="sw-pill"
          onClick={() => setOpen(open === "project" ? null : "project")}
          aria-expanded={open === "project"}
        >
          <StatusDot status={p.status ?? "idle"} size={7} pulse={p.status === "critical"} />
          <span style={{ fontWeight: 600 }}>{project.name}</span>
          <Icon name="chevd" size={13} style={{ color: "var(--fg-muted)" }} />
        </button>
        {open === "project" ? (
          <div className="sw-menu">
            <div className="sw-menu__head">Switch project</div>
            {projects.map((proj) => {
              const pp = proj as WithOptionalStatus<Project>;
              return (
                <button
                  key={proj.id}
                  className={`sw-opt ${proj.id === project.id ? "is-active" : ""}`}
                  onClick={() => {
                    onSelectProject(proj.id);
                    setOpen(null);
                  }}
                >
                  <StatusDot status={pp.status ?? "idle"} size={7} />
                  <span style={{ flex: 1, textAlign: "left" }}>{proj.name}</span>
                  {proj.id === project.id ? (
                    <Icon name="check" size={13} stroke={2.4} style={{ color: "var(--accent)" }} />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Environment pill */}
      <div style={{ position: "relative" }}>
        <button
          className="sw-pill"
          onClick={() => setOpen(open === "env" ? null : "env")}
          aria-expanded={open === "env"}
        >
          <span>{env.name}</span>
          <Icon name="chevd" size={13} style={{ color: "var(--fg-muted)" }} />
        </button>
        {open === "env" ? (
          <div className="sw-menu">
            <div className="sw-menu__head">Environment</div>
            {environments.map((envItem) => {
              const ee = envItem as WithOptionalStatus<Environment>;
              return (
                <button
                  key={envItem.id}
                  className={`sw-opt ${envItem.id === env.id ? "is-active" : ""}`}
                  onClick={() => {
                    onSelectEnv(envItem.id);
                    setOpen(null);
                  }}
                >
                  <StatusDot status={ee.status ?? "idle"} size={7} />
                  <span style={{ flex: 1, textAlign: "left" }}>{envItem.name}</span>
                  {envItem.id === env.id ? (
                    <Icon name="check" size={13} stroke={2.4} style={{ color: "var(--accent)" }} />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <div className="bc">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 ? <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }} /> : null}
            {it.onClick && !last ? (
              <button className="bc-seg bc-seg--link" onClick={it.onClick}>
                {it.label}
              </button>
            ) : (
              <span className={`bc-seg ${last ? "bc-seg--current" : ""}`}>{it.label}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function deriveInitials(email: string | undefined): string {
  if (!email) return "OP";
  const [name] = email.split("@");
  const parts = name.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function TopBar({
  projects,
  project,
  environments,
  env,
  onSelectProject,
  onSelectEnv,
  crumb,
  railCollapsed,
  onToggleRail,
  onRefresh,
  onOpenSearch,
  userEmail,
  onSignOut,
}: TopBarProps) {
  const avatarInitials = deriveInitials(userEmail);
  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    accountMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  const signOut = async () => {
    if (!onSignOut || isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await onSignOut();
      setAccountOpen(false);
    } catch {
      setSignOutError("Could not sign out. Try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  const moveAccountFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(accountMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    items[(current + delta + items.length) % items.length]?.focus();
  };

  return (
    <header className="tb">
      <ProjectSwitcher
        projects={projects}
        project={project}
        environments={environments}
        env={env}
        onSelectProject={onSelectProject}
        onSelectEnv={onSelectEnv}
      />
      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)", margin: "0 2px" }} />
      <Breadcrumb items={crumb} />
      <div className="tb-search" onClick={onOpenSearch} style={{ cursor: "pointer" }}>
        <Icon name="search" size={14} />
        <span>Search events, errors, tenants, traces…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="tb-actions">
        <button className="tb-icon" title="Refresh now" onClick={onRefresh}>
          <Icon name="refresh" size={15} />
        </button>
        <button className="tb-icon" title="Notifications">
          <Icon name="bell" size={15} />
          <span className="tb-icon__dot" />
        </button>
        {railCollapsed ? (
          <button className="tb-icon" title="Show project radar" onClick={onToggleRail}>
            <Icon name="panelExpand" size={15} />
          </button>
        ) : null}
        <div ref={accountRef} style={{ position: "relative" }}>
          <button
            ref={accountTriggerRef}
            type="button"
            className="tb-avatar"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            title={userEmail ?? "Console operator"}
            onClick={() => {
              setSignOutError(null);
              setAccountOpen((open) => !open);
            }}
            style={{ border: 0, padding: 0 }}
          >
            {avatarInitials}
          </button>
          {accountOpen ? (
            <div className="sw-menu" style={{ right: 0, left: "auto", minWidth: 220 }}>
              <div className="sw-menu__head" style={{ textTransform: "none" }}>{userEmail ?? "Console operator"}</div>
              <div ref={accountMenuRef} role="menu" aria-label="Account" onKeyDown={moveAccountFocus}>
                <button className="sw-opt" role="menuitem" type="button" disabled={!onSignOut || isSigningOut} onClick={() => void signOut()}>
                  <Icon name="arrow" size={14} />
                  <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
                </button>
              </div>
              {signOutError ? <div className="sh-error" role="alert" style={{ padding: "8px 12px", fontSize: 11 }}>{signOutError}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
