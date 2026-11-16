import { useEffect, useRef, useState } from "preact/hooks";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { IconSearch } from "../components/Icons.tsx";
import { deleteFile, deleteOrphanFiles, listFiles, signFile, type FileListMeta, type FileRow, type MetaResponse } from "../lib/api.ts";
import { fileKind, formatDateTime, formatSize, isPreviewImage } from "../lib/format.ts";
import { fieldLabel } from "../lib/label.ts";
import { pushToast } from "../lib/toast.ts";

const LIMIT = 25;

const SIZES: Record<string, { minSize?: number; maxSize?: number; label: string }> = {
  "": { label: "Any size" },
  small: { maxSize: 100 * 1024 - 1, label: "Under 100 KB" },
  medium: { minSize: 100 * 1024, maxSize: 1024 * 1024 - 1, label: "100 KB to 1 MB" },
  large: { minSize: 1024 * 1024, maxSize: 10 * 1024 * 1024 - 1, label: "1 MB to 10 MB" },
  huge: { minSize: 10 * 1024 * 1024, label: "10 MB or more" },
};

function isPdf(type: string): boolean {
  return type.split(";")[0]?.trim().toLowerCase() === "application/pdf";
}

/** The link to open a record's editor from anywhere in the admin. */
export function recordHref(entity: string, id: string): string {
  return `#record/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`;
}

async function fresh(file: FileRow): Promise<FileRow> {
  if (file.expiresAt * 1000 > Date.now() + 5000) {
    return file;
  }
  const signed = await signFile(file.id);
  return { ...file, url: signed.url, downloadUrl: signed.downloadUrl, expiresAt: signed.expiresAt };
}

