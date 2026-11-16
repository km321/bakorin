const B = "http://127.0.0.1:4371";
const login = await (await fetch(B + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "avery@fernwood.example", password: "demo-password-fernwood-1" }) })).json();
const T = login.data.accessToken;
const r = await fetch(B + "/api/v1/auth/invites", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${T}` }, body: JSON.stringify({ email: "river@fernwood.example", role: "user", name: "River Adeyemi" }) });
console.log("invite", r.status);
