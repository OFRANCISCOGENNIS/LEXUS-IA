// ═══════════════ NEXUS · Shell (sidebar, temas, atalhos, breadcrumb) ═══════════════

import { bus } from "./core/bus.js";
import { navigate, parseHash } from "./core/router.js";
import {
  listPages, listDatabases, createPage, createDatabase, getPage, getDatabase,
  getSetting, setSetting, deletePage, duplicatePage, updatePage,
} from "./core/store.js";
import { h, isMac } from "./core/utils.js";
import { showMenu, toast, emojiPicker } from "./core/ui.js";

/* ── Tema / aparência ── */
export function applyAppearance() {
  const html = document.documentElement;
  const theme = getSetting("theme", "auto");
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  html.dataset.theme = dark ? "dark" : "light";
  html.dataset.accent = getSetting("accent", "iris");
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

  pagesTree.innerHTML = "";
  pages.slice(0, 60).forEach((p) =>
    pagesTree.appendChild(pageItem(p, route.name === "page" && route.params.id === p.id)));
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

  // nav ativa
  document.querySelectorAll(".sidebar [data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === route.name);
  });
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
    home: "Início", daily: "Notas diárias", graph: "Grafo", assistant: "Assistente IA",
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

  // seções recolhíveis
  document.querySelectorAll("[data-toggle-section]").forEach((btn) => {
    btn.onclick = () => btn.closest(".sidebar-section").classList.toggle("collapsed");
  });

  // navegação e ações
  document.querySelectorAll(".sidebar [data-nav]").forEach((el) => {
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

  // atalhos globais
  addEventListener("keydown", (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const inInput = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable;

    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); bus.emit("palette:open", {}); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); bus.emit("capture:open", {}); }
    else if (mod && e.key === "\\") { e.preventDefault(); setCollapsed(!app.classList.contains("sidebar-collapsed")); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); toggleTheme(); }
    else if (e.key === "?" && !inInput) { e.preventDefault(); bus.emit("shortcuts:open", {}); }
  });

  renderSidebar();
  renderBreadcrumb();
}
