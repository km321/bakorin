import type { MetaEntity } from "../lib/api.ts";
import { listRelated, uploadFile } from "../lib/api.ts";
import { useEffect, useState } from "preact/hooks";

interface Props {
  field: MetaEntity["fields"][number];
  value: unknown;
  onChange: (value: unknown) => void;
}

export function FieldInput({ field, value, onChange }: Props) {
  const [options, setOptions] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (field.relation) {
      void listRelated(field.relation.to).then(setOptions);
    }
  }, [field.relation?.to]);

  if (field.secret && field.type === "password") {
    return (
      <input
        name={field.name}
        type="password"
        value={typeof value === "string" ? value : ""}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        autocomplete="new-password"
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return (
        <input
          name={field.name}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
        />
      );
    case "number":
    case "integer":
      return (
        <input
          name={field.name}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
        />
      );
    case "date":
      return (
        <input
          name={field.name}
          type="date"
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        />
      );
    case "datetime":
      return (
        <input
          name={field.name}
          type="datetime-local"
          value={typeof value === "string" ? value.slice(0, 16) : ""}
          onInput={(event) => onChange(new Date((event.target as HTMLInputElement).value).toISOString())}
        />
      );
    case "enum":
      return (
        <select name={field.name} value={typeof value === "string" ? value : ""} onChange={(event) => onChange((event.target as HTMLSelectElement).value)}>
          <option value="">Select</option>
          {(field.enumValues ?? []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      );
    case "file":
      return (
        <input
          class="file-input"
          type="file"
          onChange={(event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) {
              void uploadFile(file).then(onChange);
            }
          }}
        />
      );
    case "relation":
      return (
        <select name={field.name} value={typeof value === "string" ? value : ""} onChange={(event) => onChange((event.target as HTMLSelectElement).value)}>
          <option value="">Select</option>
          {options.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>
              {String(row.name ?? row.email ?? row.title ?? row.company ?? row.id)}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          name={field.name}
          type={field.type === "email" ? "email" : "text"}
          value={value === undefined || value === null ? "" : String(value)}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        />
      );
  }
}
