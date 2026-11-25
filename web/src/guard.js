// A classic script that runs before the game's modules. If src/main.js never
// starts (a module failed to download or parse, or the browser has no ES
// modules), the page would stay blank: show a plain message instead.
(function () {
  "use strict";
  function show(text) {
    if (window.__f2Boot || document.querySelector(".f2-guard")) return;
    var d = document.createElement("div");
    d.className = "f2-guard";
    d.setAttribute("role", "alert");
    d.style.cssText = "position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:#0d1b24;color:#f4efe6;font:16px/1.45 system-ui,sans-serif;padding:16px;text-align:center";
    d.innerHTML = "<div style=\"max-width:480px\"><h1 style=\"font-size:22px;margin:0 0 8px\">Forward Two</h1><p style=\"margin:0 0 12px\"></p>" +
      "<button style=\"padding:8px 16px;border-radius:10px;border:0;background:#ff7a2f;color:#111;font:600 15px system-ui,sans-serif\">Try again</button></div>";
    d.querySelector("p").textContent = text;
    d.querySelector("button").onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }
  if (!("noModule" in document.createElement("script"))) {
    document.addEventListener("DOMContentLoaded", function () { show("This browser is too old to run Forward Two. Try a current Chrome, Edge, Firefox or Safari."); });
    return;
  }
  // Module scripts run before DOMContentLoaded's listeners finish; main.js
  // sets window.__f2Boot as its first statement. Give a slow module fetch a
  // little longer than the event, then check.
  window.addEventListener("load", function () {
    setTimeout(function () { show("Forward Two didn't finish downloading. Check your connection and try again."); }, 1500);
  });
})();
