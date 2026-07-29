// ═══════════════ NEXUS · Shell (sidebar, temas, atalhos, breadcrumb) ═══════════════

import { bus } from "./core/bus.js";
import { navigate, parseHash } from "./core/router.js";
import {
  listPages, listDatabases, createPage, createDatabase, getPage, getDatabase,
  getSetting, setSetting, deletePage, duplicatePage, updatePage, updateDatabase,
} from "./core/store.js";
import { h, isMac } from "./core/utils.js";
import { showMenu, toast, emojiPicker, promptDialog } from "./core/ui.js";

/* ── Tema / aparência ── */
export function applyAppearance() {
  const html = document.documentElement;
  const theme = getSetting("theme", "auto");
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  html.dataset.theme = dark ? "dark" : "light";
  html.dataset.accent = getSetting("accent", "slate");
  html.dataset.density = getSetting("density", "comfortable");
  html.dataset.font = getSetting("font", "sans");
  html.dataset.pagewidth = getSetting("pagewidth", "normal");
}

export function setTheme(theme) {
  const html = document.documentElement;
  html.classList.add("theme-transition");
  setSetting("theme", theme);
  applyAppearance();
  setTimeout(() => html.classList.remove("theme-transition"), 350);
}

export function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  setTheme(cur === "dark" ? "light" : "dark");
}

/* ── Sidebar ── */
function pageItem(p, active) {
  const el = h("button", {
    class: "sidebar-item" + (active ? " active" : ""),
    onclick: () => navigate("page", p.id),
  },
    h("span", { class: "si-icon" }, p.icon || "▢"),
    h("span", { class: "si-label" }, p.title || "Sem título"),
    h("span", { class: "si-actions" },
      h("button", {
        class: "icon-btn", style: "width:22px;height:22px", "aria-label": "Mais opções",
        onclick: (e) => {
          e.stopPropagation();
          showMenu(e.currentTarget, [
            { icon: "☺", title: "Ícone", action: () => emojiPicker(el, (emoji) => updatePage(p.id, { icon: emoji })) },
            { icon: p.favorite ? "★" : "☆", title: p.favorite ? "Remover dos favoritos" : "Favoritar", action: () => updatePage(p.id, { favorite: !p.favorite }) },
            { icon: "⧉", title: "Duplicar", action: () => { const c = duplicatePage(p.id); navigate("page", c.id); } },
            { sep: true },
            { icon: "🗑", title: "Mover para lixeira", danger: true, action: async () => { await deletePage(p.id); toast("Página movida para a lixeira"); const first = listPages()[0]; navigate(first ? "page" : "home", first?.id); } },
          ]);
        },
      }, "⋯")
    )
  );
  return el;
}

export function renderSidebar() {
  const route = parseHash();
  const pagesTree = document.getElementById("pages-tree");
  const dbsList = document.getElementById("dbs-list");
  const favSection = document.getElementById("section-favorites");
  const favList = document.getElementById("favorites-list");

  const pages = listPages().filter((p) => p.type !== "daily");
  const favs = pages.filter((p) => p.favorite);

  favSection.hidden = favs.length === 0;
  favList.innerHTML = "";
  favs.forEach((p) => favList.appendChild(pageItem(p, route.name === "page" && route.params.id === p.id)));

  // renderização em lotes: nenhuma página fica de fora, e listas enormes não
  // travam o primeiro paint — um sentinela carrega +80 conforme a barra rola
  pagesTree.innerHTML = "";
  const CHUNK = 80;
  let rendered = 0;
  const isActive = (p) => route.name === "page" && route.params.id === p.id;
  const renderChunk = () => {
    const frag = document.createDocumentFragment();
    pages.slice(rendered, rendered + CHUNK).forEach((p) => frag.appendChild(pageItem(p, isActive(p))));
    rendered = Math.min(rendered + CHUNK, pages.length);
    pagesTree.appendChild(frag);
    if (rendered < pages.length) {
      const sentinel = h("div", { style: "height:1px", dataset: { sentinel: "1" } });
      pagesTree.appendChild(sentinel);
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); sentinel.remove(); renderChunk(); }
      }, { root: document.querySelector(".sidebar-body"), rootMargin: "300px" });
      io.observe(sentinel);
    }
  };
  const dropSentinel = () => { if (pagesTree.lastElementChild?.dataset?.sentinel) pagesTree.lastElementChild.remove(); };
  renderChunk();
  // página ativa além do primeiro lote → garante que ela exista no DOM
  if (route.name === "page") {
    const idx = pages.findIndex((p) => p.id === route.params.id);
    while (idx >= rendered && rendered < pages.length) { dropSentinel(); renderChunk(); }
  }
  if (!pages.length)
    pagesTree.appendChild(h("div", { style: "padding:4px 10px;font-size:var(--fs-xs);color:var(--text-faint)" }, "Nenhuma página ainda"));

  dbsList.innerHTML = "";
  listDatabases().forEach((d) => {
    dbsList.appendChild(h("button", {
      class: "sidebar-item" + (route.name === "db" && route.params.id === d.id ? " active" : ""),
      onclick: () => navigate("db", d.id),
    },
      h("span", { class: "si-icon" }, d.icon || "▦"),
      h("span", { class: "si-label" }, d.name)
    ));
  });

  // nav ativa (sidebar + barra inferior)
  document.querySelectorAll(".sidebar [data-nav], .mobile-tabbar [data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === route.name);
  });
  // FAB só faz sentido em telas de navegação, não dentro do editor/db
  const fab = document.getElementById("mobile-fab");
  if (fab) fab.hidden = ["page", "db"].includes(route.name);
}

