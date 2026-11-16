/** @jsxImportSource react */
import { useRef, type FormEvent, type ReactNode } from "react";
import type { FieldSchema } from "../headless/schema.ts";
import type { FormValues } from "../headless/form.ts";
import { Field, FormAlert, cx } from "./field.tsx";
import { useRecordForm, useRelationOptions, type UseRecordFormOptions } from "./hooks.ts";
import { FileUpload } from "./upload.tsx";

export interface RecordFormProps<R> extends UseRecordFormOptions<R> {
  submitLabel?: string;
  /** Clear the form after a create. Default true. */
  resetOnCreate?: boolean;
  /** Message after saving. Default "Saved". Set to null for none. */
  successMessage?: string | null;
  labels?: Record<string, string>;
  hints?: Record<string, ReactNode>;
  /** Choices for relation fields, by field name. Without them the form loads up to 100 related records. */
  relationOptions?: Record<string, { value: string; label: string }[]>;
  className?: string;
  /** Use a collection's create and update so lists change at once. */
  collection?: {
    create: (body: never) => Promise<unknown>;
    update: (id: string, body: never) => Promise<unknown>;
  };
  children?: ReactNode;
}

function RelationField(props: {
  field: FieldSchema;
  value: unknown;
  error?: string;
  label?: string;
  hint?: ReactNode;
  options?: { value: string; label: string }[];
  onChange: (raw: unknown) => void;
}) {
  const loaded = useRelationOptions(props.field, !props.options);
  return <Field {...props} options={props.options ?? loaded} />;
}

/** A create or edit form built from the schema: labels, input types, validation, and server errors per field. */
export function RecordForm<R = Record<string, unknown>>(props: RecordFormProps<R>) {
  const { submitLabel, resetOnCreate = true, successMessage = "Saved", labels, hints, relationOptions, className, collection, children } = props;
  const recordId = (props.record as { id?: unknown } | undefined)?.id;
  const sent = useRef<string | null>(null);
  const form = useRecordForm<R>({
    ...props,
    submit:
      props.submit ??
      (collection
        ? (values: FormValues, mode) =>
            (mode === "update" ? collection.update(String(recordId), values as never) : collection.create(values as never)) as Promise<R>
        : undefined),
    onSuccess: (record) => {
      // Clear the form unless the person already started typing the next record.
      if (resetOnCreate && !props.record && JSON.stringify(form.store.get().values) === sent.current) {
        form.reset();
      }
      props.onSuccess?.(record);
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    sent.current = JSON.stringify(form.store.get().values);
    const result = await form.submit();
    if (result === undefined) {
      // Move focus to the first problem (after React renders it) so keyboard and screen reader users find it.
      setTimeout(() => element.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
    }
  }

  return (
    <form method="post" className={cx("bk-form", "bk-record-form", className)} onSubmit={submit} noValidate aria-busy={form.submitting || undefined}>
      <FormAlert message={form.formError} />
      {form.fields.map((field) => {
        const shared = {
          field,
          value: form.values[field.name],
          error: form.errors[field.name],
          label: labels?.[field.name],
          hint: hints?.[field.name],
          onChange: (raw: unknown) => form.setValue(field.name, raw),
        };
        if (field.relation) {
          return <RelationField key={field.name} {...shared} options={relationOptions?.[field.name]} />;
        }
        if (field.type === "file") {
          return (
            <Field key={field.name} {...shared}>
              {({ inputId, describedBy }) => (
                <FileUpload inputId={inputId} describedBy={describedBy} onUploaded={(file) => form.setValue(field.name, file.id)} />
              )}
            </Field>
          );
        }
        return <Field key={field.name} {...shared} />;
      })}
      {children}
      <div className="bk-actions">
        <button className="bk-button" type="submit" disabled={form.submitting}>
          {form.submitting ? "Saving..." : (submitLabel ?? (form.mode === "update" ? "Save changes" : "Create"))}
        </button>
      </div>
      <FormAlert tone="success" message={form.submitted ? successMessage : null} />
    </form>
  );
}
