"use client";
import"./chunks/index-kvbz0pj9.js";
import {
  createBrowserClient2
} from "./chunks/index-03nmywvj.js";
import {
  sanitizeRichText2
} from "./chunks/index-2p7b6gjp.js";
import {
  createAuth2
} from "./chunks/index-f3hk1tdw.js";
import {
  fieldLabel2,
  formFields2,
  columnFields2,
  inputValue2,
  validateRecord2,
  createForm2,
  formatValue2,
  pageInfo2,
  createCollection2,
  formatBytes2,
  createUpload2
} from "./chunks/index-dyakva2e.js";

// src/react/context.tsx
import { createContext, useContext, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
var BakorinContext = createContext(null);
function BakorinProvider({ children, basePath = "/api/bakorin", client, initialUser, schema }) {
  const value = useMemo(() => {
    const resolved = client ?? createBrowserClient2({ basePath });
    return { client: resolved, auth: createAuth2(resolved, { initialUser }), schema, basePath };
  }, [client, basePath, schema]);
  return /* @__PURE__ */ jsx(BakorinContext.Provider, {
    value,
    children
  });
}
function useBakorin() {
  const value = useContext(BakorinContext);
  if (!value) {
    throw new Error("Bakorin components need a <BakorinProvider> above them.");
  }
  return value;
}
// src/react/hooks.ts
import { useCallback, useEffect, useMemo as useMemo2, useRef, useState, useSyncExternalStore } from "react";
function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
function useAuth() {
  const { auth } = useBakorin();
  const state = useStore(auth.store);
  useEffect(() => {
    if (auth.store.get().status === "loading") {
      auth.refresh();
    }
  }, [auth]);
  return {
    ...state,
    signIn: auth.signIn,
    signUp: auth.signUp,
    signOut: auth.signOut,
    forgotPassword: auth.forgotPassword,
    resetPassword: auth.resetPassword,
    refresh: auth.refresh
  };
}
function useCollection(entity, options = {}) {
  const { client } = useBakorin();
  const filterKey = JSON.stringify(options.filter ?? null);
  const controller = useMemo2(() => createCollection2(client, entity, options), [client, entity, options.limit, options.sort, filterKey, options.expand]);
  const state = useStore(controller.store);
  useEffect(() => {
    if (!options.initial) {
      controller.load();
    }
  }, [controller]);
  useEffect(() => options.live ? controller.live() : undefined, [controller, options.live]);
  return {
    ...state,
    page: pageInfo2(state),
    load: controller.load,
    setPage: controller.setPage,
    next: controller.next,
    previous: controller.previous,
    setSort: controller.setSort,
    setFilter: controller.setFilter,
    create: controller.create,
    update: controller.update,
    remove: controller.remove
  };
}
function useLiveList(entity, options = {}) {
  return useCollection(entity, { ...options, live: true });
}
function useUpload(options = {}) {
  const { basePath } = useBakorin();
  const optionsKey = JSON.stringify(options);
  const controller = useMemo2(() => createUpload2({ basePath, ...options }), [basePath, optionsKey]);
  useEffect(() => () => controller.cancel(), [controller]);
  const state = useStore(controller.store);
  return { ...state, upload: controller.upload, cancel: controller.cancel, reset: controller.reset };
}
function useRecordForm(options) {
  const { client, schema } = useBakorin();
  const entitySchema = typeof options.entity === "string" ? schema?.entities[options.entity] : options.entity;
  const entityName = typeof options.entity === "string" ? options.entity : options.entity.name;
  const fields = useMemo2(() => options.fields ?? (entitySchema ? formFields2(entitySchema, { mode: options.record ? "update" : "create", isAdmin: options.isAdmin, include: options.include, exclude: options.exclude }) : []), [entitySchema, options.fields, Boolean(options.record), options.isAdmin, String(options.include), String(options.exclude)]);
  const latest = useRef(options);
  latest.current = options;
  const recordId = options.record?.id;
  const form = useMemo2(() => createForm2({
    fields,
    initial: latest.current.record,
    submit: (values, mode) => {
      if (latest.current.submit) {
        return latest.current.submit(values, mode);
      }
      const api = client.entity(entityName);
      return mode === "update" ? api.update(String(recordId), values) : api.create(values);
    },
    onSuccess: (record) => latest.current.onSuccess?.(record)
  }), [client, entityName, fields, recordId]);
  const state = useStore(form.store);
  return { ...state, fields, mode: form.mode, store: form.store, setValue: form.setValue, submit: form.submit, reset: form.reset, validate: form.validate };
}
function useRelationOptions(field, enabled = true) {
  const { client, schema } = useBakorin();
  const [options, setOptions] = useState(null);
  const to = field?.relation?.to;
  const display = to ? schema?.entities[to]?.display : undefined;
  const load = useCallback(async () => {
    if (!to || !enabled) {
      return;
    }
    try {
      const result = await client.entity(to).list({ limit: 100, sort: display });
      setOptions(result.data.map((row) => ({ value: String(row.id), label: String(row[display ?? "id"] ?? row.id) })));
    } catch {
      setOptions(null);
    }
  }, [client, to, display, enabled]);
  useEffect(() => {
    load();
  }, [load]);
  return options;
}
// src/react/field.tsx
import { useId } from "react";
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function cx(...names) {
  return names.filter(Boolean).join(" ");
}
var INPUT_TYPES = {
  email: "email",
  password: "password",
  number: "number",
  integer: "number",
  date: "date",
  datetime: "datetime-local"
};
function Field({ field, value, error, label, hint, onChange, options, autoComplete, disabled, children }) {
  const id = useId();
  const inputId = `${id}-input`;
  const hintId = hint || field.description ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const text = label ?? fieldLabel2(field.name);
  const common = {
    id: inputId,
    name: field.name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    disabled
  };
  let control;
  if (children) {
    control = children({ inputId, describedBy });
  } else if (field.type === "boolean") {
    control = /* @__PURE__ */ jsx2("input", {
      ...common,
      className: "bk-checkbox",
      type: "checkbox",
      checked: value === true,
      onChange: (event) => onChange(event.currentTarget.checked)
    });
  } else if (field.type === "enum" || field.relation && options) {
    const choices = field.type === "enum" ? (field.enumValues ?? []).map((item) => ({ value: item, label: item })) : options ?? [];
    const many = Boolean(field.relation?.many);
    control = /* @__PURE__ */ jsxs("select", {
      ...common,
      className: "bk-input bk-select",
      required: field.required,
      multiple: many,
      value: many ? value ?? [] : inputValue2(field, value),
      onChange: (event) => onChange(many ? Array.from(event.currentTarget.selectedOptions, (option) => option.value) : event.currentTarget.value),
      children: [
        !many && /* @__PURE__ */ jsx2("option", {
          value: "",
          children: field.required ? "Choose one" : "None"
        }),
        choices.map((choice) => /* @__PURE__ */ jsx2("option", {
          value: choice.value,
          children: choice.label
        }, choice.value))
      ]
    });
  } else if (field.multiline && field.type === "text" || field.type === "json" || field.type === "richtext") {
    control = /* @__PURE__ */ jsx2("textarea", {
      ...common,
      className: cx("bk-input bk-textarea", field.type === "json" && "bk-textarea--code"),
      spellCheck: field.type === "json" ? false : undefined,
      rows: 6,
      required: field.required && field.defaultValue === undefined,
      value: inputValue2(field, value),
      onChange: (event) => onChange(event.currentTarget.value)
    });
  } else {
    control = /* @__PURE__ */ jsx2("input", {
      ...common,
      className: "bk-input",
      type: INPUT_TYPES[field.type] ?? "text",
      step: field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined,
      required: field.required && field.defaultValue === undefined,
      autoComplete: autoComplete ?? (field.type === "password" ? "new-password" : field.type === "email" ? "email" : undefined),
      value: inputValue2(field, value),
      onChange: (event) => onChange(event.currentTarget.value)
    });
  }
  const boolean = field.type === "boolean";
  return /* @__PURE__ */ jsxs("div", {
    className: cx("bk-field", boolean && "bk-field--check", error && "bk-field--invalid"),
    "data-field": field.name,
    children: [
      boolean && control,
      /* @__PURE__ */ jsxs("label", {
        className: "bk-label",
        htmlFor: inputId,
        children: [
          text,
          field.required && !boolean && /* @__PURE__ */ jsxs("span", {
            className: "bk-required",
            "aria-hidden": "true",
            children: [
              " ",
              "*"
            ]
          })
        ]
      }),
      !boolean && control,
      hintId && /* @__PURE__ */ jsx2("p", {
        className: "bk-hint",
        id: hintId,
        children: hint ?? field.description
      }),
      errorId && /* @__PURE__ */ jsx2("p", {
        className: "bk-error",
        id: errorId,
        children: error
      })
    ]
  });
}
function FormAlert({ message, tone = "error" }) {
  return /* @__PURE__ */ jsx2("div", {
    className: cx("bk-alert", message && `bk-alert--${tone}`),
    role: tone === "error" ? "alert" : "status",
    children: message ?? ""
  });
}
// src/react/richtext.tsx
import { createElement } from "react";
function RichText({ html, as = "div", className }) {
  return createElement(as, {
    className: className ? `bk-richtext ${className}` : "bk-richtext",
    dangerouslySetInnerHTML: { __html: sanitizeRichText2(html ?? "") }
  });
}
// src/react/auth.tsx
import { useEffect as useEffect2, useId as useId2, useRef as useRef2, useState as useState2 } from "react";
import { jsx as jsx3, jsxs as jsxs2, Fragment } from "react/jsx-runtime";
function go(href) {
  if (typeof location === "undefined") {
    return;
  }
  if (href) {
    location.assign(href);
  }
}
function focusInvalid(form) {
  setTimeout(() => form.querySelector("[aria-invalid='true']")?.focus(), 0);
}
function afterSignOutNavigate(href) {
  if (typeof location === "undefined") {
    return;
  }
  if (href) {
    location.assign(href);
  } else {
    location.reload();
  }
}
var identity = (name) => ({ name, type: name === "email" ? "email" : "text", required: true });
var password = { name: "password", type: "password", required: true };
function SignInForm({
  redirectTo,
  onSuccess,
  identityField = "email",
  forgotPasswordHref,
  signUpHref,
  submitLabel = "Sign in",
  className,
  children
}) {
  const auth = useAuth();
  const [values, setValues] = useState2({ [identityField]: "", password: "" });
  const [errors, setErrors] = useState2({});
  const edit = (name, raw) => {
    setValues((v) => ({ ...v, [name]: raw }));
    setErrors((e) => {
      if (!(name in e))
        return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  };
  const fields = [identity(identityField), { ...password, minLength: 0 }];
  async function submit(event) {
    event.preventDefault();
    const found = validateRecord2(fields, values);
    setErrors(found);
    if (Object.keys(found).length) {
      focusInvalid(event.currentTarget);
      return;
    }
    const user = await auth.signIn(values);
    if (user) {
      onSuccess?.(user);
      go(redirectTo);
    }
  }
  return /* @__PURE__ */ jsxs2("form", {
    method: "post",
    className: cx("bk-form", "bk-sign-in", className),
    onSubmit: submit,
    noValidate: true,
    "aria-busy": auth.pending || undefined,
    children: [
      /* @__PURE__ */ jsx3(FormAlert, {
        message: auth.error
      }),
      /* @__PURE__ */ jsx3(Field, {
        field: identity(identityField),
        value: values[identityField],
        error: errors[identityField],
        autoComplete: identityField === "email" ? "email" : "username",
        onChange: (raw) => edit(identityField, raw)
      }),
      /* @__PURE__ */ jsx3(Field, {
        field: password,
        value: values.password,
        error: errors.password,
        autoComplete: "current-password",
        onChange: (raw) => edit("password", raw)
      }),
      /* @__PURE__ */ jsx3("button", {
        className: "bk-button",
        type: "submit",
        disabled: auth.pending,
        children: auth.pending ? "Signing in..." : submitLabel
      }),
      (forgotPasswordHref || signUpHref) && /* @__PURE__ */ jsxs2("p", {
        className: "bk-links",
        children: [
          forgotPasswordHref && /* @__PURE__ */ jsx3("a", {
            href: forgotPasswordHref,
            children: "Forgot your password?"
          }),
          signUpHref && /* @__PURE__ */ jsx3("a", {
            href: signUpHref,
            children: "Create an account"
          })
        ]
      }),
      children
    ]
  });
}
function SignUpForm({ fields, include, signInHref, onSuccess, submitLabel = "Create account", className }) {
  const auth = useAuth();
  const { schema } = useBakorin();
  const authEntity = schema?.auth ? schema.entities[schema.auth.entity] : undefined;
  const shown = fields ?? (authEntity ? formFields2(authEntity, { mode: "create", include }) : [identity("email"), password, { name: "name", type: "text", required: true }]);
  const [values, setValues] = useState2({});
  const [errors, setErrors] = useState2({});
  const edit = (name, raw) => {
    setValues((v) => ({ ...v, [name]: raw }));
    setErrors((e) => {
      if (!(name in e))
        return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  };
  const [done, setDone] = useState2(null);
  async function submit(event) {
    event.preventDefault();
    const found = validateRecord2(shown, values);
    setErrors(found);
    if (Object.keys(found).length) {
      focusInvalid(event.currentTarget);
      return;
    }
    const result = await auth.signUp(values);
    if (result) {
      setDone(result.message);
      onSuccess?.(result.message);
    }
  }
  if (done) {
    return /* @__PURE__ */ jsxs2("div", {
      className: cx("bk-form", "bk-sign-up", className),
      children: [
        /* @__PURE__ */ jsx3(FormAlert, {
          tone: "success",
          message: done
        }),
        signInHref && /* @__PURE__ */ jsx3("p", {
          className: "bk-links",
          children: /* @__PURE__ */ jsx3("a", {
            href: signInHref,
            children: "Go to sign in"
          })
        })
      ]
    });
  }
  return /* @__PURE__ */ jsxs2("form", {
    method: "post",
    className: cx("bk-form", "bk-sign-up", className),
    onSubmit: submit,
    noValidate: true,
    "aria-busy": auth.pending || undefined,
    children: [
      /* @__PURE__ */ jsx3(FormAlert, {
        message: auth.error
      }),
      shown.map((field) => /* @__PURE__ */ jsx3(Field, {
        field,
        value: values[field.name],
        error: errors[field.name],
        hint: field.type === "password" ? "At least 8 characters." : undefined,
        onChange: (raw) => edit(field.name, raw)
      }, field.name)),
      /* @__PURE__ */ jsx3("button", {
        className: "bk-button",
        type: "submit",
        disabled: auth.pending,
        children: auth.pending ? "Creating account..." : submitLabel
      }),
      signInHref && /* @__PURE__ */ jsxs2("p", {
        className: "bk-links",
        children: [
          "Already have an account? ",
          /* @__PURE__ */ jsx3("a", {
            href: signInHref,
            children: "Sign in"
          })
        ]
      })
    ]
  });
}
function ForgotPasswordForm({ className, signInHref }) {
  const auth = useAuth();
  const [email, setEmail] = useState2("");
  const [error, setError] = useState2();
  const [sent, setSent] = useState2(false);
  const field = identity("email");
  async function submit(event) {
    event.preventDefault();
    const found = validateRecord2([field], { email });
    setError(found.email);
    if (!found.email && await auth.forgotPassword(email)) {
      setSent(true);
    }
  }
  return /* @__PURE__ */ jsxs2("form", {
    method: "post",
    className: cx("bk-form", "bk-forgot", className),
    onSubmit: submit,
    noValidate: true,
    children: [
      /* @__PURE__ */ jsx3(FormAlert, {
        message: auth.error
      }),
      /* @__PURE__ */ jsx3(FormAlert, {
        tone: "success",
        message: sent ? "If that email has an account, a reset link is on its way." : null
      }),
      /* @__PURE__ */ jsx3(Field, {
        field,
        value: email,
        error,
        onChange: (raw) => {
          setEmail(String(raw ?? ""));
          setError(undefined);
        }
      }),
      /* @__PURE__ */ jsx3("button", {
        className: "bk-button",
        type: "submit",
        disabled: auth.pending,
        children: "Send reset link"
      }),
      signInHref && /* @__PURE__ */ jsx3("p", {
        className: "bk-links",
        children: /* @__PURE__ */ jsx3("a", {
          href: signInHref,
          children: "Back to sign in"
        })
      })
    ]
  });
}
function ResetPasswordForm({ token, className, signInHref }) {
  const auth = useAuth();
  const [value, setValue] = useState2("");
  const [error, setError] = useState2();
  const [done, setDone] = useState2(false);
  const field = { ...password, name: "password" };
  async function submit(event) {
    event.preventDefault();
    const resolved = token ?? (typeof location !== "undefined" ? new URLSearchParams(location.search).get("token") : null);
    const found = validateRecord2([field], { password: value });
    setError(found.password ?? (resolved ? undefined : "This reset link is missing its token"));
    if (!found.password && resolved && await auth.resetPassword(resolved, value)) {
      setDone(true);
    }
  }
  return /* @__PURE__ */ jsxs2("form", {
    method: "post",
    className: cx("bk-form", "bk-reset", className),
    onSubmit: submit,
    noValidate: true,
    children: [
      /* @__PURE__ */ jsx3(FormAlert, {
        message: auth.error
      }),
      /* @__PURE__ */ jsx3(FormAlert, {
        tone: "success",
        message: done ? "Your password is changed. You can sign in now." : null
      }),
      /* @__PURE__ */ jsx3(Field, {
        field,
        label: "New password",
        value,
        error,
        hint: "At least 8 characters.",
        onChange: (raw) => {
          setValue(String(raw ?? ""));
          setError(undefined);
        }
      }),
      /* @__PURE__ */ jsx3("button", {
        className: "bk-button",
        type: "submit",
        disabled: auth.pending || done,
        children: "Set new password"
      }),
      signInHref && done && /* @__PURE__ */ jsx3("p", {
        className: "bk-links",
        children: /* @__PURE__ */ jsx3("a", {
          href: signInHref,
          children: "Sign in"
        })
      })
    ]
  });
}
function displayName(user) {
  if (!user) {
    return "";
  }
  return String(user.name ?? user.email ?? user.id ?? "Account");
}
function AuthButton({ signInHref = "/login", afterSignOut, className }) {
  const auth = useAuth();
  if (auth.status !== "signed-in") {
    return /* @__PURE__ */ jsx3("a", {
      className: cx("bk-button", "bk-button--secondary", className),
      href: signInHref,
      "aria-busy": auth.status === "loading" || undefined,
      children: "Sign in"
    });
  }
  return /* @__PURE__ */ jsx3("button", {
    className: cx("bk-button", "bk-button--secondary", className),
    type: "button",
    disabled: auth.pending,
    onClick: async () => {
      await auth.signOut();
      afterSignOutNavigate(afterSignOut);
    },
    children: "Sign out"
  });
}
function UserMenu({ links = [], signInHref = "/login", afterSignOut, className }) {
  const auth = useAuth();
  const [open, setOpen] = useState2(false);
  const id = useId2();
  const root = useRef2(null);
  const button = useRef2(null);
  useEffect2(() => {
    if (!open) {
      return;
    }
    const close = (event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target)) {
        setOpen(false);
        if (event instanceof KeyboardEvent) {
          button.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  if (auth.status !== "signed-in") {
    return /* @__PURE__ */ jsx3(AuthButton, {
      signInHref,
      className
    });
  }
  return /* @__PURE__ */ jsxs2("div", {
    className: cx("bk-user-menu", className),
    ref: root,
    children: [
      /* @__PURE__ */ jsxs2("button", {
        ref: button,
        className: "bk-user-menu__button",
        type: "button",
        "aria-expanded": open,
        "aria-controls": `${id}-menu`,
        onClick: () => setOpen(!open),
        children: [
          /* @__PURE__ */ jsx3("span", {
            className: "bk-avatar",
            "aria-hidden": "true",
            children: displayName(auth.user).charAt(0).toUpperCase()
          }),
          /* @__PURE__ */ jsx3("span", {
            className: "bk-user-menu__name",
            children: displayName(auth.user)
          })
        ]
      }),
      /* @__PURE__ */ jsxs2("div", {
        className: "bk-user-menu__panel",
        id: `${id}-menu`,
        hidden: !open,
        children: [
          typeof auth.user?.email === "string" && /* @__PURE__ */ jsx3("p", {
            className: "bk-user-menu__email",
            children: auth.user.email
          }),
          /* @__PURE__ */ jsxs2("ul", {
            className: "bk-user-menu__list",
            children: [
              links.map((link) => /* @__PURE__ */ jsx3("li", {
                children: /* @__PURE__ */ jsx3("a", {
                  href: link.href,
                  children: link.label
                })
              }, link.href)),
              /* @__PURE__ */ jsx3("li", {
                children: /* @__PURE__ */ jsx3("button", {
                  type: "button",
                  className: "bk-user-menu__signout",
                  onClick: async () => {
                    await auth.signOut();
                    afterSignOutNavigate(afterSignOut);
                  },
                  children: "Sign out"
                })
              })
            ]
          })
        ]
      })
    ]
  });
}
function Gate({ children, fallback = null, loading = null, roles, redirectTo }) {
  const auth = useAuth();
  const allowed = auth.status === "signed-in" && (!roles || roles.includes(String(auth.user?.role)));
  useEffect2(() => {
    if (auth.status === "signed-out" && redirectTo) {
      go(redirectTo);
    }
  }, [auth.status, redirectTo]);
  if (auth.status === "loading") {
    return /* @__PURE__ */ jsx3(Fragment, {
      children: loading
    });
  }
  return /* @__PURE__ */ jsx3(Fragment, {
    children: allowed ? children : fallback
  });
}
// src/react/data.tsx
import { useId as useId3 } from "react";
import { jsx as jsx4, jsxs as jsxs3, Fragment as Fragment2 } from "react/jsx-runtime";
var field = (row, name) => row[name];
function resolveColumns(schema, columns) {
  if (!columns) {
    return schema ? columnFields2(schema).map((meta) => ({ field: meta.name, meta, sortable: true })) : [{ field: "id" }];
  }
  return columns.map((column) => {
    const resolved = typeof column === "string" ? { field: column } : column;
    const meta = schema?.fields.find((field) => field.name === resolved.field);
    return { sortable: Boolean(meta), ...resolved, meta };
  });
}
function rowName(row, schema) {
  return String(field(row, schema?.display ?? "id") ?? field(row, "id") ?? "row");
}
function Pager({ collection, label }) {
  const { page, total } = collection;
  return /* @__PURE__ */ jsxs3("nav", {
    className: "bk-pager",
    "aria-label": `${label} pages`,
    children: [
      /* @__PURE__ */ jsx4("button", {
        className: "bk-button bk-button--secondary bk-button--small",
        type: "button",
        disabled: !page.hasPrevious || collection.loading,
        onClick: () => void collection.previous(),
        children: "Previous"
      }),
      /* @__PURE__ */ jsx4("span", {
        className: "bk-pager__status",
        "aria-live": "polite",
        children: total === 0 ? "No rows" : `${page.from} to ${page.to} of ${total}`
      }),
      /* @__PURE__ */ jsx4("button", {
        className: "bk-button bk-button--secondary bk-button--small",
        type: "button",
        disabled: !page.hasNext || collection.loading,
        onClick: () => void collection.next(),
        children: "Next"
      })
    ]
  });
}
function OwnCollection(props) {
  const collection = useCollection(props.entity, props);
  return /* @__PURE__ */ jsx4(Fragment2, {
    children: props.view(collection)
  });
}
function DataTable(props) {
  const view = (collection) => /* @__PURE__ */ jsx4(DataTableView, {
    ...props,
    collection
  });
  return props.collection ? view(props.collection) : /* @__PURE__ */ jsx4(OwnCollection, {
    ...props,
    view
  });
}
function DataTableView(props) {
  const { schema } = useBakorin();
  const entitySchema = schema?.entities[props.entity];
  const { collection } = props;
  const columns = resolveColumns(entitySchema, props.columns);
  const captionId = useId3();
  const caption = props.caption ?? fieldLabel2(props.entity);
  const confirmText = props.confirmDelete === undefined ? "Delete this row?" : props.confirmDelete;
  const sortDirection = (field) => collection.sort === field ? "ascending" : collection.sort === `-${field}` ? "descending" : undefined;
  return /* @__PURE__ */ jsxs3("div", {
    className: cx("bk-table-wrap", props.className),
    children: [
      /* @__PURE__ */ jsx4(FormAlert, {
        message: collection.error
      }),
      /* @__PURE__ */ jsxs3("table", {
        className: "bk-table",
        "aria-labelledby": captionId,
        "aria-busy": collection.loading || undefined,
        children: [
          /* @__PURE__ */ jsx4("caption", {
            id: captionId,
            className: cx("bk-table__caption", props.hideCaption && "bk-visually-hidden"),
            children: caption
          }),
          /* @__PURE__ */ jsx4("thead", {
            children: /* @__PURE__ */ jsxs3("tr", {
              children: [
                columns.map((column) => {
                  const label = column.label ?? fieldLabel2(column.field);
                  const direction = sortDirection(column.field);
                  return /* @__PURE__ */ jsx4("th", {
                    scope: "col",
                    "aria-sort": direction,
                    children: column.sortable ? /* @__PURE__ */ jsxs3("button", {
                      className: "bk-sort",
                      type: "button",
                      onClick: () => void collection.setSort(direction === "ascending" ? `-${column.field}` : column.field),
                      children: [
                        label,
                        /* @__PURE__ */ jsx4("span", {
                          className: "bk-sort__icon",
                          "aria-hidden": "true",
                          children: direction === "ascending" ? " ↑" : direction === "descending" ? " ↓" : ""
                        })
                      ]
                    }) : label
                  }, column.field);
                }),
                (props.deletable || props.actions) && /* @__PURE__ */ jsx4("th", {
                  scope: "col",
                  children: /* @__PURE__ */ jsx4("span", {
                    className: "bk-visually-hidden",
                    children: "Actions"
                  })
                })
              ]
            })
          }),
          /* @__PURE__ */ jsxs3("tbody", {
            children: [
              collection.items.length === 0 && !collection.loading && /* @__PURE__ */ jsx4("tr", {
                children: /* @__PURE__ */ jsx4("td", {
                  className: "bk-table__empty",
                  colSpan: columns.length + 1,
                  children: props.emptyText ?? "Nothing here yet."
                })
              }),
              collection.items.map((row) => {
                const id = String(field(row, "id"));
                const pending = id.startsWith("pending-");
                return /* @__PURE__ */ jsxs3("tr", {
                  className: pending ? "bk-row--pending" : undefined,
                  children: [
                    columns.map((column) => /* @__PURE__ */ jsx4("td", {
                      "data-label": column.label ?? fieldLabel2(column.field),
                      children: column.render ? column.render(row) : props.toggle?.includes(column.field) ? /* @__PURE__ */ jsx4("input", {
                        className: "bk-checkbox",
                        type: "checkbox",
                        checked: field(row, column.field) === true,
                        disabled: pending,
                        "aria-label": `${column.label ?? fieldLabel2(column.field)}: ${rowName(row, entitySchema)}`,
                        onChange: (event) => void collection.update(id, { [column.field]: event.currentTarget.checked }).catch(() => {
                          return;
                        })
                      }) : props.rowLink?.field === column.field && !pending ? /* @__PURE__ */ jsx4("a", {
                        href: props.rowLink.href.replace(":id", encodeURIComponent(id)),
                        children: formatValue2(column.meta, field(row, column.field))
                      }) : formatValue2(column.meta, field(row, column.field))
                    }, column.field)),
                    (props.deletable || props.actions) && /* @__PURE__ */ jsxs3("td", {
                      className: "bk-table__actions",
                      children: [
                        props.actions?.(row, collection),
                        props.deletable && /* @__PURE__ */ jsx4("button", {
                          className: "bk-button bk-button--danger bk-button--small",
                          type: "button",
                          disabled: pending,
                          "aria-label": `Delete ${rowName(row, entitySchema)}`,
                          onClick: () => {
                            if (!confirmText || confirm(confirmText)) {
                              collection.remove(id).catch(() => {
                                return;
                              });
                            }
                          },
                          children: "Delete"
                        })
                      ]
                    })
                  ]
                }, id);
              })
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsx4(Pager, {
        collection,
        label: caption
      })
    ]
  });
}
var LIVE_TEXT = { open: "Live", connecting: "Connecting", reconnecting: "Reconnecting", closed: "Offline", off: "Not live" };
function LiveList(props) {
  const view = (collection) => /* @__PURE__ */ jsx4(LiveListView, {
    ...props,
    collection
  });
  return props.collection ? view(props.collection) : /* @__PURE__ */ jsx4(OwnLive, {
    ...props,
    view
  });
}
function OwnLive(props) {
  const collection = useCollection(props.entity, { ...props, live: true });
  return /* @__PURE__ */ jsx4(Fragment2, {
    children: props.view(collection)
  });
}
function LiveListView(props) {
  const { schema } = useBakorin();
  const display = schema?.entities[props.entity]?.display ?? "id";
  const { collection } = props;
  const label = props.label ?? fieldLabel2(props.entity);
  return /* @__PURE__ */ jsxs3("section", {
    className: cx("bk-live-list", props.className),
    "aria-label": label,
    children: [
      /* @__PURE__ */ jsxs3("p", {
        className: cx("bk-live", `bk-live--${collection.live}`),
        role: "status",
        children: [
          /* @__PURE__ */ jsx4("span", {
            className: "bk-live__dot",
            "aria-hidden": "true"
          }),
          LIVE_TEXT[collection.live]
        ]
      }),
      /* @__PURE__ */ jsx4(FormAlert, {
        message: collection.error
      }),
      collection.items.length === 0 && !collection.loading ? /* @__PURE__ */ jsx4("p", {
        className: "bk-empty",
        children: props.emptyText ?? "Nothing here yet."
      }) : /* @__PURE__ */ jsx4("ul", {
        className: "bk-list",
        "aria-busy": collection.loading || undefined,
        children: collection.items.map((row) => /* @__PURE__ */ jsx4("li", {
          className: "bk-list__item",
          children: props.renderItem ? props.renderItem(row) : formatValue2(undefined, field(row, display))
        }, String(field(row, "id"))))
      })
    ]
  });
}
// src/react/record-form.tsx
import { useRef as useRef4 } from "react";

// src/react/upload.tsx
import { useId as useId4, useRef as useRef3, useState as useState3 } from "react";
import { jsx as jsx5, jsxs as jsxs4, Fragment as Fragment3 } from "react/jsx-runtime";
function FileUpload({ label = "Upload a file", accept, maxBytes, hint, onUploaded, name, className, inputId, describedBy }) {
  const upload = useUpload({ maxBytes, accept: accept?.split(",").map((part) => part.trim()).filter(Boolean) });
  const [dragging, setDragging] = useState3(false);
  const generated = useId4();
  const id = inputId ?? `${generated}-file`;
  const hintId = hint || maxBytes ? `${generated}-hint` : undefined;
  const input = useRef3(null);
  async function send(file) {
    if (!file) {
      return;
    }
    const stored = await upload.upload(file);
    if (stored) {
      onUploaded?.(stored);
    }
  }
  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files[0]);
  };
  return /* @__PURE__ */ jsxs4("div", {
    className: cx("bk-dropzone", dragging && "bk-dropzone--active", className),
    onDragOver: (event) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop,
    children: [
      /* @__PURE__ */ jsx5("input", {
        ref: input,
        id,
        className: "bk-dropzone__input",
        type: "file",
        accept,
        "aria-describedby": [describedBy, hintId].filter(Boolean).join(" ") || undefined,
        onChange: (event) => void send(event.currentTarget.files?.[0])
      }),
      /* @__PURE__ */ jsxs4("label", {
        className: "bk-dropzone__label",
        htmlFor: id,
        children: [
          /* @__PURE__ */ jsx5("span", {
            className: "bk-dropzone__title",
            children: inputId ? "Choose a file" : label
          }),
          /* @__PURE__ */ jsx5("span", {
            className: "bk-dropzone__subtitle",
            children: "or drop it here"
          })
        ]
      }),
      hintId && /* @__PURE__ */ jsx5("p", {
        className: "bk-hint",
        id: hintId,
        children: [hint, maxBytes ? `Up to ${formatBytes2(maxBytes)}.` : ""].filter(Boolean).join(" ")
      }),
      upload.status === "uploading" && /* @__PURE__ */ jsxs4("div", {
        className: "bk-progress-row",
        children: [
          /* @__PURE__ */ jsx5("progress", {
            className: "bk-progress",
            max: 100,
            value: Math.round(upload.progress * 100),
            "aria-label": "Upload progress"
          }),
          /* @__PURE__ */ jsxs4("span", {
            className: "bk-progress__text",
            "aria-hidden": "true",
            children: [
              Math.round(upload.progress * 100),
              "%"
            ]
          }),
          /* @__PURE__ */ jsx5("button", {
            className: "bk-button bk-button--small bk-button--secondary",
            type: "button",
            onClick: upload.cancel,
            children: "Cancel"
          })
        ]
      }),
      /* @__PURE__ */ jsx5("div", {
        role: "status",
        className: "bk-dropzone__status",
        children: upload.status === "done" && upload.file ? /* @__PURE__ */ jsxs4(Fragment3, {
          children: [
            "Uploaded",
            " ",
            /* @__PURE__ */ jsx5("a", {
              href: upload.file.url,
              target: "_blank",
              rel: "noreferrer",
              children: upload.file.filename
            }),
            " ",
            "(",
            formatBytes2(upload.file.size),
            ")"
          ]
        }) : ""
      }),
      /* @__PURE__ */ jsx5(FormAlert, {
        message: upload.error
      }),
      name && /* @__PURE__ */ jsx5("input", {
        type: "hidden",
        name,
        value: upload.file?.id ?? ""
      })
    ]
  });
}

// src/react/record-form.tsx
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
function RelationField(props) {
  const loaded = useRelationOptions(props.field, !props.options);
  return /* @__PURE__ */ jsx6(Field, {
    ...props,
    options: props.options ?? loaded
  });
}
function RecordForm(props) {
  const { submitLabel, resetOnCreate = true, successMessage = "Saved", labels, hints, relationOptions, className, collection, children } = props;
  const recordId = props.record?.id;
  const sent = useRef4(null);
  const form = useRecordForm({
    ...props,
    submit: props.submit ?? (collection ? (values, mode) => mode === "update" ? collection.update(String(recordId), values) : collection.create(values) : undefined),
    onSuccess: (record) => {
      if (resetOnCreate && !props.record && JSON.stringify(form.store.get().values) === sent.current) {
        form.reset();
        form.store.set((state) => ({ ...state, submitted: true }));
      }
      props.onSuccess?.(record);
    }
  });
  async function submit(event) {
    event.preventDefault();
    const element = event.currentTarget;
    sent.current = JSON.stringify(form.store.get().values);
    const result = await form.submit();
    if (result === undefined) {
      setTimeout(() => element.querySelector("[aria-invalid='true']")?.focus(), 0);
    }
  }
  return /* @__PURE__ */ jsxs5("form", {
    method: "post",
    className: cx("bk-form", "bk-record-form", className),
    onSubmit: submit,
    noValidate: true,
    "aria-busy": form.submitting || undefined,
    children: [
      /* @__PURE__ */ jsx6(FormAlert, {
        message: form.formError
      }),
      form.fields.map((field) => {
        const shared = {
          field: props.multiline?.includes(field.name) ? { ...field, multiline: true } : field,
          value: form.values[field.name],
          error: form.errors[field.name],
          label: labels?.[field.name],
          hint: hints?.[field.name],
          onChange: (raw) => form.setValue(field.name, raw)
        };
        if (field.relation) {
          return /* @__PURE__ */ jsx6(RelationField, {
            ...shared,
            options: relationOptions?.[field.name]
          }, field.name);
        }
        if (field.type === "file") {
          return /* @__PURE__ */ jsx6(Field, {
            ...shared,
            children: ({ inputId, describedBy }) => /* @__PURE__ */ jsx6(FileUpload, {
              inputId,
              describedBy,
              accept: props.accept?.[field.name],
              onUploaded: (file) => form.setValue(field.name, file.id)
            })
          }, field.name);
        }
        return /* @__PURE__ */ jsx6(Field, {
          ...shared
        }, field.name);
      }),
      children,
      /* @__PURE__ */ jsx6("div", {
        className: "bk-actions",
        children: /* @__PURE__ */ jsx6("button", {
          className: "bk-button",
          type: "submit",
          disabled: form.submitting,
          children: form.submitting ? "Saving..." : submitLabel ?? (form.mode === "update" ? "Save changes" : "Create")
        })
      }),
      /* @__PURE__ */ jsx6(FormAlert, {
        tone: "success",
        message: form.submitted ? successMessage : null
      })
    ]
  });
}
// src/react.ts
export {
  AuthButton,
  BakorinProvider,
  DataTable,
  Field,
  FileUpload,
  ForgotPasswordForm,
  FormAlert,
  Gate,
  LiveList,
  Pager,
  RecordForm,
  ResetPasswordForm,
  RichText,
  SignInForm,
  SignUpForm,
  UserMenu,
  useAuth,
  useBakorin,
  useCollection,
  useLiveList,
  useRecordForm,
  useRelationOptions,
  useStore,
  useUpload
};
