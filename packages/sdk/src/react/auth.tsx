/** @jsxImportSource react */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { validateRecord, type FieldErrors } from "../headless/form.ts";
import { formFields, type FieldSchema } from "../headless/schema.ts";
import { useBakorin } from "./context.tsx";
import { Field, FormAlert, cx } from "./field.tsx";
import { useAuth } from "./hooks.ts";

type User = Record<string, unknown>;

function go(href: string | undefined) {
  if (typeof location === "undefined") {
    return;
  }
  if (href) {
    location.assign(href);
  }
}

/** Focus the first field with an error once React has rendered it. */
function focusInvalid(form: HTMLFormElement) {
  setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
}

function afterSignOutNavigate(href: string | undefined) {
  if (typeof location === "undefined") {
    return;
  }
  if (href) {
    location.assign(href);
  } else {
    location.reload();
  }
}

export interface SignInFormProps {
  /** Where to go after signing in. Leave out to stay and use onSuccess. */
  redirectTo?: string;
  onSuccess?: (user: User) => void;
  /** The auth identity field. Default email. */
  identityField?: string;
  forgotPasswordHref?: string;
  signUpHref?: string;
  submitLabel?: string;
  className?: string;
  /** Extra content under the button. */
  children?: ReactNode;
}

const identity = (name: string): FieldSchema => ({ name, type: name === "email" ? "email" : "text", required: true });
const password: FieldSchema = { name: "password", type: "password", required: true };

