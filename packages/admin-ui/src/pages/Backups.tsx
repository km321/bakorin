import { useEffect, useState } from "preact/hooks";
import { createBackup, downloadBackup, listBackups, type BackupRecord } from "../lib/api.ts";
import { formatDateTime, formatSize } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";

export function Backups() {
  const [rows, setRows] = useState<BackupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function onDownload(id: string) {
    setDownloading(id);
    setError(null);
    try {
      await downloadBackup(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "download failed");
    } finally {
      setDownloading(null);
    }
  }

  async function refresh() {
    setError(null);
    const data = await listBackups();
    setRows(data);
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load backups"))
      .finally(() => setLoading(false));
  }, []);

  async function runLiveBackup() {
    setBusy(true);
    setError(null);
    try {
      await createBackup();
      await refresh();
      pushToast("ok", "Backup saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "backup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Backups</h1>
          <div class="muted">
            Snapshot the live database and files. Download one to keep a copy off the server, then restore it with{" "}
            <span class="mono">bakorin restore file.tar.gz</span>
          </div>
        </div>
        <button class="btn" id="bakorin-backup-now" disabled={busy} onClick={() => void runLiveBackup()}>
          {busy ? "Backing up" : "Run backup"}
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}
      <div class="table-wrap">
        {loading ? (
          <div class="skeleton" aria-hidden="true">
            <div class="skeleton-row" />
            <div class="skeleton-row" />
          </div>
        ) : rows.length === 0 ? (
          <div class="empty">
            <h2>No backups yet</h2>
            <p>Run a live backup to snapshot the database.</p>
            <button class="btn" type="button" disabled={busy} onClick={() => void runLiveBackup()}>
              Run backup
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Taken</th>
                <th>Size</th>
                <th>Location</th>
                <th>Restore (CLI only)</th>
                <th>
                  <span class="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{formatSize(row.size)}</td>
                  <td class="mono">{row.location}</td>
                  <td>
                    <pre class="restore-cmd">{row.restoreCommand}</pre>
                  </td>
                  <td>
                    <button
                      class="btn secondary"
                      type="button"
                      data-download={row.id}
                      disabled={downloading === row.id}
                      aria-label={`Download backup from ${formatDateTime(row.createdAt)}`}
                      onClick={() => void onDownload(row.id)}
                    >
                      {downloading === row.id ? "Preparing" : "Download"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
