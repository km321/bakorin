// Keeps a few realtime streams open and makes occasional edits so the Status page shows live numbers.
const B = "http://127.0.0.1:4371";
const emails = ["juno", "mateo", "priya", "sol", "hana"];
const streams = [];
for (const e of emails) {
  const r = await (await fetch(B + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${e}@fernwood.example`, password: "fictional-pass-0001" }) })).json();
  const tok = r.data?.accessToken;
  if (!tok) { console.log("login failed", e, JSON.stringify(r)); continue; }
  for (let i = 0; i < 2; i++) {
    const res = await fetch(B + "/api/v1/realtime?entities=projects,tasks", { headers: { authorization: `Bearer ${tok}` } });
    const reader = res.body.getReader();
    streams.push(reader);
    (async () => { while (!(await reader.read()).done) {} })();
  }
}
console.log("streams", streams.length);
const a = await (await fetch(B + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "priya@fernwood.example", password: "fictional-pass-0001" }) })).json();
const T = a.data.accessToken;
const tasks = (await (await fetch(B + "/api/v1/tasks?limit=50", { headers: { authorization: `Bearer ${T}` } })).json()).data;
let n = 0;
setInterval(async () => {
  const t = tasks[n++ % tasks.length];
  await fetch(B + `/api/v1/tasks/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${T}` }, body: JSON.stringify({ dueOn: t.dueOn }) });
}, 6000);
