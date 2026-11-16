/**
 * Example data for the blog template. Run with the API up: bun seed.ts
 *
 * Everything this adds is labeled as example data. Edit or delete it in /admin
 * on the API, or in the site, before you launch. Running it twice adds nothing new.
 */
// ---- Seed helpers (plain fetch, no packages) ----
// Bun loads .env from this folder. The API must be running.
import { deflateSync } from "node:zlib";

const API = (process.env.BAKORIN_URL ?? "http://127.0.0.1:4371").replace(/\/$/, "");
const email = process.env.BAKORIN_ADMIN_EMAIL;
const password = process.env.BAKORIN_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Set BAKORIN_ADMIN_EMAIL and BAKORIN_ADMIN_PASSWORD in .env (an admin account), then run bun seed.ts again.");
  process.exit(1);
}

type Row = Record<string, unknown> & { id: string };
let token = "";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed with ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function signIn(): Promise<Row> {
  const { data } = await call<{ data: { accessToken: string; user: Row } }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  token = data.accessToken;
  if (data.user.role !== "admin") throw new Error(`${email} is not an admin, so it cannot add the example data.`);
  return data.user;
}

/** The first record where field equals value, if any. */
async function findBy(entity: string, field: string, value: string): Promise<Row | undefined> {
  const query = new URLSearchParams({ [`filter[${field}]`]: value, limit: "1" });
  const { data } = await call<{ data: Row[] }>(`/api/v1/${entity}?${query}`);
  return data[0];
}

/** Creates the record unless one with the same key field exists. Safe to run twice. */
async function ensure(entity: string, key: string, body: Record<string, unknown>): Promise<Row> {
  const existing = await findBy(entity, key, String(body[key]));
  if (existing) return existing;
  const { data } = await call<{ data: Row }>(`/api/v1/${entity}`, { method: "POST", body: JSON.stringify(body) });
  console.log(`Added ${entity}: ${String(body[key])}`);
  return data;
}

/** Uploads a plain colored PNG with a few stripes, so the example image is obviously a placeholder. */
async function exampleImage(name: string, rgb: [number, number, number]): Promise<string> {
  const form = new FormData();
  form.set("file", new Blob([placeholderPng(960, 600, rgb)], { type: "image/png" }), `example-${name}.png`);
  const { data } = await call<{ data: { id: string } }>("/api/v1/files", { method: "POST", body: form });
  return data.id;
}

function placeholderPng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const stripe = Math.floor((x + y) / 48) % 2 === 0;
      const k = stripe ? 1 : 0.88;
      raw[row + 1 + x * 3] = Math.round(r * k);
      raw[row + 2 + x * 3] = Math.round(g * k);
      raw[row + 3 + x * 3] = Math.round(b * k);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** YYYY-MM-DD, days from today. */
function day(offset = 0): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
// ---- End of helpers ----

const admin = await signIn();

const guides = await ensure("categories", "slug", { name: "Example: Guides", slug: "example-guides" });
const news = await ensure("categories", "slug", { name: "Example: News", slug: "example-news" });

const posts = [
  {
    slug: "example-welcome",
    title: "Example post: Welcome to the blog",
    excerpt: "This is an example post. Replace it with your first real one.",
    body: "This is example text so you can see how a post looks.\n\nWrite posts at /write while signed in as an admin. Drafts stay private until you publish them.\n\nDelete this example before you launch.",
    categoryId: news.id,
    color: [37, 99, 235] as [number, number, number],
    days: -2,
  },
  {
    slug: "example-writing-tips",
    title: "Example post: How posts are laid out",
    excerpt: "An example post with a cover image, a category, and a few paragraphs.",
    body: "Each blank line starts a new paragraph.\n\nThe cover image is uploaded through the site and stored by Bakorin. Visitors get a short lived link to it.\n\nThis post is example content.",
    categoryId: guides.id,
    color: [15, 118, 110] as [number, number, number],
    days: -1,
  },
];
for (const post of posts) {
  if (await findBy("posts", "slug", post.slug)) continue;
  const cover = await exampleImage(post.slug, post.color);
  await ensure("posts", "slug", {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    categoryId: post.categoryId,
    cover,
    coverAlt: "Example image: a striped color block",
    publishedOn: day(post.days),
    authorId: admin.id,
  });
}

await ensure("drafts", "slug", {
  title: "Example draft: Not published yet",
  slug: "example-draft",
  excerpt: "Only admins can see drafts.",
  body: "This example draft shows how unpublished posts stay private. Open it at /write to publish or delete it.",
  categoryId: guides.id,
});

console.log("Example blog data is ready.");