function download(file: FileRow) {
  const link = document.createElement("a");
  link.href = file.downloadUrl;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function Preview({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div class="dialog-backdrop" onClick={onClose} />
      <div class="dialog file-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
        <div class="file-preview-head">
          <div>
            <h2 id="file-preview-title">{file.filename}</h2>
            <p class="muted small">
              {fileKind(file.contentType)}, {formatSize(file.size)}, uploaded {formatDateTime(file.createdAt)}
            </p>
          </div>
          <div class="row-actions">
            <button class="btn secondary" type="button" onClick={() => void fresh(file).then(download)}>
              Download
            </button>
            <button class="btn" type="button" ref={closeRef} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div class="file-preview-body">
          {isPreviewImage(file.contentType) ? (
            <img src={file.url} alt={`Preview of ${file.filename}`} />
          ) : isPdf(file.contentType) ? (
            <iframe src={file.url} title={`Preview of ${file.filename}`} />
          ) : (
            <p class="muted">No preview for this type. Download it to open it on your computer.</p>
          )}
        </div>
      </div>
    </>
  );
}

/** Every upload: search, filters, preview, download, the records using each file, and cleanup of unused files. */
export function Files({ meta }: { meta: MetaResponse | null }) {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [info, setInfo] = useState<FileListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [size, setSize] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<FileRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileRow | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  const entityLabel = (name: string) => meta?.entities.find((item) => item.name === name)?.label ?? name;

  async function refresh(nextOffset = offset) {
    const range = SIZES[size] ?? SIZES[""]!;
    const result = await listFiles({
      q,
      type,
      status,
      minSize: range.minSize,
      maxSize: range.maxSize,
      from,
      to,
      sort,
      limit: LIMIT,
      offset: nextOffset,
    });
    setRows(result.data);
    setInfo(result.meta);
    setError(null);
  }

  useEffect(() => {
    const handle = window.setTimeout(
      () => {
        void refresh()
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load files"))
          .finally(() => setLoading(false));
      },
      q ? 250 : 0,
    );
    return () => window.clearTimeout(handle);
  }, [q, type, status, size, from, to, sort, offset]);

  function resetPage<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setOffset(0);
    };
  }

  async function removeOne(file: FileRow) {
    setBusy(true);
    try {
      await deleteFile(file.id);
      pushToast("ok", `Deleted ${file.filename}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeUnused() {
    setBusy(true);
    try {
      const result = await deleteOrphanFiles();
      pushToast("ok", `Deleted ${result.deleted} unused ${result.deleted === 1 ? "file" : "files"} (${formatSize(result.deletedBytes)})`);
      setOffset(0);
      await refresh(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  const total = info?.total ?? 0;
  const filtered = Boolean(q || type || status || size || from || to);

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Files</h1>
          <div class="muted">
            {info
              ? `${info.files} ${info.files === 1 ? "file" : "files"}, ${formatSize(info.bytes)}. ${info.orphaned} not used by any record (${formatSize(info.orphanedBytes)}).`
              : "Every upload and the records that use it."}
          </div>
        </div>
        <button
          class="btn danger"
          type="button"
          id="bakorin-delete-unused"
          disabled={busy || !info || info.removable === 0}
          onClick={() => setConfirmBulk(true)}
        >
          Delete unused files{info && info.removable > 0 ? ` (${info.removable})` : ""}
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}
      <div class="filters files-filters">
        <label class="search-field">
          <span class="sr-only">Search by file name</span>
          <IconSearch />
          <input placeholder="Search by file name" value={q} onInput={(event) => resetPage(setQ)((event.target as HTMLInputElement).value)} />
        </label>
        <label>
          <span class="sr-only">Type</span>
          <select value={type} onChange={(event) => resetPage(setType)((event.target as HTMLSelectElement).value)}>
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="pdf">PDF</option>
            <option value="text">Text</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span class="sr-only">Used by</span>
          <select value={status} data-filter="status" onChange={(event) => resetPage(setStatus)((event.target as HTMLSelectElement).value)}>
            <option value="">Used and unused</option>
            <option value="used">Used by a record</option>
            <option value="orphaned">Not used by any record</option>
          </select>
        </label>
        <label>
          <span class="sr-only">Size</span>
          <select value={size} onChange={(event) => resetPage(setSize)((event.target as HTMLSelectElement).value)}>
            {Object.entries(SIZES).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label class="date-filter">
          <span class="muted small">From</span>
          <input type="date" value={from} onInput={(event) => resetPage(setFrom)((event.target as HTMLInputElement).value)} />
        </label>
        <label class="date-filter">
          <span class="muted small">To</span>
          <input type="date" value={to} onInput={(event) => resetPage(setTo)((event.target as HTMLInputElement).value)} />
        </label>
        <label>
          <span class="sr-only">Sort</span>
          <select value={sort} onChange={(event) => resetPage(setSort)((event.target as HTMLSelectElement).value)}>
            <option value="-createdAt">Newest first</option>
            <option value="createdAt">Oldest first</option>
            <option value="-size">Largest first</option>
            <option value="size">Smallest first</option>
            <option value="filename">Name A to Z</option>
          </select>
        </label>
      </div>
      <div class="table-wrap">
        {loading && rows.length === 0 ? (
          <div class="skeleton" aria-busy="true" aria-label="Loading">
            <div class="skeleton-row" />
            <div class="skeleton-row" />
            <div class="skeleton-row" />
          </div>
        ) : rows.length === 0 ? (
          <div class="empty">
            <h2>{filtered ? "No files match" : "No files yet"}</h2>
            <p>{filtered ? "Try a different search or filter." : "Files uploaded to a record show up here."}</p>
          </div>
        ) : (
          <table class="files-table">
            <thead>
              <tr>
                <th>
                  <span class="sr-only">Preview</span>
                </th>
                <th>File</th>
                <th>Used by</th>
                <th>Uploaded</th>
                <th>
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((file) => (
                <tr key={file.id} data-file={file.id}>
                  <td class="thumb-cell">
                    <button
                      type="button"
                      class="file-thumb-button"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={() => void fresh(file).then(setPreview)}
                    >
                      {isPreviewImage(file.contentType) ? (
                        <img class="file-thumb" src={file.url} alt="" />
                      ) : (
                        <span class="file-thumb file-kind">{fileKind(file.contentType)}</span>
                      )}
                    </button>
                  </td>
                  <td>
                    <div class="file-cell">
                      <span class="file-name" title={file.filename}>
                        {file.filename}
                      </span>
                      <span class="muted small">
                        {fileKind(file.contentType)}, {formatSize(file.size)}
                      </span>
                    </div>
                  </td>
                  <td class="used-cell">
                    {file.usedBy.length === 0 ? (
                      <span class={file.recent ? "badge status-pending" : "badge status-failed"}>
                        {file.recent ? "Not used yet, just uploaded" : "Not used"}
                      </span>
                    ) : (
                      <ul class="used-by">
                        {file.usedBy.map((use) => (
                          <li key={`${use.entity}:${use.id}:${use.field}`}>
                            {use.removed ? (
                              <span>
                                {entityLabel(use.entity)}: {use.label} <span class="muted small">(removed field {use.field})</span>
                              </span>
                            ) : (
                              <a href={recordHref(use.entity, use.id)}>
                                {entityLabel(use.entity)}: {use.label}
                              </a>
                            )}{" "}
                            {!use.removed ? <span class="muted small">{fieldLabel(use.field)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{formatDateTime(file.createdAt)}</td>
                  <td>
                    <div class="row-actions">
                      <button
                        class="btn secondary"
                        type="button"
                        aria-label={`Preview ${file.filename}`}
                        onClick={() => void fresh(file).then(setPreview)}
                      >
                        Preview
                      </button>
                      <button
                        class="btn secondary"
                        type="button"
                        aria-label={`Download ${file.filename}`}
                        onClick={() => void fresh(file).then(download)}
                      >
                        Download
                      </button>
                      <button
                        class="btn danger"
                        type="button"
                        disabled={busy || !file.orphaned}
                        title={file.orphaned ? undefined : "Used by a record. Remove it from the record first."}
                        aria-label={`Delete ${file.filename}`}
                        onClick={() => setPendingDelete(file)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div class="pager">
        <button class="btn secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          Previous
        </button>
        <span>{total === 0 ? "0 of 0" : `${offset + 1}-${Math.min(offset + LIMIT, total)} of ${total}`}</span>
        <button class="btn secondary" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
          Next
        </button>
      </div>
      {preview ? <Preview file={preview} onClose={() => setPreview(null)} /> : null}
      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete ${pendingDelete.filename}?`}
          body="No record uses this file. It is removed from storage and the deletion is written to the audit log. This cannot be undone, except by restoring a backup."
          confirmLabel="Delete file"
          danger
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            const file = pendingDelete;
            setPendingDelete(null);
            void removeOne(file);
          }}
        />
      ) : null}
      {confirmBulk && info ? (
        <ConfirmDialog
          title={`Delete ${info.removable} unused ${info.removable === 1 ? "file" : "files"}?`}
          body={`These files are not used by any record. Uploads from the last ${info.graceMinutes} minutes are kept, in case a form is still open. Each deletion is written to the audit log. This cannot be undone, except by restoring a backup.`}
          confirmLabel="Delete unused files"
          danger
          onClose={() => setConfirmBulk(false)}
          onConfirm={() => {
            setConfirmBulk(false);
            void removeUnused();
          }}
        />
      ) : null}
    </>
  );
}
