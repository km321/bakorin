import sharp from "sharp";
const B = "http://127.0.0.1:4371";
async function j(path, opts = {}, token) {
  const res = await fetch(B + path, { ...opts, headers: { ...(opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const login = await j("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: "avery@fernwood.example", password: "demo-password-fernwood-1" }) });
const T = login.data.accessToken;
// admin's own profile
const me = (await j("/api/v1/auth/me", {}, T)).data;
await j(`/api/v1/users/${me.id}`, { method: "PATCH", body: JSON.stringify({ name: "Avery Lindqvist", title: "Studio director" }) }, T);
const people = [
  ["Juno Okafor", "juno@fernwood.example", "Brand designer"],
  ["Mateo Ruiz", "mateo@fernwood.example", "Front end developer"],
  ["Priya Natarajan", "priya@fernwood.example", "Project manager"],
  ["Sol Bergström", "sol@fernwood.example", "Copywriter"],
  ["Hana Morimoto", "hana@fernwood.example", "Illustrator"],
];
const users = [me.id];
for (const [name, email, title] of people) {
  const u = await j("/api/v1/users", { method: "POST", body: JSON.stringify({ name, email, title, password: "fictional-pass-0001", role: "user" }) }, T);
  users.push(u.data.id);
}
async function logo(color, letter) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="48" fill="${color}"/><text x="128" y="165" font-family="DejaVu Sans, sans-serif" font-size="120" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), `${letter.toLowerCase()}-logo.png`);
  return (await j("/api/v1/files", { method: "POST", body: fd }, T)).data.id;
}
const clientsData = [
  ["Saltmarsh Bakery", "hospitality", "saltmarsh.example", "#b45309", "S"],
  ["Northwind Bicycle Co.", "retail", "northwind-bikes.example", "#1d4ed8", "N"],
  ["Riverbend Food Bank", "nonprofit", "riverbend.example", "#15803d", "R"],
  ["Cedar Hill Clinic", "health", "cedarhill.example", "#0e7490", "C"],
  ["Lantern Lane Library", "education", "lanternlane.example", "#7c3aed", "L"],
];
const clients = [];
for (const [name, industry, site, color, letter] of clientsData) {
  const c = await j("/api/v1/clients", { method: "POST", body: JSON.stringify({ name, industry, website: `https://${site}`, contactEmail: `hello@${site}`, logo: await logo(color, letter) }) }, T);
  clients.push(c.data.id);
}
const tagNames = [["Branding", "#2f6f4f"], ["Website", "#1d4ed8"], ["Print", "#b45309"], ["Illustration", "#be185d"], ["Accessibility", "#0e7490"], ["Rush", "#dc2626"]];
const tags = {};
for (const [name, color] of tagNames) tags[name] = (await j("/api/v1/tags", { method: "POST", body: JSON.stringify({ name, color }) }, T)).data.id;
const projectsData = [
  ["Spring menu refresh", 0, "active", 4800, "2026-12-04", ["Branding", "Print"], [1, 4]],
  ["Online store rebuild", 1, "active", 18500, "2027-01-22", ["Website", "Accessibility"], [2, 3, 1]],
  ["Annual report 2026", 2, "review", 6200, "2026-11-28", ["Print", "Illustration"], [4, 5]],
  ["Patient portal copy", 3, "proposal", 3900, "2027-02-10", ["Website"], [4, 3]],
  ["Reading month posters", 4, "shipped", 2100, "2026-10-30", ["Illustration", "Print", "Rush"], [5]],
  ["Logo and signage", 0, "shipped", 7300, "2026-09-12", ["Branding"], [1, 5]],
  ["Volunteer signup site", 2, "active", 9400, "2026-12-18", ["Website", "Accessibility", "Rush"], [2, 3]],
];
const projects = [];
for (const [name, ci, status, budget, dueOn, t, m] of projectsData) {
  const p = await j("/api/v1/projects", { method: "POST", body: JSON.stringify({ name, clientId: clients[ci], status, budget, dueOn, tagIds: t.map((x) => tags[x]), memberIds: m.map((x) => users[x]) }) }, T);
  projects.push(p.data.id);
}
const tasks = [
  ["Photograph seasonal pastries", 0, 4, false, "2026-11-20"],
  ["Typeset menu boards", 0, 1, false, "2026-11-25"],
  ["Product page templates", 1, 2, false, "2026-12-02"],
  ["Checkout accessibility audit", 1, 3, false, "2026-12-09"],
  ["Migrate 240 product photos", 1, 2, true, "2026-11-12"],
  ["Chart illustrations", 2, 5, false, "2026-11-21"],
  ["Proofread donor stories", 2, 4, true, "2026-11-14"],
  ["Discovery call notes", 3, 3, true, "2026-11-10"],
  ["Volunteer form copy", 6, 4, false, "2026-12-01"],
  ["Shift calendar component", 6, 2, false, "2026-12-08"],
];
for (const [title, pi, ui, done, dueOn] of tasks) {
  await j("/api/v1/tasks", { method: "POST", body: JSON.stringify({ title, projectId: projects[pi], assigneeId: users[ui], done, dueOn }) }, T);
}
await j(`/api/v1/projects/${projects[2]}`, { method: "PATCH", body: JSON.stringify({ status: "review" }) }, T);
await j("/api/v1/auth/invite", { method: "POST", body: JSON.stringify({ email: "river@fernwood.example", role: "user" }) }, T).catch((e) => console.log("invite", e.message));
await j("/api/v1/backups", { method: "POST", body: "{}" }, T).catch((e) => console.log("backup", e.message));
// MCP calls for the audit log
for (const name of ["app_overview", "describe_entity"]) {
  await fetch(B + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer demo-mcp-token-fictional-0123456789abcdef" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: name === "describe_entity" ? { entity: "projects" } : {} } }) });
}
console.log(JSON.stringify({ users: users.length, clients: clients.length, projects: projects.length }));
