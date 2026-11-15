import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:4371";
const TOKEN = __ENV.ACCESS_TOKEN || "";
const SCENARIO = __ENV.SCENARIO || "list";
const RATE = Number(__ENV.RATE || (SCENARIO === "create" ? 20 : 40));

export const options = {
  scenarios: {
    crud: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

function headers() {
  return {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
  };
}

export function setup() {
  const listed = http.get(`${BASE}/api/v1/items?limit=1`, { headers: headers() });
  const json = listed.json();
  return { id: json.data?.[0]?.id };
}

export default function (data) {
  if (SCENARIO === "get") {
    const res = http.get(`${BASE}/api/v1/items/${data.id}`, { headers: headers() });
    check(res, { "get 200": (r) => r.status === 200 });
    return;
  }
  if (SCENARIO === "create") {
    const res = http.post(
      `${BASE}/api/v1/items`,
      JSON.stringify({ title: `bench-${Date.now()}-${Math.random()}` }),
      { headers: headers() },
    );
    check(res, { "create 201": (r) => r.status === 201 });
    return;
  }
  const res = http.get(`${BASE}/api/v1/items?limit=20`, { headers: headers() });
  check(res, { "list 200": (r) => r.status === 200 });
}
