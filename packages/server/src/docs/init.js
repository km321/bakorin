window.onload = function () {
  function token() {
    try {
      return localStorage.getItem("bakorin_access") || "";
    } catch {
      return "";
    }
  }
  function notice(text) {
    const root = document.getElementById("swagger-ui");
    const box = document.createElement("p");
    box.className = "docs-notice";
    box.textContent = text;
    root.replaceChildren(box);
  }
  const value = token();
  fetch("/api/v1/openapi.json", { headers: value ? { Authorization: "Bearer " + value } : {} })
    .then(function (response) {
      if (response.status === 401 || response.status === 403) {
        notice("These API docs are for admins. Sign in at /admin/ in this browser, then reload this page.");
        return null;
      }
      return response.json();
    })
    .then(function (spec) {
      if (spec) start(spec);
    })
    .catch(function () {
      notice("Could not load /api/v1/openapi.json.");
    });
};

function start(spec) {
  function token() {
    try {
      return localStorage.getItem("bakorin_access") || "";
    } catch {
      return "";
    }
  }
  const ui = SwaggerUIBundle({
    spec: spec,
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis],
    layout: "BaseLayout",
    persistAuthorization: true,
    tryItOutEnabled: true,
    requestInterceptor: function (req) {
      const value = token();
      if (value && !req.headers.Authorization && !req.headers.authorization) {
        req.headers.Authorization = "Bearer " + value;
      }
      return req;
    },
    onComplete: function () {
      const value = token();
      if (value) {
        ui.preauthorizeApiKey("bearerAuth", value);
      }
    },
  });
  window.ui = ui;
}
