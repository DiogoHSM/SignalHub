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
      {sections.map((section) => {
        const labelId = `settings-section-${section.id}-label`;
        const descriptionId = `settings-section-${section.id}-description`;

        return (
          <button
            aria-describedby={descriptionId}
            aria-labelledby={labelId}
            aria-pressed={section.id === activeSectionId}
            className={section.id === activeSectionId ? "settings-section-nav__button active" : "settings-section-nav__button"}
            key={section.id}
            onClick={() => onSelectSection(section.id)}
            type="button"
          >
            <span className="settings-section-nav__label" id={labelId}>
              {section.label}
            </span>
            <span className="settings-section-nav__description" id={descriptionId}>
              {section.description}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
