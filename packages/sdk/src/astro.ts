import { createClient, envProxySecret, visitorHeaders, type AuthTokens, type ClientOptions } from "./index.ts";
import { createProxyHandler, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
import { forbidden, hasRole, isProtected, refreshUrl, type GuardOptions } from "./guard.ts";
export { isProtected, refreshUrl, type GuardOptions, type ProtectRule } from "./guard.ts";
import { changedFields, coerceValue, fieldErrorsFrom, validateRecord, type FieldErrors, type FormValues } from "./headless/form.ts";
import type { FieldSchema } from "./headless/schema.ts";
import { signInFields } from "./elements/render.ts";
export { loadBrandingTheme } from "./headless/theme.ts";
export { createProxyHandler, isSameSiteRequest, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";

/** The default pass through route. The refresh cookie lives on this path. */
export const DEFAULT_PROXY_PREFIX = "/api/bakorin";

/**
 * Astro helper. Pass Astro.cookies from a page, endpoint, or middleware.
 */
export function createAstroClient<S extends object = Record<string, Record<string, unknown>>>(
  options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
      get: (name: string) => { value?: string } | undefined;
      set: (name: string, value: string, opts?: object) => void;
    };
    /** The visitor IP (Astro.clientAddress). Sent to Bakorin with proxySecret so lockouts and rate limits are per visitor. */
    clientIp?: string | null;
    /** Shared with the Bakorin server as BAKORIN_PROXY_SECRET. Default: process.env.BAKORIN_PROXY_SECRET. */
    proxySecret?: string;
    /** Path of the refresh cookie. Default /api/bakorin, the pass through route, so pages never see it. */
    refreshPath?: string;
  },
) {
  const { clientIp, proxySecret, refreshPath = DEFAULT_PROXY_PREFIX, ...rest } = options;
  return createClient<S>({
    ...rest,
    headers: { ...rest.headers, ...visitorHeaders(clientIp, proxySecret ?? envProxySecret()) },
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens: AuthTokens) => {
      options.cookies.set("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: tokens.expiresIn });
      options.cookies.set("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: refreshPath, maxAge: 30 * 24 * 3600 });
    },
  });
}

/**
 * A ready made pass through route for browser code. Create
 * src/pages/api/bakorin/[...path].ts with:
 *
 *   import { createAstroProxy } from "@bakorin/sdk/astro";
 *   export const prerender = false;
 *   export const ALL = createAstroProxy({ baseUrl: import.meta.env.BAKORIN_URL });
 *
 * Then use createBrowserClient() from "@bakorin/sdk/browser" in client scripts.
 */
export function createAstroProxy(options: ProxyOptions) {
  // Astro's clientAddress is the socket peer (or what your adapter trusts), so it is safe by default.
  const addresses = new WeakMap<Request, string>();
  const handle = createProxyHandler({ getClientIp: (request) => addresses.get(request), ...options });
  return (context: { request: Request; clientAddress?: string }) => {
    try {
      if (context.clientAddress) addresses.set(context.request, context.clientAddress);
    } catch {
      // the adapter does not provide clientAddress
    }
    return handle(context.request);
  };
}

export interface AstroGuardContext {
  url: URL;
  request: Request;
  cookies: Parameters<typeof createAstroClient>[0]["cookies"];
  locals: Record<string, unknown>;
  redirect: (path: string, status?: 301 | 302 | 303 | 307 | 308) => Response;
  readonly clientAddress?: string;
}

/**
 * Astro middleware that signs people in or sends them to renew their session.
 * It sets Astro.locals.user (null when signed out) on every page, so components
 * like UserMenu and Gate render the right thing on the server.
 *
 *   // src/middleware.ts
 *   import { requireAuth } from "@bakorin/sdk/astro";
 *   export const onRequest = requireAuth({ baseUrl: import.meta.env.BAKORIN_URL, protect: ["/app"] });
 */
export function requireAuth(options: GuardOptions & { baseUrl: string; proxySecret?: string }) {
  const { baseUrl, proxySecret, ...guard } = options;
  const prefix = guard.prefix ?? DEFAULT_PROXY_PREFIX;
  return async (context: AstroGuardContext, next: () => Promise<Response>): Promise<Response> => {
    const pathname = context.url.pathname;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return next();
    }
    const needed = isProtected(pathname, guard.protect);
    let user: unknown = null;
    if (needed || context.cookies.get("bakorin_access")?.value) {
      let clientIp: string | undefined;
      try {
        clientIp = context.clientAddress;
      } catch {
        // prerendered page: no visitor address
      }
      const client = createAstroClient({ baseUrl, cookies: context.cookies, clientIp, proxySecret, refreshPath: prefix });
      user = await client.me().catch(() => null);
    }
    context.locals.user = user;
    if (needed && !user) {
      return context.redirect(refreshUrl(pathname + context.url.search, { ...guard, prefix }));
    }
    if (needed && !hasRole(user, guard.roles)) {
      return forbidden();
    }
    return next();
  };
}

