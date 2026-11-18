import { useMemo, useRef } from "preact/hooks";
import { JsonDraft, checkJson, jsonText } from "../lib/json-draft.ts";

interface Props {
  name: string;
  value: unknown;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: unknown) => void;
}

/**
 * The json field in the record editor: a monospace editor that checks the JSON as
 * you type, with Format to tidy it. The drawer refuses to save JSON that does not parse.
 */
export function JsonField({ name, value, invalid, describedBy, onChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = jsonText(value);
  const check = useMemo(() => checkJson(text), [text]);
  const statusId = `${name}-json-status`;
  const lines = Math.min(24, Math.max(6, text.split("\n").length + 1));

  function format() {
    if (check.ok && !check.empty) {
      onChange(new JsonDraft(JSON.stringify(check.value, null, 2)));
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const area = event.currentTarget as HTMLTextAreaElement;
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      // Two spaces instead of leaving the field. Esc then Tab still moves focus on.
      if (area.dataset.escaped === "1") {
        delete area.dataset.escaped;
        return;
      }
      event.preventDefault();
      const { selectionStart, selectionEnd } = area;
      const next = `${area.value.slice(0, selectionStart)}  ${area.value.slice(selectionEnd)}`;
      onChange(new JsonDraft(next));
      requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = selectionStart + 2;
      });
      return;
    }
    if (event.key === "Escape") {
      area.dataset.escaped = "1";
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      format();
    }
  }

  return (
    <div class={invalid || !check.ok ? "json-field has-error" : "json-field"}>
      <div class="json-toolbar">
        <span class="json-kind">JSON</span>
        <span class="json-spacer" />
        <button class="btn ghost small" type="button" onClick={format} disabled={!check.ok || check.empty}>
          Format
        </button>
        <button
          class="btn ghost small"
          type="button"
          onClick={() => {
            ref.current?.focus();
            if (!check.ok && check.line && ref.current) {
              const lineStart = text.split("\n").slice(0, check.line - 1).join("\n").length + (check.line > 1 ? 1 : 0);
              ref.current.selectionStart = ref.current.selectionEnd = lineStart + Math.max(0, (check.column ?? 1) - 1);
            }
          }}
        >
          Validate
        </button>
      </div>
      <textarea
        ref={ref}
        id={name}
        name={name}
        class="json-input"
        spellcheck={false}
        autoComplete="off"
        autoCapitalize="off"
        rows={lines}
        value={text}
        placeholder={'{\n  "key": "value"\n}'}
        onInput={(event) => onChange(new JsonDraft((event.target as HTMLTextAreaElement).value))}
        onKeyDown={onKeyDown}
        aria-invalid={invalid || !check.ok}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(" ")}
      />
      <p class={check.ok ? "json-status ok" : "json-status error"} id={statusId} aria-live="polite">
        {check.ok
          ? check.empty
            ? "Empty. Saves as no value."
            : `Valid JSON (${describe(check.value)})`
          : `${check.line ? `Line ${check.line}, column ${check.column ?? 1}: ` : ""}${check.message}`}
      </p>
    </div>
  );
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `list of ${value.length}`;
  if (value === null) return "null";
  if (typeof value === "object") return `object with ${Object.keys(value as object).length} keys`;
  return typeof value;
}
