import { useEffect, useState } from "preact/hooks";
import type { MetaEntity } from "../lib/api.ts";
import { saveRecord } from "../lib/api.ts";
import { fieldLabel } from "../lib/label.ts";
import { FieldInput } from "./FieldInput.tsx";

interface Props {
  entity: MetaEntity;
  record: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
}

export function Drawer({ entity, record, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, unknown>>(record ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const defaults: Record<string, unknown> = { ...(record ?? {}) };
    for (const field of entity.fields) {
      if (defaults[field.name] === undefined && field.defaultValue !== undefined && field.defaultValue !== null) {
        defaults[field.name] = field.defaultValue;
      }
    }
    setForm(defaults);
    setError(null);
  }, [record, entity.name]);

  const fields = entity.fields.filter((field) => field.name !== "id" && field.name !== "createdAt" && field.name !== "updatedAt");

  async function submit(event: Event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData(event.target as HTMLFormElement);
    try {
      const body = { ...form };
      for (const field of fields) {
        if (field.type === "file" || field.type === "boolean") {
          continue;
        }
        const raw = data.get(field.name);
        if (typeof raw === "string" && raw !== "") {
          body[field.name] = raw;
        }
      }
      if (record) {
        for (const field of fields) {
          if (field.secret && !body[field.name]) {
            delete body[field.name];
          }
        }
      }
      await saveRecord(entity.name, record ? String(record.id) : null, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <form class="drawer" id="bakorin-drawer" onSubmit={submit}>
        <h2>{record ? `Edit ${entity.label}` : `New ${entity.label}`}</h2>
        {error ? <div class="banner">{error}</div> : null}
        {fields.map((field) => (
          <div class="field" key={field.name}>
            <label>
              {fieldLabel(field.name)}
              {field.required ? " *" : ""}
            </label>
            <FieldInput field={field} value={form[field.name]} onChange={(value) => setForm({ ...form, [field.name]: value })} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button class="btn" disabled={saving} type="submit">
            {saving ? "Saving" : "Save"}
          </button>
          <button class="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
