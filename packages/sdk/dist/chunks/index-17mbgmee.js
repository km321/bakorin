// src/guard.ts
function isProtected2(pathname, rule = ["/app"]) {
  if (typeof rule === "function") {
    return rule(pathname);
  }
  return rule.some((prefix) => {
    const clean = prefix.replace(/\/+$/, "") || "/";
    return clean === "/" || pathname === clean || pathname.startsWith(`${clean}/`);
  });
}
function refreshUrl2(next, options = {}) {
  const prefix = (options.prefix ?? "/api/bakorin").replace(/\/+$/, "");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const params = new URLSearchParams({ next: safeNext, fail: options.loginPath ?? "/login" });
  return `${prefix}/-/refresh?${params}`;
}
function hasRole(user, roles) {
  if (!roles || roles.length === 0) {
    return true;
  }
  const role = user?.role;
  return typeof role === "string" && roles.includes(role);
}
function forbidden() {
  return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export { isProtected2, refreshUrl2, hasRole, forbidden };
