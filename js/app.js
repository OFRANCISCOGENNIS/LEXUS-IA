// ═══════════════ NEXUS · Entry point ═══════════════

import { initStore, getSetting } from "./core/store.js";
import { initRouter, registerRoute, navigate, parseHash } from "./core/router.js";
import { initShell } from "./shell.js";
import { initPalette } from "./modules/palette.js";
import { initReminders } from "./core/reminders.js";

async function boot() {
  await initStore();

  // Rotas com carregamento lazy — módulos pesados só carregam ao navegar
  registerRoute("home", () => import("./modules/home.js"));
  registerRoute("page", () => import("./modules/editor.js"));
  registerRoute("db", () => import("./modules/database.js"));
  registerRoute("daily", () => import("./modules/daily.js"));
  registerRoute("productivity", () => import("./modules/productivity.js"));
  registerRoute("tasks", () => import("./modules/tasks.js"));
  registerRoute("calendar", () => import("./modules/calendar.js"));
  registerRoute("tags", () => import("./modules/tags.js"));
  registerRoute("graph", () => import("./modules/graph.js"));
  registerRoute("settings", () => import("./modules/settings.js"));
  registerRoute("templates", () => import("./modules/templates.js"));
  registerRoute("trash", () => import("./modules/trash.js"));
  registerRoute("search", () => import("./modules/search.js"));

  // define a rota inicial ANTES do router montar (evita carregar módulo errado)
  if (!location.hash || location.hash === "#/") {
    const first = getSetting("firstPageId");
    history.replaceState(null, "", first ? `#/page/${first}` : "#/home");
  }

  initShell();
  initPalette();
  initReminders();
  initRouter(document.getElementById("view"));

  document.getElementById("app").classList.add("anim-fade");
}

boot().catch((e) => {
  console.error("Falha ao iniciar o NEXUS", e);
  document.getElementById("view").innerHTML =
    `<div class="empty-state"><div class="es-icon">⚠</div>
     <div class="es-title">Falha ao iniciar</div>
     <div class="es-desc">${String(e?.message || e)}</div></div>`;
});
