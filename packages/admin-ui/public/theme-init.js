// Applies the saved theme before first paint. Loaded as a blocking external script so the
// admin's Content-Security-Policy (script-src 'self') allows it and there is no flash.
(function () {
  try {
    var stored = localStorage.getItem("bakorin_theme");
    var mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var dark =
      mode === "dark" ||
      (mode !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var theme = dark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-theme-mode", mode);
    document.documentElement.style.colorScheme = theme;
  } catch (err) {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("data-theme-mode", "system");
  }
})();