/* Gesto: deslizar da borda esquerda abre o drawer; deslizar sobre a sidebar fecha */
function setupSwipe(app, setDrawer) {
  let x0 = null, y0 = null, tracking = false;
  addEventListener("touchstart", (e) => {
    if (innerWidth > 720) return;
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY;
    const open = app.classList.contains("drawer-open");
    tracking = open || x0 < 24; // abre só a partir da borda
  }, { passive: true });
  addEventListener("touchend", (e) => {
    if (!tracking || x0 == null) { x0 = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx > 0) setDrawer(true); else setDrawer(false);
    }
    x0 = y0 = null; tracking = false;
  }, { passive: true });
}

/* ── Breadcrumb ── */
export function renderBreadcrumb() {
  const bc = document.getElementById("breadcrumb");
  const { name, params } = parseHash();
  bc.innerHTML = "";
  const crumb = (label, onclick) => {
    const c = h("button", { class: "crumb", onclick }, label);
    bc.appendChild(c);
    return c;
  };
  const sep = () => bc.appendChild(h("span", { class: "crumb-sep" }, "/"));

  const names = {
    home: "Início", daily: "Notas diárias", tasks: "Tarefas", calendar: "Calendário",
    productivity: "Produtividade", tags: "Tags", graph: "Grafo",
    settings: "Configurações", templates: "Templates", trash: "Lixeira", search: "Busca",
  };
  if (name === "page") {
    const p = getPage(params.id);
    crumb("Páginas", () => navigate("home"));
    sep();
    crumb((p?.icon ? p.icon + " " : "") + (p?.title || "Sem título"), () => {});
  } else if (name === "db") {
    const d = getDatabase(params.id);
    crumb("Databases", () => navigate("home"));
    sep();
    crumb((d?.icon ? d.icon + " " : "") + (d?.name || "Database"), () => {});
  } else {
    crumb(names[name] || "NEXUS", () => {});
  }
}

/* ── Ações globais ── */
export function newPage() {
  const p = createPage();
  navigate("page", p.id);
  return p;
}

export function newDatabase() {
  const d = createDatabase();
  navigate("db", d.id);
  return d;
}

