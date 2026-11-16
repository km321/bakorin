/**
 * Custom elements that make the Astro components interactive. They enhance the
 * server rendered markup, so forms still post and links still page without
 * JavaScript. Importing this module registers them once.
 *
 *   <script>import "@bakorin/sdk/elements";</script>
 */
import { createBrowserClient } from "../browser.ts";
import type { BakorinClient } from "../index.ts";
import { createCollection, type CollectionController } from "../headless/collection.ts";
import { coerceValue, fieldErrorsFrom, validateRecord, type FormValues } from "../headless/form.ts";
import type { FieldSchema } from "../headless/schema.ts";
import { createUpload } from "../headless/upload.ts";
import { formatBytes } from "../headless/upload.ts";
import { escapeHtml, renderListItems, renderLiveStatus, renderPager, renderTableBody, renderTableHead, type TableConfig } from "./render.ts";

// Lets this module load during server rendering (it only does work in the browser).
const Base: typeof HTMLElement = typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

function clientFor(element: HTMLElement): BakorinClient {
  return createBrowserClient({ basePath: element.dataset.basePath ?? "/api/bakorin" }) as BakorinClient;
}

function readJson<T>(element: HTMLElement, name: string): T | undefined {
  const script = element.querySelector<HTMLScriptElement>(`script[type="application/json"][data-bk="${name}"]`);
  return script ? (JSON.parse(script.textContent ?? "null") as T) : undefined;
}

function setAlert(root: Element, tone: "error" | "success", message: string | null) {
  const alert = root.querySelector<HTMLElement>(`[data-bk-alert="${tone}"]`);
  if (alert) {
    alert.textContent = message ?? "";
    alert.classList.toggle(`bk-alert--${tone}`, Boolean(message));
  }
}

function setFieldError(form: HTMLFormElement, name: string, message: string | undefined) {
  const wrap = form.querySelector<HTMLElement>(`.bk-field[data-field="${CSS.escape(name)}"]`);
  if (!wrap) {
    return;
  }
  const input = wrap.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
  const error = wrap.querySelector<HTMLElement>(".bk-error");
  wrap.classList.toggle("bk-field--invalid", Boolean(message));
  if (error) {
    error.textContent = message ?? "";
    error.hidden = !message;
  }
  if (input) {
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== error?.id);
    if (message && error) ids.push(error.id);
    if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
    else input.removeAttribute("aria-describedby");
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
}

function readValues(form: HTMLFormElement, fields: readonly FieldSchema[]): FormValues {
  const data = new FormData(form);
  const values: FormValues = {};
  for (const field of fields) {
    if (field.type === "boolean") {
      values[field.name] = coerceValue(field, data.get(field.name) === "true");
    } else if (field.relation?.many) {
      values[field.name] = coerceValue(field, data.getAll(field.name).map(String));
    } else {
      values[field.name] = coerceValue(field, data.get(field.name));
    }
  }
  return values;
}

function busy(form: HTMLFormElement, on: boolean, busyLabel: string) {
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  form.toggleAttribute("aria-busy", on);
  if (button) {
    button.disabled = on;
    button.textContent = on ? busyLabel : (button.dataset.label ?? button.textContent);
  }
}

function showErrors(form: HTMLFormElement, fields: readonly FieldSchema[], errors: Record<string, string>) {
  for (const field of fields) {
    setFieldError(form, field.name, errors[field.name]);
  }
  form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
}

/** Clears a field's message as soon as the person edits that field. */
function clearErrorsOnInput(form: HTMLFormElement) {
  const clear = (event: Event) => {
    const name = (event.target as HTMLInputElement | null)?.name;
    if (name && form.querySelector(`[name="${CSS.escape(name)}"][aria-invalid='true']`)) setFieldError(form, name, undefined);
  };
  form.addEventListener("input", clear);
  form.addEventListener("change", clear);
}

/**
 * <bakorin-auth-form data-mode="sign-in|sign-up|forgot|reset" data-redirect="/app">
 * wrapping a form rendered by SignInForm.astro and friends.
 */
export class BakorinAuthForm extends Base {
  connectedCallback() {
    const form = this.querySelector("form");
    const fields = readJson<FieldSchema[]>(this, "fields") ?? [];
    if (!form || this.dataset.ready) return;
    this.dataset.ready = "true";
    clearErrorsOnInput(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = readValues(form, fields);
      const errors = validateRecord(fields, values);
      showErrors(form, fields, errors);
      setAlert(form, "error", null);
      if (Object.keys(errors).length) return;
      const client = clientFor(this);
      const mode = this.dataset.mode ?? "sign-in";
      busy(form, true, mode === "sign-in" ? "Signing in..." : "Sending...");
      try {
        if (mode === "sign-in") {
          await client.login(values);
          location.assign(this.dataset.redirect ?? "/");
          return;
        }
        if (mode === "sign-up") {
          const result = await client.signup(values);
          form.querySelectorAll(".bk-field, .bk-actions").forEach((node) => node.remove());
          setAlert(form, "success", result.message);
        } else if (mode === "forgot") {
          await client.forgotPassword({ email: String(values.email ?? "") });
          setAlert(form, "success", "If that email has an account, a reset link is on its way.");
        } else if (mode === "reset") {
          const token = new URLSearchParams(location.search).get("token") ?? "";
          await client.resetPassword({ token, password: String(values.password ?? "") });
          setAlert(form, "success", "Your password is changed. You can sign in now.");
        }
      } catch (error) {
        const mapped = fieldErrorsFrom(error, fields.map((field) => field.name));
        showErrors(form, fields, mapped.fields);
        setAlert(form, "error", mapped.message ?? null);
      }
      busy(form, false, "");
    });
  }
}

