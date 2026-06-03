import { useState } from "react";
import type { ApiClient } from "../api/client";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SystemHealthPanel } from "./SystemHealthPanel";

type Props = {
  client: ApiClient;
};

const sections = [
  {
    id: "system-health",
    label: "System health",
    description: "Review installation services, queues, retention, and backups."
  },
  {
    id: "server-settings",
    label: "Server settings",
    description: "Review deployment readiness and configuration ownership."
  },
  {
    id: "smtp-delivery",
    label: "SMTP & delivery",
    description: "Review installation mail delivery boundaries."
  },
  {
    id: "retention-backups",
    label: "Retention & backups",
    description: "Review where cleanup and backup status is summarized."
  },
  {
    id: "security-cors",
    label: "Security & CORS",
    description: "Review global browser ingestion origin configuration."
  }
] satisfies SettingsSection[];

type SectionId = (typeof sections)[number]["id"];

export function SigmonAdminWorkspace({ client }: Props) {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("system-health");

  function renderSection() {
    switch (activeSectionId) {
      case "server-settings":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Server settings</h2>
            </div>
            <p>Deployment readiness is read-only here while Sigmon admin editing is still being built.</p>
            <p className="muted-text">
              Server settings are configured through EasyPanel, Docker, and environment variables until admin editing exists.
            </p>
          </section>
        );
      case "smtp-delivery":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>SMTP & delivery</h2>
            </div>
            <p>SMTP is installation-level configuration for outbound console and alert delivery.</p>
            <p className="muted-text">Notification channels belong to projects and are managed from project workflows.</p>
          </section>
        );
      case "retention-backups":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Retention & backups</h2>
            </div>
            <p>Retention and backup status is summarized in System health.</p>
            <p className="muted-text">Use the health snapshot to confirm cleanup cadence, backup freshness, and storage status.</p>
          </section>
        );
      case "security-cors":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Security & CORS</h2>
            </div>
            <p>Global browser ingestion origins are currently configured by BROWSER_CORS_ORIGINS.</p>
          </section>
        );
      case "system-health":
      default:
        return <SystemHealthPanel client={client} />;
    }
  }

  return (
    <section className="settings-workspace sigmon-admin-workspace">
      <header className="settings-workspace__header">
        <h1>Sigmon Admin</h1>
        <p>Installation-level status and server configuration.</p>
      </header>
      <div className="settings-workspace__body">
        <SettingsSectionNav
          activeSectionId={activeSectionId}
          ariaLabel="Sigmon admin sections"
          onSelectSection={(sectionId) => setActiveSectionId(sectionId as SectionId)}
          sections={sections}
        />
        <div className="settings-workspace__content">{renderSection()}</div>
      </div>
    </section>
  );
}
