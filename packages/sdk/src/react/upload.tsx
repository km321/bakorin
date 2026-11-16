/** @jsxImportSource react */
import { useId, useRef, useState, type DragEvent } from "react";
import type { UploadedFile } from "../index.ts";
import { formatBytes } from "../headless/upload.ts";
import { FormAlert, cx } from "./field.tsx";
import { useUpload } from "./hooks.ts";

export interface FileUploadProps {
  label?: string;
  /** For example "image/*,application/pdf". Checked before upload; the server checks again. */
  accept?: string;
  maxBytes?: number;
  hint?: string;
  onUploaded?: (file: UploadedFile) => void;
  /** Name of a hidden input that holds the file id, for use inside a plain form. */
  name?: string;
  className?: string;
  /** Ids from a surrounding Field, so the label and error point here. */
  inputId?: string;
  describedBy?: string;
}

/** A drop zone that is also a normal file input, with progress and a link to the stored file. */
export function FileUpload({ label = "Upload a file", accept, maxBytes, hint, onUploaded, name, className, inputId, describedBy }: FileUploadProps) {
  const upload = useUpload({ maxBytes, accept: accept?.split(",").map((part) => part.trim()).filter(Boolean) });
  const [dragging, setDragging] = useState(false);
  const generated = useId();
  const id = inputId ?? `${generated}-file`;
  const hintId = hint || maxBytes ? `${generated}-hint` : undefined;
  const input = useRef<HTMLInputElement>(null);

  async function send(file: File | undefined) {
    if (!file) {
      return;
    }
    const stored = await upload.upload(file);
    if (stored) {
      onUploaded?.(stored);
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void send(event.dataTransfer.files[0]);
  };

  return (
    <div
      className={cx("bk-dropzone", dragging && "bk-dropzone--active", className)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={input}
        id={id}
        className="bk-dropzone__input"
        type="file"
        accept={accept}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(" ") || undefined}
        onChange={(event) => void send(event.currentTarget.files?.[0])}
      />
      <label className="bk-dropzone__label" htmlFor={id}>
        <span className="bk-dropzone__title">{inputId ? "Choose a file" : label}</span>
        <span className="bk-dropzone__subtitle">or drop it here</span>
      </label>
      {hintId && (
        <p className="bk-hint" id={hintId}>
          {[hint, maxBytes ? `Up to ${formatBytes(maxBytes)}.` : ""].filter(Boolean).join(" ")}
        </p>
      )}
      {upload.status === "uploading" && (
        <div className="bk-progress-row">
          <progress className="bk-progress" max={100} value={Math.round(upload.progress * 100)} aria-label="Upload progress" />
          <span className="bk-progress__text" aria-hidden="true">
            {Math.round(upload.progress * 100)}%
          </span>
          <button className="bk-button bk-button--small bk-button--secondary" type="button" onClick={upload.cancel}>
            Cancel
          </button>
        </div>
      )}
      <div role="status" className="bk-dropzone__status">
        {upload.status === "done" && upload.file ? (
          <>
            Uploaded{" "}
            <a href={upload.file.url} target="_blank" rel="noreferrer">
              {upload.file.filename}
            </a>{" "}
            ({formatBytes(upload.file.size)})
          </>
        ) : (
          ""
        )}
      </div>
      <FormAlert message={upload.error} />
      {name && <input type="hidden" name={name} value={upload.file?.id ?? ""} />}
    </div>
  );
}