export function SignInForm({
  redirectTo,
  onSuccess,
  identityField = "email",
  forgotPasswordHref,
  signUpHref,
  submitLabel = "Sign in",
  className,
  children,
}: SignInFormProps) {
  const auth = useAuth();
  const [values, setValues] = useState<Record<string, unknown>>({ [identityField]: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const edit = (name: string, raw: unknown) => {
    setValues((v) => ({ ...v, [name]: raw }));
    setErrors((e) => {
      if (!(name in e)) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  };
  const fields = [identity(identityField), { ...password, minLength: 0 }];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateRecord(fields, values);
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

  return (
    <form method="post" className={cx("bk-form", "bk-sign-in", className)} onSubmit={submit} noValidate aria-busy={auth.pending || undefined}>
      <FormAlert message={auth.error} />
      <Field
        field={identity(identityField)}
        value={values[identityField]}
        error={errors[identityField]}
        autoComplete={identityField === "email" ? "email" : "username"}
        onChange={(raw) => edit(identityField, raw)}
      />
      <Field
        field={password}
        value={values.password}
        error={errors.password}
        autoComplete="current-password"
        onChange={(raw) => edit("password", raw)}
      />
      <button className="bk-button" type="submit" disabled={auth.pending}>
        {auth.pending ? "Signing in..." : submitLabel}
      </button>
      {(forgotPasswordHref || signUpHref) && (
        <p className="bk-links">
          {forgotPasswordHref && <a href={forgotPasswordHref}>Forgot your password?</a>}
          {signUpHref && <a href={signUpHref}>Create an account</a>}
        </p>
      )}
      {children}
    </form>
  );
}

export interface SignUpFormProps {
  /** Fields to ask for. Default: what the auth entity in the schema lets people set, or email, password, and name. */
  fields?: readonly FieldSchema[];
  include?: readonly string[];
  signInHref?: string;
  onSuccess?: (message: string) => void;
  submitLabel?: string;
  className?: string;
}

export function SignUpForm({ fields, include, signInHref, onSuccess, submitLabel = "Create account", className }: SignUpFormProps) {
  const auth = useAuth();
  const { schema } = useBakorin();
  const authEntity = schema?.auth ? schema.entities[schema.auth.entity] : undefined;
  const shown =
    fields ??
    (authEntity
      ? formFields(authEntity, { mode: "create", include })
      : [identity("email"), password, { name: "name", type: "text", required: true } satisfies FieldSchema]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const edit = (name: string, raw: unknown) => {
    setValues((v) => ({ ...v, [name]: raw }));
    setErrors((e) => {
      if (!(name in e)) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  };
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateRecord(shown, values);
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
    return (
      <div className={cx("bk-form", "bk-sign-up", className)}>
        <FormAlert tone="success" message={done} />
        {signInHref && (
          <p className="bk-links">
            <a href={signInHref}>Go to sign in</a>
          </p>
        )}
      </div>
    );
  }
  return (
    <form method="post" className={cx("bk-form", "bk-sign-up", className)} onSubmit={submit} noValidate aria-busy={auth.pending || undefined}>
      <FormAlert message={auth.error} />
      {shown.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={values[field.name]}
          error={errors[field.name]}
          hint={field.type === "password" ? "At least 8 characters." : undefined}
          onChange={(raw) => edit(field.name, raw)}
        />
      ))}
      <button className="bk-button" type="submit" disabled={auth.pending}>
        {auth.pending ? "Creating account..." : submitLabel}
      </button>
      {signInHref && (
        <p className="bk-links">
          Already have an account? <a href={signInHref}>Sign in</a>
        </p>
      )}
    </form>
  );
}

export function ForgotPasswordForm({ className, signInHref }: { className?: string; signInHref?: string }) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const field = identity("email");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateRecord([field], { email });
    setError(found.email);
    if (!found.email && (await auth.forgotPassword(email))) {
      setSent(true);
    }
  }
  return (
    <form method="post" className={cx("bk-form", "bk-forgot", className)} onSubmit={submit} noValidate>
      <FormAlert message={auth.error} />
      <FormAlert tone="success" message={sent ? "If that email has an account, a reset link is on its way." : null} />
      <Field field={field} value={email} error={error} onChange={(raw) => {
          setEmail(String(raw ?? ""));
          setError(undefined);
        }} />
      <button className="bk-button" type="submit" disabled={auth.pending}>
        Send reset link
      </button>
      {signInHref && (
        <p className="bk-links">
          <a href={signInHref}>Back to sign in</a>
        </p>
      )}
    </form>
  );
}

export function ResetPasswordForm({ token, className, signInHref }: { token?: string; className?: string; signInHref?: string }) {
  const auth = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const field: FieldSchema = { ...password, name: "password" };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolved = token ?? (typeof location !== "undefined" ? new URLSearchParams(location.search).get("token") : null);
    const found = validateRecord([field], { password: value });
    setError(found.password ?? (resolved ? undefined : "This reset link is missing its token"));
    if (!found.password && resolved && (await auth.resetPassword(resolved, value))) {
      setDone(true);
    }
  }
  return (
    <form method="post" className={cx("bk-form", "bk-reset", className)} onSubmit={submit} noValidate>
      <FormAlert message={auth.error} />
      <FormAlert tone="success" message={done ? "Your password is changed. You can sign in now." : null} />
      <Field field={field} label="New password" value={value} error={error} hint="At least 8 characters." onChange={(raw) => {
          setValue(String(raw ?? ""));
          setError(undefined);
        }} />
      <button className="bk-button" type="submit" disabled={auth.pending || done}>
        Set new password
      </button>
      {signInHref && done && (
        <p className="bk-links">
          <a href={signInHref}>Sign in</a>
        </p>
      )}
    </form>
  );
}

function displayName(user: User | null): string {
  if (!user) {
    return "";
  }
  return String(user.name ?? user.email ?? user.id ?? "Account");
}

export interface AuthButtonProps {
  signInHref?: string;
  /** Where to go after signing out. Default: reload the current page. */
  afterSignOut?: string;
  className?: string;
}

/** "Sign in" when signed out, "Sign out" when signed in. */
export function AuthButton({ signInHref = "/login", afterSignOut, className }: AuthButtonProps) {
  const auth = useAuth();
  if (auth.status !== "signed-in") {
    return (
      <a className={cx("bk-button", "bk-button--secondary", className)} href={signInHref} aria-busy={auth.status === "loading" || undefined}>
        Sign in
      </a>
    );
  }
  return (
    <button
      className={cx("bk-button", "bk-button--secondary", className)}
      type="button"
      disabled={auth.pending}
      onClick={async () => {
        await auth.signOut();
        afterSignOutNavigate(afterSignOut);
      }}
    >
      Sign out
    </button>
  );
}

export interface UserMenuProps extends AuthButtonProps {
  /** Links for the menu, like an account page. */
  links?: { href: string; label: string }[];
}

/** The signed in user's name with a small menu: your links, then Sign out. A disclosure, so it works with any input. */
export function UserMenu({ links = [], signInHref = "/login", afterSignOut, className }: UserMenuProps) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) {
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
    return <AuthButton signInHref={signInHref} className={className} />;
  }
  return (
    <div className={cx("bk-user-menu", className)} ref={root}>
      <button ref={button} className="bk-user-menu__button" type="button" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => setOpen(!open)}>
        <span className="bk-avatar" aria-hidden="true">
          {displayName(auth.user).charAt(0).toUpperCase()}
        </span>
        <span className="bk-user-menu__name">{displayName(auth.user)}</span>
      </button>
      <div className="bk-user-menu__panel" id={`${id}-menu`} hidden={!open}>
        {typeof auth.user?.email === "string" && <p className="bk-user-menu__email">{auth.user.email}</p>}
        <ul className="bk-user-menu__list">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="bk-user-menu__signout"
              onClick={async () => {
                await auth.signOut();
                afterSignOutNavigate(afterSignOut);
              }}
            >
              Sign out
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

export interface GateProps {
  children?: ReactNode;
  /** Shown when signed out (or without the role). Default: nothing. */
  fallback?: ReactNode;
  /** Shown while the user loads. Default: nothing. */
  loading?: ReactNode;
  roles?: readonly string[];
  /** Send signed out people here instead of showing fallback. */
  redirectTo?: string;
}

/**
 * Shows children only to signed in users. This hides UI; it does not protect data.
 * Bakorin's policies protect data, and requireAuth or authMiddleware protect pages.
 */
export function Gate({ children, fallback = null, loading = null, roles, redirectTo }: GateProps) {
  const auth = useAuth();
  const allowed = auth.status === "signed-in" && (!roles || roles.includes(String(auth.user?.role)));
  useEffect(() => {
    if (auth.status === "signed-out" && redirectTo) {
      go(redirectTo);
    }
  }, [auth.status, redirectTo]);
  if (auth.status === "loading") {
    return <>{loading}</>;
  }
  return <>{allowed ? children : fallback}</>;
}

