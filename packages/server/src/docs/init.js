window.onload = function () {
  function token() {
    try {
      return localStorage.getItem("bakorin_access") || "";
    } catch {
      return "";
    }
  }
  const ui = SwaggerUIBundle({
    url: "/api/v1/openapi.json",
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
};
