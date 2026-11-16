// Adds uploads for the Files screenshots: PDF briefs on projects, a moodboard,
// and a few files no record uses. Run with bun after seed.mjs (it backdates the
// unused uploads in the demo SQLite file so they count as unused, not just uploaded).
import sharp from "sharp";
import { Database } from "bun:sqlite";
const B = "http://127.0.0.1:4371";
const DB = process.env.DEMO_DB ?? "/tmp/demo/data/app.db";
async function j(path, opts = {}, token) {
  const res = await fetch(B + path, { ...opts, headers: { ...(opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const T = (await j("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: "avery@fernwood.example", password: "demo-password-fernwood-1" }) })).data.accessToken;

/** A small one page PDF with a title and a few lines of text. */
function pdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [`BT /F1 20 Tf 72 720 Td (${esc(title)}) Tj ET`, ...lines.map((line, i) => `BT /F1 12 Tf 72 ${684 - i * 20} Td (${esc(line)}) Tj ET`)].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function image(width, height, colors, label) {
  const stripes = colors.map((c, i) => `<rect x="${(i * width) / colors.length}" y="0" width="${width / colors.length + 1}" height="${height}" fill="${c}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${stripes}<text x="${width / 2}" y="${height / 2 + 14}" font-family="DejaVu Sans, sans-serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function upload(bytes, type, name) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  return (await j("/api/v1/files", { method: "POST", body: fd }, T)).data.id;
}

const projects = (await j("/api/v1/projects?limit=50", {}, T)).data;
const byName = (name) => projects.find((p) => p.name === name);
const briefs = [
  ["Online store rebuild", "online-store-brief.pdf", ["Scope: catalog, checkout, and account pages.", "Launch target: January 22.", "Accessibility: WCAG 2.2 AA."]],
  ["Spring menu refresh", "spring-menu-brief.pdf", ["Six menu boards and a take away card.", "Photography in week two."]],
  ["Annual report 2026", "annual-report-outline.pdf", ["Twelve pages, four illustrated charts.", "Donor stories in section three."]],
  ["Volunteer signup site", "volunteer-site-brief.pdf", ["Shift calendar, signup form, reminder email."]],
];
for (const [project, file, lines] of briefs) {
  const p = byName(project);
  if (!p) continue;
  const id = await upload(pdf(project, lines), "application/pdf", file);
  await j(`/api/v1/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ brief: id }) }, T);
}
const moodboard = byName("Logo and signage");
if (moodboard) {
  const id = await upload(await image(1200, 800, ["#b45309", "#d97706", "#78350f", "#fef3c7"], "Saltmarsh signage"), "image/png", "signage-moodboard.png");
  await j(`/api/v1/projects/${moodboard.id}`, { method: "PATCH", body: JSON.stringify({ brief: id }) }, T);
}
// Files no record uses: an old draft and a replaced brief.
const unused = [
  await upload(await image(800, 800, ["#1d4ed8", "#60a5fa"], "N draft"), "image/png", "northwind-logo-draft.png"),
  await upload(pdf("Reading month posters", ["First round, replaced by round two."]), "application/pdf", "posters-brief-round-1.pdf"),
  await upload(new TextEncoder().encode("Call notes, Cedar Hill Clinic\nTone: calm, plain words.\n"), "text/plain", "cedar-hill-call-notes.txt"),
];
const db = new Database(DB);
const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
for (const id of unused) db.query("update _bakorin_files set created_at = ? where id = ?").run(old, id);
db.close();
console.log(JSON.stringify({ briefs: briefs.length + 1, unused: unused.length }));