/* ── Inicialização do shell ── */
export function initShell() {
  applyAppearance();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getSetting("theme", "auto") === "auto") applyAppearance();
  });

  const app = document.getElementById("app");

  // sidebar collapse
  const collapse = document.getElementById("sidebar-collapse");
  const expand = document.getElementById("sidebar-expand");
  const setCollapsed = (v) => {
    app.classList.toggle("sidebar-collapsed", v);
    expand.hidden = !v;
    setSetting("sidebarCollapsed", v);
  };
  collapse.onclick = () => setCollapsed(true);
  expand.onclick = () => setCollapsed(false);
  if (getSetting("sidebarCollapsed", false)) setCollapsed(true);

  // ── Drawer mobile ──
  const drawerToggle = document.getElementById("drawer-toggle");
  const drawerScrim = document.getElementById("drawer-scrim");
  const setDrawer = (v) => app.classList.toggle("drawer-open", v);
  drawerToggle?.addEventListener("click", () => setDrawer(!app.classList.contains("drawer-open")));
  drawerScrim?.addEventListener("click", () => setDrawer(false));
  document.getElementById("mtab-menu")?.addEventListener("click", () => setDrawer(!app.classList.contains("drawer-open")));
  // fecha o drawer ao navegar (no mobile a sidebar sobrepõe o conteúdo)
  bus.on("route:changed", () => setDrawer(false));

  // gesto de deslizar para abrir/fechar o drawer
  setupSwipe(app, setDrawer);

  // seções recolhíveis
  document.querySelectorAll("[data-toggle-section]").forEach((btn) => {
    btn.onclick = () => btn.closest(".sidebar-section").classList.toggle("collapsed");
  });

  // navegação e ações (sidebar + barra inferior mobile)
  document.querySelectorAll(".sidebar [data-nav], .mobile-tabbar [data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => {
      const a = el.dataset.action;
      if (a === "new-page") newPage();
      else if (a === "new-database") newDatabase();
      else if (a === "open-palette") bus.emit("palette:open", {});
      else if (a === "quick-capture") bus.emit("capture:open", {});
    });
  });

  // re-render reativo
  bus.on("pages:changed", () => { renderSidebar(); renderBreadcrumb(); });
  bus.on("dbs:changed", () => { renderSidebar(); renderBreadcrumb(); });
  bus.on("route:changed", () => { renderSidebar(); renderBreadcrumb(); });
  bus.on("settings:changed", ({ key }) => {
    if (["theme", "accent", "density", "font", "pagewidth"].includes(key)) applyAppearance();
  });

  // atalhos globais (estilo Windows)
  addEventListener("keydown", (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const inInput = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable;
    const k = e.key.toLowerCase();

    // ── Ctrl + tecla ──
    if (mod && !e.shiftKey && !e.altKey && k === "k") { e.preventDefault(); bus.emit("palette:open", {}); }
    else if (mod && e.shiftKey && k === "n") { e.preventDefault(); bus.emit("capture:open", {}); }
    else if (mod && e.key === "\\") { e.preventDefault(); setCollapsed(!app.classList.contains("sidebar-collapsed")); }
    else if (mod && e.shiftKey && k === "l") { e.preventDefault(); toggleTheme(); }
    else if (mod && e.shiftKey && k === "f") { e.preventDefault(); navigate("search"); }   // localizar (busca completa)
    else if (mod && !e.shiftKey && k === "f") { e.preventDefault(); navigate("search"); }    // Ctrl+F localizar
    else if (mod && k === "p") { e.preventDefault(); window.print(); }                        // imprimir / exportar PDF
    else if (mod && k === "s") { e.preventDefault(); toast("Tudo salvo — 100% local ✓", { duration: 1400 }); } // Ctrl+S
    else if (mod && (e.key === "," )) { e.preventDefault(); navigate("settings"); }           // Ctrl+, configurações
    // ── Alt + tecla (navegação estilo Explorer/navegador) ──
    else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); history.back(); }
    else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); history.forward(); }
    else if (e.altKey && e.key === "Home") { e.preventDefault(); navigate("home"); }
    else if (e.altKey && !inInput && /^[1-9]$/.test(e.key)) { e.preventDefault(); jumpToSection(+e.key); }
    // ── Teclas de função ──
    else if (e.key === "F1") { e.preventDefault(); bus.emit("shortcuts:open", {}); }
    else if (e.key === "F2" && !inInput) { e.preventDefault(); renameCurrent(); }
    else if (e.key === "?" && !inInput) { e.preventDefault(); bus.emit("shortcuts:open", {}); }
  });

  renderSidebar();
  renderBreadcrumb();
}

/* Alt+1..9 → salta para as seções principais (como Ctrl+1..9 nas abas do Windows) */
const SECTIONS = ["home", "tasks", "calendar", "productivity", "tags", "graph", "templates", "settings", "trash"];
function jumpToSection(n) {
  const route = SECTIONS[n - 1];
  if (route) navigate(route);
}

/* F2 → renomeia a página ou database atual */
async function renameCurrent() {
  const { name, params } = parseHash();
  if (name === "page" && params.id) {
    const p = getPage(params.id);
    if (!p) return;
    const title = await promptDialog({ title: "Renomear página", value: p.title || "" });
    if (title != null) { updatePage(p.id, { title }); }
  } else if (name === "db" && params.id) {
    const d = getDatabase(params.id);
    if (!d) return;
    const nm = await promptDialog({ title: "Renomear database", value: d.name || "" });
    if (nm != null) { updateDatabase(d.id, { name: nm }); }
  } else {
    toast("Abra uma página ou database para renomear (F2)", { type: "warn" });
  }
}
