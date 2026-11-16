import { useEffect, useMemo, useState } from "preact/hooks";
import type { MetaEntity } from "../lib/api.ts";
import { saveRecord } from "../lib/api.ts";
import { fieldLabel } from "../lib/label.ts";
import { pushToast } from "../lib/toast.ts";
import { FieldInput } from "./FieldInput.tsx";

interface Props {
  entity: MetaEntity;
  record: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function Drawer({ entity, record, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, unknown>>(record ?? {});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const fields = useMemo(
    () =>
      entity.fields.filter(
        (field) => field.name !== "id" && field.name !== "createdAt" && field.name !== "updatedAt" && field.writable !== "none",
      ),
    [entity],
  );

  useEffect(() => {
    const defaults: Record<string, unknown> = { ...(record ?? {}) };
    for (const field of entity.fields) {
      if (defaults[field.name] === undefined && field.defaultValue !== undefined && field.defaultValue !== null) {
        defaults[field.name] = field.defaultValue;
      }
    }
    setForm(defaults);
    setError(null);
    setFieldErrors({});
  }, [record, entity.name]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function validate(body: Record<string, unknown>): Record<string, string> {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const value = body[field.name];
      if (field.required && isEmpty(value) && !(record && field.secret)) {
        next[field.name] = `${fieldLabel(field.name)} is required`;
        continue;
      }
      if (field.type === "email" && typeof value === "string" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        next[field.name] = "Enter a valid email";
      }
      if (field.type === "password" && typeof value === "string" && value && value.length < 8) {
        next[field.name] = "Password must be at least 8 characters";
      }
    }
    return next;
  }

  async function submit(event: Event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData(event.target as HTMLFormElement);
    try {
      const body = { ...form };
      for (const field of fields) {
        if (field.type === "file" || field.type === "boolean" || field.relation?.many) {
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
      const nextErrors = validate(body);
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        setSaving(false);
        return;
      }
      await saveRecord(entity.name, record ? String(record.id) : null, body);
      pushToast("ok", record ? `${entity.label} saved` : `${entity.label} created`);
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
      <form class="drawer" id="bakorin-drawer" onSubmit={submit} aria-labelledby="drawer-title">
        <h2 id="drawer-title">{record ? `Edit ${entity.label}` : `New ${entity.label}`}</h2>
        {error ? <div class="banner">{error}</div> : null}
        {fields.map((field) => {
          const invalid = Boolean(fieldErrors[field.name]);
          return (
            <div class={invalid ? "field invalid" : "field"} key={field.name}>
              <label htmlFor={field.name}>
                {fieldLabel(field.name)}
                {field.required ? (
                  <span class="req" title="Required">
                    {" "}
                    *
                  </span>
                ) : null}
              </label>
              {field.description ? (
                <p class="field-hint" id={`${field.name}-hint`}>
                  {field.description}
                </p>
              ) : null}
              <FieldInput
                field={field}
                value={form[field.name]}
                invalid={invalid}
                onChange={(value) => {
                  setForm({ ...form, [field.name]: value });
                  if (fieldErrors[field.name]) {
                    const copy = { ...fieldErrors };
                    delete copy[field.name];
                    setFieldErrors(copy);
                  }
                }}
              />
              {invalid ? (
                <p class="field-error" id={`${field.name}-error`}>
                  {fieldErrors[field.name]}
                </p>
              ) : null}
            </div>
          );
        })}
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