type FormContext = Pick<AstroGuardContext, "request" | "cookies" | "redirect"> & { readonly clientAddress?: string };

function astroClient(context: FormContext, baseUrl: string, proxySecret?: string) {
  let clientIp: string | undefined;
  try {
    clientIp = context.clientAddress;
  } catch {
    // prerendered
  }
  return createAstroClient({ baseUrl, cookies: context.cookies, clientIp, proxySecret });
}

function formValues(data: FormData, fields: readonly FieldSchema[]): FormValues {
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

export interface FormResult<R = unknown> {
  /** Return this from the page (a redirect after success). */
  response?: Response;
  /** Field messages for the form. */
  errors?: FieldErrors;
  /** A message for the whole form. */
  error?: string;
  /** A success message. */
  message?: string;
  /** What was typed, to fill the form again (passwords are left out). */
  values?: FormValues;
  result?: R;
}

/**
 * Handles a SignInForm, SignUpForm, ForgotPasswordForm, or ResetPasswordForm post
 * without JavaScript. Call it in the page frontmatter; it does nothing for GET.
 *
 *   const form = await handleAuthForm(Astro, { baseUrl: import.meta.env.BAKORIN_URL, mode: "sign-in", redirectTo: "/app" });
 *   if (form.response) return form.response;
 */
export async function handleAuthForm(
  context: FormContext,
  options: { baseUrl: string; mode: "sign-in" | "sign-up" | "forgot" | "reset"; redirectTo?: string; fields?: readonly FieldSchema[]; proxySecret?: string },
): Promise<FormResult> {
  if (context.request.method !== "POST") {
    return {};
  }
  const fields = options.fields ?? defaultAuthFields(options.mode);
  const values = formValues(await context.request.formData(), fields);
  const keep = Object.fromEntries(Object.entries(values).filter(([key]) => !/password/i.test(key)));
  const errors = validateRecord(fields, values);
  if (Object.keys(errors).length) {
    return { errors, values: keep };
  }
  const client = astroClient(context, options.baseUrl, options.proxySecret);
  try {
    if (options.mode === "sign-in") {
      await client.login(values);
      return { response: context.redirect(options.redirectTo ?? "/", 303) };
    }
    if (options.mode === "sign-up") {
      return { message: (await client.signup(values)).message };
    }
    if (options.mode === "forgot") {
      await client.forgotPassword({ email: String(values.email ?? "") });
      return { message: "If that email has an account, a reset link is on its way." };
    }
    const token = new URL(context.request.url).searchParams.get("token") ?? "";
    await client.resetPassword({ token, password: String(values.password ?? "") });
    return { message: "Your password is changed. You can sign in now." };
  } catch (error) {
    const mapped = fieldErrorsFrom(error, fields.map((field) => field.name));
    return { errors: mapped.fields, error: mapped.message, values: keep };
  }
}

export function defaultAuthFields(mode: "sign-in" | "sign-up" | "forgot" | "reset", identityField = "email"): FieldSchema[] {
  if (mode === "sign-in") return signInFields(identityField);
  if (mode === "forgot") return [{ name: "email", type: "email", required: true }];
  if (mode === "reset") return [{ name: "password", type: "password", required: true }];
  return [
    { name: "email", type: "email", required: true },
    { name: "password", type: "password", required: true },
    { name: "name", type: "text", required: true },
  ];
}

/**
 * Handles a RecordForm post without JavaScript: validates by the schema, then
 * creates the record (or updates changed fields when id is set).
 */
export async function handleRecordForm<R = Record<string, unknown>>(
  context: FormContext,
  options: { baseUrl: string; entity: string; fields: readonly FieldSchema[]; id?: string; initial?: object; redirectTo?: string; proxySecret?: string },
): Promise<FormResult<R>> {
  if (context.request.method !== "POST") {
    return {};
  }
  const data = await context.request.formData();
  if (data.get("_bakorin_form") !== options.entity) {
    return {};
  }
  const values = formValues(data, options.fields);
  const mode = options.id ? "update" : "create";
  const errors = validateRecord(options.fields, values, mode);
  if (Object.keys(errors).length) {
    return { errors, values };
  }
  const api = astroClient(context, options.baseUrl, options.proxySecret).entity(options.entity);
  try {
    const body = mode === "update" ? changedFields((options.initial ?? {}) as FormValues, values) : Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
    const result = (mode === "update" ? await api.update(options.id!, body) : await api.create(body)) as R;
    return { result, message: "Saved", response: options.redirectTo ? context.redirect(options.redirectTo, 303) : undefined };
  } catch (error) {
    const mapped = fieldErrorsFrom(error, options.fields.map((field) => field.name));
    return { errors: mapped.fields, error: mapped.message, values };
  }
}
