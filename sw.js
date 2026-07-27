// ═══════════════ NEXUS · Service Worker (offline / PWA) ═══════════════
// Network-first para os assets do app (o cache é só o fallback offline).
// Nenhum dado do usuário é armazenado aqui (isso vive em IndexedDB);
// só o "casco" estático do app fica em cache.

const CACHE = "nexus-shell-v9";
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
  "./js/modules/trash.js", "./js/modules/productivity.js", "./js/modules/tasks.js", "./js/modules/tags.js", "./js/modules/calendar.js",
  "./js/core/privacy.js", "./js/core/sync.js",
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

// Estratégia: NETWORK-FIRST para o código do app.
// Cache-first fazia o navegador servir CSS/JS antigos mesmo depois de publicar
// uma versão nova (o app ficava "uma versão atrás"). Agora, com rede, sempre
// vem a versão atual; sem rede, cai no cache e o app continua 100% offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // não intercepta terceiros

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        // offline → cache da versão atual, depois qualquer cache, depois o shell
        const hit = await caches.match(req, { cacheName: CACHE }) || await caches.match(req);
        if (hit) return hit;
        if (req.mode === "navigate" || req.destination === "document") {
          return (await caches.match("./index.html")) || Response.error();
        }
        return Response.error();
      })
  );
});

// permite que a página peça a ativação imediata de uma versão nova
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});
