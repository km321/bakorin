import { useEffect, useMemo, useState } from "preact/hooks";

interface Option {
  id: string;
  label: string;
}

interface Props {
  name: string;
  value: string;
  options: Option[];
  placeholder?: string;
  onChange: (value: string) => void;
}

export function SearchSelect({ name, value, options, placeholder = "Search", onChange }: Props) {
  const selected = options.find((item) => item.id === value);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open && selected && query !== selected.label) {
      setQuery(selected.label);
    }
  }, [selected?.id, selected?.label, open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || selected?.label.toLowerCase() === needle) {
      return options;
    }
    return options.filter((item) => item.label.toLowerCase().includes(needle));
  }, [options, query, selected?.label]);

  function pick(option: Option) {
    onChange(option.id);
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <div class="combobox">
      <input type="hidden" name={name} value={value} />
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onInput={(event) => {
          const next = (event.target as HTMLInputElement).value;
          setQuery(next);
          setOpen(true);
          if (next === "") {
            onChange("");
          }
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
            pick(filtered[active]!);
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
              No matches
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
                  pick(item);
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
