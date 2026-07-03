import { useMemo, useState } from "react";
import { Command } from "lucide-react";

export type CommandPaletteItem = {
  id: string;
  title: string;
  description: string;
  meta?: string;
  keywords?: string[];
};

type Props = {
  items: CommandPaletteItem[];
  placeholder: string;
  onClose: () => void;
  onSelect: (item: CommandPaletteItem) => void;
};

export function CommandPalette({ items, placeholder, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      [item.title, item.description, item.meta, ...(item.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [items, normalizedQuery]);

  return (
    <div aria-label="Command palette" aria-modal="true" className="command-palette" role="dialog">
      <div className="command-palette__backdrop" onClick={onClose} />
      <section className="command-palette__panel">
        <label className="command-palette__search">
          <Command aria-hidden="true" size={16} />
          <input
            aria-label="Search commands"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            value={query}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="command-palette__list">
          {filteredItems.length === 0 ? (
            <p className="muted-text">No commands match this search.</p>
          ) : (
            filteredItems.map((item) => (
              <button
                aria-label={`Open ${item.title}`}
                className="command-palette__item"
                key={item.id}
                onClick={() => onSelect(item)}
                type="button"
              >
                <span>
                  <strong>Open {item.title}</strong>
                  <small>{item.description}</small>
                </span>
                {item.meta ? <em>{item.meta}</em> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
