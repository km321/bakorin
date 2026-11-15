import type { MetaEntity } from "../lib/api.ts";
import { listRelated, signFile, uploadFile } from "../lib/api.ts";
import { relatedLabel } from "../lib/label.ts";
import { SearchSelect } from "./SearchSelect.tsx";
import { useEffect, useState } from "preact/hooks";

interface Props {
  field: MetaEntity["fields"][number];
  value: unknown;
  invalid?: boolean;
  onChange: (value: unknown) => void;
}

export function FieldInput({ field, value, invalid, onChange }: Props) {
  const [options, setOptions] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<{ url: string; name: string; image: boolean } | null>(null);

  useEffect(() => {
    if (field.relation) {
      void listRelated(field.relation.to).then(setOptions);
    }
  }, [field.relation?.to]);

  useEffect(() => {
    if (field.type !== "file" || typeof value !== "string" || value === "") {
      return;
    }
    let cancelled = false;
    void signFile(value)
      .then((url) => {
        if (!cancelled) {
          setPreview({ url, name: "Uploaded file", image: true });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({ url: "", name: String(value), image: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [field.type, value]);

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
          onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
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
    case "file":
      return (
        <div>
          {preview ? (
            <div class="file-preview">
              {preview.image && preview.url ? <img src={preview.url} alt="" /> : null}
              <span class="muted">{preview.name}</span>
            </div>
          ) : null}
          <input
            class="file-input"
            type="file"
            aria-invalid={invalid}
            onChange={(event) => {
              const file = (event.target as HTMLInputElement).files?.[0];
              if (!file) {
                return;
              }
              void uploadFile(file).then((uploaded) => {
                onChange(uploaded.id);
                const image = Boolean(uploaded.contentType?.startsWith("image/") || file.type.startsWith("image/"));
                setPreview({
                  url: uploaded.url ?? URL.createObjectURL(file),
                  name: uploaded.filename,
                  image,
                });
              });
            }}
          />
        </div>
      );
    case "relation":
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
