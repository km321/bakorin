/** @jsxImportSource react */
import { useId, type ReactNode } from "react";
import { inputValue } from "../headless/form.ts";
import { fieldLabel, type FieldSchema } from "../headless/schema.ts";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export interface FieldProps {
  field: FieldSchema;
  value: unknown;
  error?: string;
  label?: string;
  hint?: ReactNode;
  onChange: (raw: unknown) => void;
  /** For relation fields: the choices. Without them the field takes an id. */
  options?: { value: string; label: string }[] | null;
  autoComplete?: string;
  disabled?: boolean;
  /** Replaces the input, for file fields and custom widgets. Gets the ids for labelling. */
  children?: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

const INPUT_TYPES: Partial<Record<FieldSchema["type"], string>> = {
  email: "email",
  password: "password",
  number: "number",
  integer: "number",
  date: "date",
  datetime: "datetime-local",
};

/** One labelled input with its hint and error, wired for screen readers. */
export function Field({ field, value, error, label, hint, onChange, options, autoComplete, disabled, children }: FieldProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const hintId = hint || field.description ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const text = label ?? fieldLabel(field.name);
  const common = {
    id: inputId,
    name: field.name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    disabled,
  } as const;
  let control: ReactNode;
  if (children) {
    control = children({ inputId, describedBy });
  } else if (field.type === "boolean") {
    control = (
      <input {...common} className="bk-checkbox" type="checkbox" checked={value === true} onChange={(event) => onChange(event.currentTarget.checked)} />
    );
  } else if (field.type === "enum" || (field.relation && options)) {
    const choices = field.type === "enum" ? (field.enumValues ?? []).map((item) => ({ value: item, label: item })) : (options ?? []);
    const many = Boolean(field.relation?.many);
    control = (
      <select
        {...common}
        className="bk-input bk-select"
        required={field.required}
        multiple={many}
        value={many ? ((value as string[] | undefined) ?? []) : inputValue(field, value)}
        onChange={(event) =>
          onChange(many ? Array.from(event.currentTarget.selectedOptions, (option) => option.value) : event.currentTarget.value)
        }
      >
        {!many && <option value="">{field.required ? "Choose one" : "None"}</option>}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    );
  } else if ((field.multiline && field.type === "text") || field.type === "json" || field.type === "richtext") {
    control = (
      <textarea
        {...common}
        className={cx("bk-input bk-textarea", field.type === "json" && "bk-textarea--code")}
        spellCheck={field.type === "json" ? false : undefined}
        rows={6}
        required={field.required && field.defaultValue === undefined}
        value={inputValue(field, value)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  } else {
    control = (
      <input
        {...common}
        className="bk-input"
        type={INPUT_TYPES[field.type] ?? "text"}
        step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
        required={field.required && field.defaultValue === undefined}
        autoComplete={autoComplete ?? (field.type === "password" ? "new-password" : field.type === "email" ? "email" : undefined)}
        value={inputValue(field, value)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  const boolean = field.type === "boolean";
  return (
    <div className={cx("bk-field", boolean && "bk-field--check", error && "bk-field--invalid")} data-field={field.name}>
      {boolean && control}
      <label className="bk-label" htmlFor={inputId}>
        {text}
        {field.required && !boolean && (
          <span className="bk-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {!boolean && control}
      {hintId && (
        <p className="bk-hint" id={hintId}>
          {hint ?? field.description}
        </p>
      )}
      {errorId && (
        <p className="bk-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

export function FormAlert({ message, tone = "error" }: { message: string | null | undefined; tone?: "error" | "success" }) {
  // The live region stays in the page (empty and collapsed by CSS) so screen readers announce new messages.
  return (
    <div className={cx("bk-alert", message && `bk-alert--${tone}`)} role={tone === "error" ? "alert" : "status"}>
      {message ?? ""}
    </div>
  );
}
