// ═══════════════ NEXUS · Router (hash-based, lazy modules) ═══════════════
// Rotas: #/home · #/page/:id · #/db/:id · #/daily · #/graph · #/assistant
//        #/settings · #/templates · #/trash · #/search/:q?

import { bus } from "./bus.js";

const routes = new Map(); // name -> { load: () => Promise<module> }
let current = { name: null, params: {}, module: null };

export function registerRoute(name, load) {
  routes.set(name, { load });
}

export function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = hash.split("/");
  return { name: name || "home", params: { id: rest.join("/") ? decodeURIComponent(rest.join("/")) : null } };
}

export function navigate(name, id = null) {
  const target = "#/" + name + (id ? "/" + encodeURIComponent(id) : "");
  if (location.hash === target) render();
  else location.hash = target;
}

export function currentRoute() {
  return { name: current.name, params: current.params };
}

let container = null;

export function initRouter(viewEl) {
  container = viewEl;
  addEventListener("hashchange", render);
  render();
}

async function render() {
  const { name, params } = parseHash();
  const route = routes.get(name) || routes.get("home");
  if (!route) return;

  // desmonta módulo anterior
  try { current.module?.unmount?.(); } catch (e) { console.error("unmount", e); }

  current = { name, params, module: null };
  container.innerHTML = "";
  container.scrollTop = 0;

  let mod;
  try {
    mod = await route.load();
  } catch (e) {
    console.error(`Falha ao carregar módulo "${name}"`, e);
    container.innerHTML = `<div class="empty-state"><div class="es-icon">⚠</div>
      <div class="es-title">Não foi possível carregar este módulo</div>
      <div class="es-desc">${String(e.message || e)}</div></div>`;
    return;
  }

  // rota pode ter mudado enquanto o módulo carregava
  const now = parseHash();
  if (now.name !== name || now.params.id !== params.id) return;

  const instance = mod.default || mod;
  current.module = instance;
  const wrap = document.createElement("div");
  wrap.className = "view-enter";
  wrap.style.minHeight = "100%";
  container.appendChild(wrap);
  try {
    await instance.mount(wrap, params);
  } catch (e) {
    console.error(`Erro ao montar "${name}"`, e);
    wrap.innerHTML = `<div class="empty-state"><div class="es-icon">⚠</div>
      <div class="es-title">Erro ao abrir</div><div class="es-desc">${String(e.message || e)}</div></div>`;
  }
  bus.emit("route:changed", { name, params });
}
