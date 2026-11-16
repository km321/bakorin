// Railway Infrastructure as Code. Railway stops reading railway.json and
// railway.toml on 2026-12-01; this file replaces them.
// Preview with `railway config plan`, then apply with `railway config apply`.
// Docs: https://docs.railway.com/infrastructure-as-code
import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // SQLite, uploads, and local backups live here. Keep BAKORIN_DATA_DIR=/data.
  const data = volume("{{APP_NAME}}-data");

  const app = service("{{APP_NAME}}", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bakorin start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    volumeMounts: { "/data": data },
  });

  // Variables (JWT_SECRET, BAKORIN_PROXY_SECRET, mail and bucket keys) stay in the
  // Railway dashboard, so apply never removes or prints them. `railway config
  // migrate` writes this setting; the railway npm types do not list it yet, so it
  // is passed as a variable rather than an inline object.
  const definition = { variables: { managed: false }, resources: [app, data] };
  return project("{{APP_NAME}}", definition);
});
