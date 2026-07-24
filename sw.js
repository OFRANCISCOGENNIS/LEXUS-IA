// ═══════════════ NEXUS · Service Worker (offline / PWA) ═══════════════
// Cache-first para os assets do app. Nenhum dado do usuário é armazenado aqui
// (isso vive em IndexedDB); só o "casco" estático do app fica em cache.

const CACHE = "nexus-shell-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/tokens.css", "./css/base.css", "./css/shell.css", "./css/components.css",
  "./css/editor.css", "./css/database.css", "./css/views.css",
  "./css/productivity.css", "./css/polish.css", "./css/mobile.css", "./css/print.css",
  "./js/app.js",
  "./js/shell.js",
  "./js/core/bus.js", "./js/core/db.js", "./js/core/store.js", "./js/core/router.js",
  "./js/core/ui.js", "./js/core/utils.js", "./js/core/markdown.js", "./js/core/reminders.js",
  "./js/modules/editor.js", "./js/modules/database.js", "./js/modules/palette.js",
  "./js/modules/home.js", "./js/modules/daily.js", "./js/modules/graph.js",
  "./js/modules/search.js", "./js/modules/settings.js", "./js/modules/templates.js",
  "./js/modules/trash.js", "./js/modules/productivity.js", "./js/modules/tasks.js", "./js/modules/tags.js",
  "./js/core/privacy.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // cacheia individualmente para que um 404 não derrube os demais
      Promise.allSettled(ASSETS.map((a) => c.add(a)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // não intercepta terceiros
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && (req.destination === "script" || req.destination === "style" || req.destination === "document")) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
