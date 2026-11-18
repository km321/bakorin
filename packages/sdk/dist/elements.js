import"./chunks/index-kvbz0pj9.js";
import {
  createBrowserClient2
} from "./chunks/index-03nmywvj.js";
import"./chunks/index-2p7b6gjp.js";
import {
  escapeHtml2,
  renderTableBody2,
  renderTableHead2,
  renderPager2,
  renderLiveStatus2,
  renderListItems2
} from "./chunks/index-f24s06zt.js";
import {
  coerceValue2,
  validateRecord2,
  fieldErrorsFrom2,
  createCollection2,
  formatBytes2,
  createUpload2
} from "./chunks/index-dyakva2e.js";

// src/elements/index.ts
var Base = typeof HTMLElement === "undefined" ? class {
} : HTMLElement;
function clientFor(element) {
  return createBrowserClient2({ basePath: element.dataset.basePath ?? "/api/bakorin" });
}
function readJson(element, name) {
  const script = element.querySelector(`script[type="application/json"][data-bk="${name}"]`);
  return script ? JSON.parse(script.textContent ?? "null") : undefined;
}
function setAlert(root, tone, message) {
  const alert = root.querySelector(`[data-bk-alert="${tone}"]`);
  if (alert) {
    alert.textContent = message ?? "";
    alert.classList.toggle(`bk-alert--${tone}`, Boolean(message));
  }
}
function setFieldError(form, name, message) {
  const wrap = form.querySelector(`.bk-field[data-field="${CSS.escape(name)}"]`);
  if (!wrap) {
    return;
  }
  const input = wrap.querySelector("input:not([type=hidden]), select, textarea");
  const error = wrap.querySelector(".bk-error");
  wrap.classList.toggle("bk-field--invalid", Boolean(message));
  if (error) {
    error.textContent = message ?? "";
    error.hidden = !message;
  }
  if (input) {
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== error?.id);
    if (message && error)
      ids.push(error.id);
    if (ids.length)
      input.setAttribute("aria-describedby", ids.join(" "));
    else
      input.removeAttribute("aria-describedby");
    if (message)
      input.setAttribute("aria-invalid", "true");
    else
      input.removeAttribute("aria-invalid");
  }
}
function readValues(form, fields) {
  const data = new FormData(form);
  const values = {};
  for (const field of fields) {
    if (field.type === "boolean") {
      values[field.name] = coerceValue2(field, data.get(field.name) === "true");
    } else if (field.relation?.many) {
      values[field.name] = coerceValue2(field, data.getAll(field.name).map(String));
    } else {
      values[field.name] = coerceValue2(field, data.get(field.name));
    }
  }
  return values;
}
function busy(form, on, busyLabel) {
  const button = form.querySelector("button[type=submit]");
  form.toggleAttribute("aria-busy", on);
  if (button) {
    button.disabled = on;
    button.textContent = on ? busyLabel : button.dataset.label ?? button.textContent;
  }
}
function showErrors(form, fields, errors) {
  for (const field of fields) {
    setFieldError(form, field.name, errors[field.name]);
  }
  form.querySelector("[aria-invalid='true']")?.focus();
}
function clearErrorsOnInput(form) {
  const clear = (event) => {
    const name = event.target?.name;
    if (name && form.querySelector(`[name="${CSS.escape(name)}"][aria-invalid='true']`))
      setFieldError(form, name, undefined);
  };
  form.addEventListener("input", clear);
  form.addEventListener("change", clear);
}

class BakorinAuthForm extends Base {
  connectedCallback() {
    const form = this.querySelector("form");
    const fields = readJson(this, "fields") ?? [];
    if (!form || this.dataset.ready)
      return;
    this.dataset.ready = "true";
    clearErrorsOnInput(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = readValues(form, fields);
      const errors = validateRecord2(fields, values);
      showErrors(form, fields, errors);
      setAlert(form, "error", null);
      if (Object.keys(errors).length)
        return;
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
        const mapped = fieldErrorsFrom2(error, fields.map((field) => field.name));
        showErrors(form, fields, mapped.fields);
        setAlert(form, "error", mapped.message ?? null);
      }
      busy(form, false, "");
    });
  }
}

