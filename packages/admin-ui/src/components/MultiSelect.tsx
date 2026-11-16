import { useMemo, useState } from "preact/hooks";

interface Option {
  id: string;
  label: string;
}

interface Props {
  name: string;
  value: string[];
  options: Option[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}

/** Picker for many to many fields: chosen records as removable chips, plus a search to add more. */
export function MultiSelect({ name, value, options, placeholder = "Search to add", onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const byId = useMemo(() => new Map(options.map((item) => [item.id, item])), [options]);
  const chosen = new Set(value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter((item) => !chosen.has(item.id) && (!needle || item.label.toLowerCase().includes(needle)));
  }, [options, query, value]);

  function add(option: Option) {
    onChange([...value, option.id]);
    setQuery("");
    setActive(0);
  }

  function remove(id: string) {
    onChange(value.filter((item) => item !== id));
  }

  return (
    <div class="combobox multiselect" data-field={name}>
      {value.length > 0 ? (
        <ul class="chips" aria-label="Selected">
          {value.map((id) => {
            const label = byId.get(id)?.label ?? id;
            return (
              <li key={id} class="chip">
                <span>{label}</span>
                <button type="button" aria-label={`Remove ${label}`} onClick={() => remove(id)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onInput={(event) => {
          setQuery((event.target as HTMLInputElement).value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
            setOpen(true);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && filtered[active]) {
            event.preventDefault();
            add(filtered[active]!);
          } else if (event.key === "Backspace" && query === "" && value.length > 0) {
            remove(value[value.length - 1]!);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
      />
      {open ? (
        <div class="combobox-list" role="listbox">
          {filtered.length === 0 ? (
            <button type="button" disabled>
              {options.length === 0 ? "Nothing to link yet" : "No more matches"}
            </button>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(item);
                }}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
