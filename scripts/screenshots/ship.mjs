const B = "http://127.0.0.1:4371";
const a = await (await fetch(B + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "avery@fernwood.example", password: "demo-password-fernwood-1" }) })).json();
const T = a.data.accessToken;
const h = { "content-type": "application/json", authorization: `Bearer ${T}` };
const list = (await (await fetch(B + "/api/v1/projects?limit=50", { headers: h })).json()).data;
const p = list.find((x) => x.name === "Annual report 2026");
const r = await fetch(B + `/api/v1/projects/${p.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ status: "shipped" }) });
console.log(r.status);
for (let i = 0; i < 2; i++) { await new Promise((ok) => setTimeout(ok, 1500)); console.log("backup", (await fetch(B + "/api/v1/backups", { method: "POST", headers: h, body: "{}" })).status); }
