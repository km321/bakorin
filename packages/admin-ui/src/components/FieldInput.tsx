import type { MetaEntity } from "../lib/api.ts";
import { listRelated } from "../lib/api.ts";
import { FileField } from "./FileField.tsx";
import { JsonField } from "./JsonField.tsx";
import { RichTextField } from "./RichTextField.tsx";
import { relatedLabel } from "../lib/label.ts";
import { SearchSelect } from "./SearchSelect.tsx";
import { MultiSelect } from "./MultiSelect.tsx";
import { useEffect, useState } from "preact/hooks";

interface Props {
  field: MetaEntity["fields"][number];
  value: unknown;
  invalid?: boolean;
  /** The stored value when the form opened (file fields say what Save will change). */
  saved?: unknown;
  onChange: (value: unknown) => void;
}

export function FieldInput({ field, value, invalid, saved, onChange }: Props) {
  const [options, setOptions] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (field.relation) {
      void listRelated(field.relation.to).then(setOptions);
    }
  }, [field.relation?.to]);

  const describedBy = invalid ? `${field.name}-error` : field.description ? `${field.name}-hint` : undefined;

  if (field.secret && field.type === "password") {
    return (
      <input
        id={field.name}
        name={field.name}
        type="password"
        value={typeof value === "string" ? value : ""}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        autoComplete="new-password"
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return (
        <input
          id={field.name}
          name={field.name}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
          aria-invalid={invalid}
        />
      );
    case "number":
    case "integer":
      return (
        <input
          id={field.name}
          name={field.name}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onInput={(event) => {
            const text = (event.target as HTMLInputElement).value;
            onChange(text === "" ? null : Number(text));
          }}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      );
    case "date":
      return (
        <input
          id={field.name}
          name={field.name}
          type="date"
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      );
    case "datetime":
      return (
        <input
          id={field.name}
          name={field.name}
          type="datetime-local"
          value={typeof value === "string" ? value.slice(0, 16) : ""}
          onInput={(event) => onChange(new Date((event.target as HTMLInputElement).value).toISOString())}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      );
    case "enum":
      return (
        <select
          id={field.name}
          name={field.name}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange((event.target as HTMLSelectElement).value)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        >
          <option value="">Select</option>
          {(field.enumValues ?? []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      );
    case "json":
      return <JsonField name={field.name} value={value} invalid={invalid} describedBy={describedBy} onChange={onChange} />;
    case "richtext":
      return <RichTextField name={field.name} value={value} invalid={invalid} describedBy={describedBy} onChange={onChange} />;
    case "file":
      return (
        <FileField
          name={field.name}
          value={value}
          saved={saved}
          invalid={invalid}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
    case "relation":
      if (field.relation?.many) {
        return (
          <MultiSelect
            name={field.name}
            value={Array.isArray(value) ? (value as string[]) : []}
            options={options.map((row) => ({
              id: String(row.id),
              label: relatedLabel(row, field.relation?.display),
            }))}
            placeholder="Search to link records"
            onChange={onChange}
          />
        );
      }
      return (
        <SearchSelect
          name={field.name}
          value={typeof value === "string" ? value : ""}
          options={options.map((row) => ({
            id: String(row.id),
            label: relatedLabel(row, field.relation?.display),
          }))}
          placeholder="Search related records"
          onChange={onChange}
        />
      );
    default:
      return (
        <input
          id={field.name}
          name={field.name}
          type={field.type === "email" ? "email" : "text"}
          value={value === undefined || value === null ? "" : String(value)}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      );
  }
}