/**
 * <bakorin-record-form data-entity="tasks" data-id="..."> around RecordForm.astro.
 * Sends every value on create and only changed values on update. Fires
 * bakorin:saved with the record in event.detail.
 */
export class BakorinRecordForm extends Base {
  connectedCallback() {
    const form = this.querySelector("form");
    const fields = readJson<FieldSchema[]>(this, "fields") ?? [];
    if (!form || this.dataset.ready) return;
    this.dataset.ready = "true";
    let initial = readValues(form, fields);
    clearErrorsOnInput(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = readValues(form, fields);
      const errors = validateRecord(fields, values, this.dataset.id ? "update" : "create");
      showErrors(form, fields, errors);
      setAlert(form, "error", null);
      setAlert(form, "success", null);
      if (Object.keys(errors).length) return;
      const api = clientFor(this).entity(this.dataset.entity ?? "");
      busy(form, true, "Saving...");
      try {
        let record: unknown;
        if (this.dataset.id) {
          const patch: FormValues = {};
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(initial[key] ?? null) !== JSON.stringify(value ?? null)) patch[key] = value;
          }
          record = await api.update(this.dataset.id, patch);
          initial = values;
        } else {
          const body: FormValues = {};
          for (const [key, value] of Object.entries(values)) if (value !== null) body[key] = value;
          const snapshot = JSON.stringify(values);
          record = await api.create(body);
          // Clear the form unless the person already started typing the next record.
          if (JSON.stringify(readValues(form, fields)) === snapshot) {
            form.reset();
            form.querySelectorAll<HTMLElement>("bakorin-file-upload").forEach((upload) => upload.dispatchEvent(new Event("bakorin:reset")));
          }
        }
        setAlert(form, "success", this.dataset.success ?? "Saved");
        this.dispatchEvent(new CustomEvent("bakorin:saved", { detail: record, bubbles: true }));
        if (this.dataset.redirect) location.assign(this.dataset.redirect);
      } catch (error) {
        const mapped = fieldErrorsFrom(error, fields.map((field) => field.name));
        showErrors(form, fields, mapped.fields);
        setAlert(form, "error", mapped.message ?? null);
      }
      busy(form, false, "");
    });
  }
}

/** <bakorin-data-table> around DataTable.astro: in place paging, sorting, toggles, delete, and live updates. */
export class BakorinDataTable extends Base {
  private collection?: CollectionController<Record<string, unknown>>;
  private stop: (() => void)[] = [];

  connectedCallback() {
    const config = readJson<TableConfig>(this, "config");
    const initial = readJson<{ data: Record<string, unknown>[]; meta: { total: number; limit: number; offset: number } }>(this, "initial");
    if (!config || this.collection) return;
    const collection = createCollection(clientFor(this), config.entity, {
      initial,
      sort: this.dataset.sort || undefined,
      filter: readJson(this, "filter"),
    });
    this.collection = collection;
    const render = () => {
      const state = collection.store.get();
      const focusKey = (document.activeElement as HTMLElement | null)?.closest("tr")?.dataset.id;
      const focusSelector = document.activeElement?.matches("[data-bk-toggle]") ? "[data-bk-toggle]" : null;
      const head = this.querySelector("thead");
      const body = this.querySelector("tbody");
      const pager = this.querySelector("[data-bk-pager]");
      if (head) head.innerHTML = renderTableHead(config, state);
      if (body) body.innerHTML = renderTableBody(config, state);
      if (pager) pager.innerHTML = renderPager(config, state);
      this.querySelector("table")?.toggleAttribute("aria-busy", state.loading);
      setAlert(this, "error", state.error);
      if (focusKey && focusSelector) {
        this.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(focusKey)}"] ${focusSelector}`)?.focus();
      }
    };
    this.stop.push(collection.store.subscribe(render));
    if (this.dataset.live === "true") this.stop.push(collection.live());
    this.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const page = target.closest<HTMLElement>("[data-bk-page]");
      const sort = target.closest<HTMLElement>("[data-bk-sort]");
      const remove = target.closest<HTMLElement>("[data-bk-delete]");
      if (page) {
        event.preventDefault();
        void collection.setPage(Number(page.dataset.bkPage));
      } else if (sort) {
        event.preventDefault();
        void collection.setSort(sort.dataset.bkSort);
      } else if (remove) {
        const id = remove.closest("tr")?.dataset.id;
        if (id && (!config.confirmDelete || confirm(config.confirmDelete))) {
          void collection.remove(id).catch(() => undefined);
        }
      }
    });
    this.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      const field = target.dataset.bkToggle;
      const id = target.closest("tr")?.dataset.id;
      if (field && id) {
        void collection.update(id, { [field]: target.checked }).catch(() => undefined);
      }
    });
    // A RecordForm on the same page: show the new row at once.
    const onSaved = (event: Event) => {
      const record = (event as CustomEvent).detail as Record<string, unknown> | undefined;
      const target = event.target as HTMLElement;
      if (record && target.dataset.entity === config.entity && !target.dataset.id) {
        collection.store.set((state) =>
          state.items.some((item) => item.id === record.id) || state.offset !== 0
            ? state
            : { ...state, items: [record, ...state.items].slice(0, state.limit), total: state.total + 1 },
        );
      }
    };
    document.addEventListener("bakorin:saved", onSaved);
    this.stop.push(() => document.removeEventListener("bakorin:saved", onSaved));
  }

  disconnectedCallback() {
    this.stop.forEach((stop) => stop());
    this.stop = [];
    this.collection = undefined;
  }
}

