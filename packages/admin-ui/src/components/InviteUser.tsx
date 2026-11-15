import { useState } from "preact/hooks";
import type { MetaResponse } from "../lib/api.ts";
import { inviteUser } from "../lib/api.ts";

interface Props {
  meta: MetaResponse;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteUser({ meta, onClose, onInvited }: Props) {
  const roles = meta.auth.roles ?? [meta.auth.adminRole, "user"];
  const defaultRole = roles.find((role) => role !== meta.auth.adminRole) ?? roles[0] ?? "user";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: Event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await inviteUser({ email, name: name || undefined, role });
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "invite failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <form class="drawer" onSubmit={submit}>
        <h2>Invite user</h2>
        {error ? <div class="banner">{error}</div> : null}
        <div class="field">
          <label>Email *</label>
          <input type="email" required value={email} onInput={(event) => setEmail((event.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label>Name</label>
          <input type="text" value={name} onInput={(event) => setName((event.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label>Role</label>
          <select value={role} onChange={(event) => setRole((event.target as HTMLSelectElement).value)}>
            {roles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button class="btn" disabled={saving} type="submit">
            {saving ? "Sending…" : "Send invite"}
          </button>
          <button class="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
