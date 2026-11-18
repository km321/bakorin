import {
  visitorHeaders2,
  envProxySecret2,
  createClient2
} from "./chunks/index-kvbz0pj9.js";
import {
  rightmostForwardedFor2,
  isSameSiteRequest2,
  createProxyHandler2
} from "./chunks/index-gynvv190.js";
import {
  sanitizeRichText2,
  richTextToPlain2,
  isRichTextEmpty2
} from "./chunks/index-2p7b6gjp.js";
import {
  isProtected2,
  refreshUrl2,
  hasRole,
  forbidden
} from "./chunks/index-17mbgmee.js";
import {
  loadBrandingTheme2
} from "./chunks/index-n603vnp4.js";
import {
  signInFields2
} from "./chunks/index-f24s06zt.js";
import {
  coerceValue2,
  validateRecord2,
  changedFields2,
  fieldErrorsFrom2
} from "./chunks/index-dyakva2e.js";
// src/astro.ts
var DEFAULT_PROXY_PREFIX = "/api/bakorin";
function createAstroClient(options) {
  const { clientIp, proxySecret, refreshPath = DEFAULT_PROXY_PREFIX, ...rest } = options;
  return createClient2({
    ...rest,
    headers: { ...rest.headers, ...visitorHeaders2(clientIp, proxySecret ?? envProxySecret2()) },
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens) => {
      options.cookies.set("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: tokens.expiresIn });
      options.cookies.set("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: refreshPath, maxAge: 30 * 24 * 3600 });
    }
  });
}
function createAstroProxy(options) {
  const addresses = new WeakMap;
  const handle = createProxyHandler2({ getClientIp: (request) => addresses.get(request), ...options });
  return (context) => {
    try {
      if (context.clientAddress)
        addresses.set(context.request, context.clientAddress);
    } catch {}
    return handle(context.request);
  };
}
function requireAuth(options) {
  const { baseUrl, proxySecret, ...guard } = options;
  const prefix = guard.prefix ?? DEFAULT_PROXY_PREFIX;
  return async (context, next) => {
    const pathname = context.url.pathname;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return next();
    }
    const needed = isProtected2(pathname, guard.protect);
    let user = null;
    if (needed || context.cookies.get("bakorin_access")?.value) {
      let clientIp;
      try {
        clientIp = context.clientAddress;
      } catch {}
      const client = createAstroClient({ baseUrl, cookies: context.cookies, clientIp, proxySecret, refreshPath: prefix });
      user = await client.me().catch(() => null);
    }
    context.locals.user = user;
    if (needed && !user) {
      return context.redirect(refreshUrl2(pathname + context.url.search, { ...guard, prefix }));
    }
    if (needed && !hasRole(user, guard.roles)) {
      return forbidden();
    }
    return next();
  };
}
function astroClient(context, baseUrl, proxySecret) {
  let clientIp;
  try {
    clientIp = context.clientAddress;
  } catch {}
  return createAstroClient({ baseUrl, cookies: context.cookies, clientIp, proxySecret });
}
function formValues(data, fields) {
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
async function handleAuthForm(context, options) {
  if (context.request.method !== "POST") {
    return {};
  }
  const fields = options.fields ?? defaultAuthFields(options.mode);
  const values = formValues(await context.request.formData(), fields);
  const keep = Object.fromEntries(Object.entries(values).filter(([key]) => !/password/i.test(key)));
  const errors = validateRecord2(fields, values);
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
    const mapped = fieldErrorsFrom2(error, fields.map((field) => field.name));
    return { errors: mapped.fields, error: mapped.message, values: keep };
  }
}
function defaultAuthFields(mode, identityField = "email") {
  if (mode === "sign-in")
    return signInFields2(identityField);
  if (mode === "forgot")
    return [{ name: "email", type: "email", required: true }];
  if (mode === "reset")
    return [{ name: "password", type: "password", required: true }];
  return [
    { name: "email", type: "email", required: true },
    { name: "password", type: "password", required: true },
    { name: "name", type: "text", required: true }
  ];
}
async function handleRecordForm(context, options) {
  if (context.request.method !== "POST") {
    return {};
  }
  const data = await context.request.formData();
  if (data.get("_bakorin_form") !== options.entity) {
    return {};
  }
  const values = formValues(data, options.fields);
  const mode = options.id ? "update" : "create";
  const errors = validateRecord2(options.fields, values, mode);
  if (Object.keys(errors).length) {
    return { errors, values };
  }
  const api = astroClient(context, options.baseUrl, options.proxySecret).entity(options.entity);
  try {
    const body = mode === "update" ? changedFields2(options.initial ?? {}, values) : Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
    const result = mode === "update" ? await api.update(options.id, body) : await api.create(body);
    return { result, message: "Saved", response: options.redirectTo ? context.redirect(options.redirectTo, 303) : undefined };
  } catch (error) {
    const mapped = fieldErrorsFrom2(error, options.fields.map((field) => field.name));
    return { errors: mapped.fields, error: mapped.message, values };
  }
}
export {
  DEFAULT_PROXY_PREFIX,
  createAstroClient,
  createAstroProxy,
  createProxyHandler2 as createProxyHandler,
  defaultAuthFields,
  handleAuthForm,
  handleRecordForm,
  isProtected2 as isProtected,
  isRichTextEmpty2 as isRichTextEmpty,
  isSameSiteRequest2 as isSameSiteRequest,
  loadBrandingTheme2 as loadBrandingTheme,
  refreshUrl2 as refreshUrl,
  requireAuth,
  richTextToPlain2 as richTextToPlain,
  rightmostForwardedFor2 as rightmostForwardedFor,
  sanitizeRichText2 as sanitizeRichText
};
