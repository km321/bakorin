import { useEffect, useRef, useState } from "preact/hooks";
import { signFile, uploadFile, type FileDetails } from "../lib/api.ts";
import { fileKind, formatSize, isPreviewImage } from "../lib/format.ts";
import { fieldLabel } from "../lib/label.ts";

interface Props {
  name: string;
  value: unknown;
  /** The value the record had when the form opened, to say what Save will change. */
  saved: unknown;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string | null) => void;
}

type State =
  | { kind: "empty" }
  | { kind: "loading"; id: string }
  | { kind: "ready"; file: FileDetails }
  | { kind: "missing"; id: string; message: string };

/** Opens a signed link, asking for a fresh one when the old one has expired. */
async function openLink(file: FileDetails, download: boolean, refresh: (next: FileDetails) => void): Promise<void> {
  let current = file;
  if (current.expiresAt * 1000 < Date.now() + 5000) {
    current = await signFile(file.id);
    refresh(current);
  }
  const link = document.createElement("a");
  link.href = download ? current.downloadUrl : current.url;
  if (download) {
    link.download = current.filename;
  } else {
    link.target = "_blank";
    link.rel = "noopener";
  }
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * The file field in the record editor: shows the file the record already has
 * (thumbnail or type, name, size) with Open, Download, Replace and Remove, and
 * uploads a new one. The upload is saved to the record when the form is saved.
 */
export function FileField({ name, value, saved, invalid, describedBy, onChange }: Props) {
  const [state, setState] = useState<State>({ kind: "empty" });
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Map<string, FileDetails>());
  const inputRef = useRef<HTMLInputElement>(null);
  const id = typeof value === "string" && value !== "" ? value : null;

  useEffect(() => {
    if (!id) {
      setState({ kind: "empty" });
      return;
    }
    const cached = known.current.get(id);
    if (cached) {
      setState({ kind: "ready", file: cached });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading", id });
    void signFile(id)
      .then((file) => {
        if (cancelled) return;
        known.current.set(id, file);
        setState({ kind: "ready", file });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: "missing", id, message: err instanceof Error ? err.message : "could not load file" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onPick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }
    setError(null);
    setUploading(file.name);
    try {
      const uploaded = await uploadFile(file);
      known.current.set(uploaded.id, uploaded);
      onChange(uploaded.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(null);
    }
  }

  const refresh = (next: FileDetails) => {
    known.current.set(next.id, next);
    setState({ kind: "ready", file: next });
  };
  const savedId = typeof saved === "string" && saved !== "" ? saved : null;
  const pending = id !== savedId ? (id ? "New file, saved to the record when you click Save." : "Removed, takes effect when you click Save.") : null;
  const label = fieldLabel(name);

  const picker = (
    <input
      ref={inputRef}
      id={name}
      class={state.kind === "empty" ? "file-input" : "sr-only"}
      type="file"
      name={name}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      disabled={Boolean(uploading)}
      onChange={(event) => void onPick(event)}
    />
  );

  return (
    <div class="file-field" data-file-field={name}>
      {state.kind === "loading" ? (
        <div class="file-card" aria-busy="true">
          <div class="file-thumb skeleton-thumb" />
          <span class="muted">Loading file</span>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <div class="file-card" data-file-id={state.file.id}>
          {isPreviewImage(state.file.contentType) ? (
            <img class="file-thumb" src={state.file.url} alt={`Preview of ${state.file.filename}`} />
          ) : (
            <span class="file-thumb file-kind" aria-hidden="true">
              {fileKind(state.file.contentType)}
            </span>
          )}
          <div class="file-meta">
            <span class="file-name" title={state.file.filename}>
              {state.file.filename}
            </span>
            <span class="muted small">
              {fileKind(state.file.contentType)}, {formatSize(state.file.size)}
            </span>
          </div>
          <div class="file-actions">
            <button
              type="button"
              class="btn secondary small"
              aria-label={`Open ${state.file.filename}`}
              onClick={() => void openLink(state.file, false, refresh).catch((err: unknown) => setError(String(err)))}
            >
              Open
            </button>
            <button
              type="button"
              class="btn secondary small"
              aria-label={`Download ${state.file.filename}`}
              onClick={() => void openLink(state.file, true, refresh).catch((err: unknown) => setError(String(err)))}
            >
              Download
            </button>
            <button
              type="button"
              class="btn secondary small"
              aria-label={`Replace ${label}`}
              disabled={Boolean(uploading)}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </button>
            <button type="button" class="btn danger small" aria-label={`Remove ${label}`} onClick={() => onChange(null)}>
              Remove
            </button>
          </div>
        </div>
      ) : null}
      {state.kind === "missing" ? (
        <div class="file-card missing" role="status">
          <span class="file-thumb file-kind" aria-hidden="true">
            ?
          </span>
          <div class="file-meta">
            <span class="file-name">File not found</span>
            <span class="muted small">{state.message}. Upload a new file or remove this one.</span>
          </div>
          <div class="file-actions">
            <button type="button" class="btn secondary small" onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button type="button" class="btn danger small" aria-label={`Remove ${label}`} onClick={() => onChange(null)}>
              Remove
            </button>
          </div>
        </div>
      ) : null}
      {picker}
      {uploading ? (
        <p class="field-hint" role="status">
          Uploading {uploading}
        </p>
      ) : null}
      {pending && !uploading ? (
        <p class="field-hint" data-file-pending>
          {pending}
        </p>
      ) : null}
      {error ? (
        <p class="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