class BakorinRecordForm extends Base {
  connectedCallback() {
    const form = this.querySelector("form");
    const fields = readJson(this, "fields") ?? [];
    if (!form || this.dataset.ready)
      return;
    this.dataset.ready = "true";
    let initial = readValues(form, fields);
    clearErrorsOnInput(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = readValues(form, fields);
      const errors = validateRecord2(fields, values, this.dataset.id ? "update" : "create");
      showErrors(form, fields, errors);
      setAlert(form, "error", null);
      setAlert(form, "success", null);
      if (Object.keys(errors).length)
        return;
      const api = clientFor(this).entity(this.dataset.entity ?? "");
      busy(form, true, "Saving...");
      try {
        let record;
        if (this.dataset.id) {
          const patch = {};
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(initial[key] ?? null) !== JSON.stringify(value ?? null))
              patch[key] = value;
          }
          record = await api.update(this.dataset.id, patch);
          initial = values;
        } else {
          const body = {};
          for (const [key, value] of Object.entries(values))
            if (value !== null)
              body[key] = value;
          const snapshot = JSON.stringify(values);
          record = await api.create(body);
          if (JSON.stringify(readValues(form, fields)) === snapshot) {
            form.reset();
            form.querySelectorAll("bakorin-file-upload").forEach((upload) => upload.dispatchEvent(new Event("bakorin:reset")));
          }
        }
        setAlert(form, "success", this.dataset.success ?? "Saved");
        this.dispatchEvent(new CustomEvent("bakorin:saved", { detail: record, bubbles: true }));
        if (this.dataset.redirect)
          location.assign(this.dataset.redirect);
      } catch (error) {
        const mapped = fieldErrorsFrom2(error, fields.map((field) => field.name));
        showErrors(form, fields, mapped.fields);
        setAlert(form, "error", mapped.message ?? null);
      }
      busy(form, false, "");
    });
  }
}