/** <bakorin-live-list> around LiveList.astro. */
export class BakorinLiveList extends Base {
  private stop: (() => void)[] = [];

  connectedCallback() {
    if (this.stop.length) return;
    const initial = readJson<{ data: Record<string, unknown>[]; meta: { total: number; limit: number; offset: number } }>(this, "initial");
    const collection = createCollection(clientFor(this), this.dataset.entity ?? "", { initial, sort: this.dataset.sort || undefined, limit: Number(this.dataset.limit ?? 20) });
    const list = this.querySelector(".bk-list");
    const status = this.querySelector(".bk-live");
    const display = this.dataset.display ?? "id";
    const empty = this.dataset.empty ?? "Nothing here yet.";
    this.stop.push(
      collection.store.subscribe((state) => {
        if (list) list.innerHTML = renderListItems(state.items, display, empty);
        if (status) {
          status.className = `bk-live bk-live--${state.live}`;
          status.innerHTML = renderLiveStatus(state.live);
        }
      }),
    );
    this.stop.push(collection.live());
    if (!initial) void collection.load();
  }

  disconnectedCallback() {
    this.stop.forEach((stop) => stop());
    this.stop = [];
  }
}

/** <bakorin-file-upload> around FileUpload.astro (or a file field in RecordForm.astro). Fires bakorin:uploaded. */
export class BakorinFileUpload extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = "true";
    const input = this.querySelector<HTMLInputElement>("input[type=file]");
    const hidden = this.querySelector<HTMLInputElement>("input[type=hidden]");
    const row = this.querySelector<HTMLElement>(".bk-progress-row");
    const bar = this.querySelector<HTMLProgressElement>("progress");
    const text = this.querySelector<HTMLElement>(".bk-progress__text");
    const status = this.querySelector<HTMLElement>(".bk-dropzone__status");
    const accept = this.dataset.accept?.split(",").map((part) => part.trim()).filter(Boolean);
    const maxBytes = this.dataset.maxBytes ? Number(this.dataset.maxBytes) : undefined;
    const upload = createUpload({ basePath: this.dataset.basePath, accept, maxBytes });
    upload.store.subscribe((state) => {
      if (row) row.hidden = state.status !== "uploading";
      const percent = Math.round(state.progress * 100);
      if (bar) bar.value = percent;
      if (text) text.textContent = `${percent}%`;
      if (hidden) hidden.value = state.file?.id ?? "";
      if (status) {
        status.innerHTML =
          state.status === "done" && state.file
            ? `Uploaded <a href="${escapeHtml(state.file.url)}" target="_blank" rel="noreferrer">${escapeHtml(state.file.filename)}</a> (${formatBytes(state.file.size)})`
            : "";
      }
      setAlert(this, "error", state.error);
    });
    const send = async (file: File | undefined) => {
      if (!file) return;
      const stored = await upload.upload(file);
      if (stored) this.dispatchEvent(new CustomEvent("bakorin:uploaded", { detail: stored, bubbles: true }));
    };
    input?.addEventListener("change", () => void send(input.files?.[0]));
    this.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.classList.add("bk-dropzone--active");
    });
    this.addEventListener("dragleave", () => this.classList.remove("bk-dropzone--active"));
    this.addEventListener("drop", (event) => {
      event.preventDefault();
      this.classList.remove("bk-dropzone--active");
      void send(event.dataTransfer?.files[0]);
    });
    this.addEventListener("bakorin:reset", () => upload.reset());
  }
}

const ELEMENTS: [string, CustomElementConstructor][] = [
  ["bakorin-auth-form", BakorinAuthForm],
  ["bakorin-record-form", BakorinRecordForm],
  ["bakorin-data-table", BakorinDataTable],
  ["bakorin-live-list", BakorinLiveList],
  ["bakorin-file-upload", BakorinFileUpload],
];

/** Registers the elements. Safe to call more than once. */
export function defineBakorinElements(): void {
  if (typeof customElements === "undefined") return;
  for (const [name, element] of ELEMENTS) {
    if (!customElements.get(name)) customElements.define(name, element);
  }
}

defineBakorinElements();
