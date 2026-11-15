// Bakorin API docs theme. Shares the admin's "bakorin_theme" key (system, light, dark)
// so the docs follow whatever the admin toggle picked. Loaded in <head> to avoid a flash.
(function () {
  var KEY = "bakorin_theme";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function parse(raw) {
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  }
  function stored() {
    try {
      return parse(localStorage.getItem(KEY));
    } catch (err) {
      return "system";
    }
  }
  function apply(mode) {
    var dark = mode === "dark" || (mode === "system" && !!mq && mq.matches);
    var theme = dark ? "dark" : "light";
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-mode", mode);
    root.style.colorScheme = theme;
    // Swagger UI ships its own dark rules under html.dark-mode; page.css refines them.
    root.classList.toggle("dark-mode", dark);
    var buttons = document.querySelectorAll(".docs-theme button[data-mode]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-checked", String(buttons[i].getAttribute("data-mode") === mode));
    }
  }

  apply(stored());

  if (mq) {
    var onChange = function () {
      if (stored() === "system") apply("system");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.addEventListener("storage", function (event) {
    if (event.key === KEY) apply(stored());
  });

  document.addEventListener("DOMContentLoaded", function () {
    var buttons = document.querySelectorAll(".docs-theme button[data-mode]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (event) {
        var mode = parse(event.currentTarget.getAttribute("data-mode"));
        try {
          localStorage.setItem(KEY, mode);
        } catch (err) {
          // private mode
        }
        apply(mode);
      });
    }
    apply(stored());
  });
})();