class BakorinDataTable extends Base {
  collection;
  stop = [];
  connectedCallback() {
    const config = readJson(this, "config");
    const initial = readJson(this, "initial");
    if (!config || this.collection)
      return;
    const collection = createCollection2(clientFor(this), config.entity, {
      initial,
      sort: this.dataset.sort || undefined,
      filter: readJson(this, "filter")
    });
    this.collection = collection;
    const render = () => {
      const state = collection.store.get();
      const focusKey = document.activeElement?.closest("tr")?.dataset.id;
      const focusSelector = document.activeElement?.matches("[data-bk-toggle]") ? "[data-bk-toggle]" : null;
      const head = this.querySelector("thead");
      const body = this.querySelector("tbody");
      const pager = this.querySelector("[data-bk-pager]");
      if (head)
        head.innerHTML = renderTableHead2(config, state);
      if (body)
        body.innerHTML = renderTableBody2(config, state);
      if (pager)
        pager.innerHTML = renderPager2(config, state);
      this.querySelector("table")?.toggleAttribute("aria-busy", state.loading);
      setAlert(this, "error", state.error);
      if (focusKey && focusSelector) {
        this.querySelector(`tr[data-id="${CSS.escape(focusKey)}"] ${focusSelector}`)?.focus();
      }
    };
    this.stop.push(collection.store.subscribe(render));
    if (this.dataset.live === "true")
      this.stop.push(collection.live());
    this.addEventListener("click", (event) => {
      const target = event.target;
      const page = target.closest("[data-bk-page]");
      const sort = target.closest("[data-bk-sort]");
      const remove = target.closest("[data-bk-delete]");
      if (page) {
        event.preventDefault();
        collection.setPage(Number(page.dataset.bkPage));
      } else if (sort) {
        event.preventDefault();
        collection.setSort(sort.dataset.bkSort);
      } else if (remove) {
        const id = remove.closest("tr")?.dataset.id;
        if (id && (!config.confirmDelete || confirm(config.confirmDelete))) {
          collection.remove(id).catch(() => {
            return;
          });
        }
      }
    });
    this.addEventListener("change", (event) => {
      const target = event.target;
      const field = target.dataset.bkToggle;
      const id = target.closest("tr")?.dataset.id;
      if (field && id) {
        collection.update(id, { [field]: target.checked }).catch(() => {
          return;
        });
      }
    });
    const onSaved = (event) => {
      const record = event.detail;
      const target = event.target;
      if (record && target.dataset.entity === config.entity && !target.dataset.id) {
        collection.store.set((state) => state.items.some((item) => item.id === record.id) || state.offset !== 0 ? state : { ...state, items: [record, ...state.items].slice(0, state.limit), total: state.total + 1 });
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

class BakorinLiveList extends Base {
  stop = [];
  connectedCallback() {
    if (this.stop.length)
      return;
    const initial = readJson(this, "initial");
    const collection = createCollection2(clientFor(this), this.dataset.entity ?? "", { initial, sort: this.dataset.sort || undefined, limit: Number(this.dataset.limit ?? 20) });
    const list = this.querySelector(".bk-list");
    const status = this.querySelector(".bk-live");
    const display = this.dataset.display ?? "id";
    const empty = this.dataset.empty ?? "Nothing here yet.";
    this.stop.push(collection.store.subscribe((state) => {
      if (list)
        list.innerHTML = renderListItems2(state.items, display, empty);
      if (status) {
        status.className = `bk-live bk-live--${state.live}`;
        status.innerHTML = renderLiveStatus2(state.live);
      }
    }));
    this.stop.push(collection.live());
    if (!initial)
      collection.load();
  }
  disconnectedCallback() {
    this.stop.forEach((stop) => stop());
    this.stop = [];
  }
}

class BakorinFileUpload extends Base {
  connectedCallback() {
    if (this.dataset.ready)
      return;
    this.dataset.ready = "true";
    const input = this.querySelector("input[type=file]");
    const hidden = this.querySelector("input[type=hidden]");
    const row = this.querySelector(".bk-progress-row");
    const bar = this.querySelector("progress");
    const text = this.querySelector(".bk-progress__text");
    const status = this.querySelector(".bk-dropzone__status");
    const accept = this.dataset.accept?.split(",").map((part) => part.trim()).filter(Boolean);
    const maxBytes = this.dataset.maxBytes ? Number(this.dataset.maxBytes) : undefined;
    const upload = createUpload2({ basePath: this.dataset.basePath, accept, maxBytes });
    upload.store.subscribe((state) => {
      if (row)
        row.hidden = state.status !== "uploading";
      const percent = Math.round(state.progress * 100);
      if (bar)
        bar.value = percent;
      if (text)
        text.textContent = `${percent}%`;
      if (hidden)
        hidden.value = state.file?.id ?? "";
      if (status) {
        status.innerHTML = state.status === "done" && state.file ? `Uploaded <a href="${escapeHtml2(state.file.url)}" target="_blank" rel="noreferrer">${escapeHtml2(state.file.filename)}</a> (${formatBytes2(state.file.size)})` : "";
      }
      setAlert(this, "error", state.error);
    });
    const send = async (file) => {
      if (!file)
        return;
      const stored = await upload.upload(file);
      if (stored)
        this.dispatchEvent(new CustomEvent("bakorin:uploaded", { detail: stored, bubbles: true }));
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
      send(event.dataTransfer?.files[0]);
    });
    this.addEventListener("bakorin:reset", () => upload.reset());
  }
}
var ELEMENTS = [
  ["bakorin-auth-form", BakorinAuthForm],
  ["bakorin-record-form", BakorinRecordForm],
  ["bakorin-data-table", BakorinDataTable],
  ["bakorin-live-list", BakorinLiveList],
  ["bakorin-file-upload", BakorinFileUpload]
];
function defineBakorinElements() {
  if (typeof customElements === "undefined")
    return;
  for (const [name, element] of ELEMENTS) {
    if (!customElements.get(name))
      customElements.define(name, element);
  }
}
defineBakorinElements();
export {
  BakorinAuthForm,
  BakorinDataTable,
  BakorinFileUpload,
  BakorinLiveList,
  BakorinRecordForm,
  defineBakorinElements
};
