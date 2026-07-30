import { useState } from "react";
import type { ApiClient } from "../api/client";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SystemHealthPanel } from "./SystemHealthPanel";

type Props = {
  browserCorsOrigins?: string[];
  client: ApiClient;
};

const sections = [
  {
    id: "system-health",
    label: "System health",
    description: "Review installation services, queues, retention, and backups."
  },
  {
    id: "deploy",
    label: "Deploy",
    description: "Review deployment readiness and configuration ownership."
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Review installation mail delivery boundaries."
  },
  {
    id: "storage",
    label: "Storage",
    description: "Review retention, source-map storage, and backup status."
  },
  {
    id: "security",
    label: "Security",
    description: "Review global browser ingestion origin configuration."
  },
  {
    id: "docs-sdk",
    label: "Docs & SDK",
    description: "Review public integration documentation boundaries."
  }
] satisfies SettingsSection[];

type SectionId = (typeof sections)[number]["id"];

export function SigmonAdminWorkspace({ browserCorsOrigins = [], client }: Props) {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("system-health");

  function renderSection() {
    switch (activeSectionId) {
      case "deploy":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Deploy</h2>
            </div>
            <p>Deployment readiness is installation-scoped and read-only here while Sigmon admin editing is still being built.</p>
            <p className="muted-text">
              Server settings are configured through your hosting panel, Docker, and environment variables until admin editing exists.
            </p>
          </section>
        );
      case "notifications":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Notifications</h2>
            </div>
            <p>SMTP is installation-level configuration for outbound console and alert delivery.</p>
            <p className="muted-text">Notification channels belong to projects and are managed from project workflows.</p>
          </section>
        );
      case "storage":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Storage</h2>
            </div>
            <p>Retention, source-map storage, and backup status are summarized in System health.</p>
            <p className="muted-text">Use the health snapshot to confirm cleanup cadence, backup freshness, and storage status.</p>
          </section>
        );
      case "security":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Security</h2>
            </div>
            <p>Global browser ingestion origins are currently configured by BROWSER_CORS_ORIGINS.</p>
            {browserCorsOrigins.length > 0 ? (
              <ul className="origin-list" aria-label="Configured browser origins">
                {browserCorsOrigins.map((origin) => (
                  <li key={origin}>
                    <code>{origin}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-text">No browser origins are configured for cross-origin browser ingestion.</p>
            )}
          </section>
        );
      case "docs-sdk":
        return (
          <section className="panel">
            <div className="panel-header">
              <h2>Docs & SDK</h2>
            </div>
            <p>Public API and SDK documentation are installation-level resources for integrators.</p>
            <p className="muted-text">OpenAPI, Scalar, and SDK docs stay available without requiring an active monitored project.</p>
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
