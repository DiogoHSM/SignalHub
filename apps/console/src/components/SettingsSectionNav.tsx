export type SettingsSection = {
  id: string;
  label: string;
  description: string;
};

type Props = {
  activeSectionId: string;
  sections: SettingsSection[];
  onSelectSection: (sectionId: string) => void;
};

export function SettingsSectionNav({ activeSectionId, sections, onSelectSection }: Props) {
  return (
    <nav aria-label="Project settings sections" className="settings-section-nav">
      {sections.map((section) => (
        <button
          aria-label={section.label}
          aria-pressed={section.id === activeSectionId}
          className={section.id === activeSectionId ? "settings-section-nav__button active" : "settings-section-nav__button"}
          key={section.id}
          onClick={() => onSelectSection(section.id)}
          type="button"
        >
          <span className="settings-section-nav__label">{section.label}</span>
          <span className="settings-section-nav__description">{section.description}</span>
        </button>
      ))}
    </nav>
  );
}
