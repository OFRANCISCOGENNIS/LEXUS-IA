// ═══════════════ NEXUS · Shell (sidebar, temas, atalhos, breadcrumb) ═══════════════

import { bus } from "./core/bus.js";
import { navigate, parseHash } from "./core/router.js";
import {
  listPages, listDatabases, createPage, createDatabase, getPage, getDatabase,
  getSetting, setSetting, deletePage, duplicatePage, updatePage, updateDatabase,
  pageDescendants,
} from "./core/store.js";
import { h, isMac, debounce } from "./core/utils.js";
import { showMenu, toast, emojiPicker, promptDialog, confirmDialog } from "./core/ui.js";
import * as sync from "./core/sync.js";

/* ── Tema / aparência ── */
export function applyAppearance() {
  const html = document.documentElement;
  const theme = getSetting("theme", "auto");
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  html.dataset.theme = dark ? "dark" : "light";
  html.dataset.accent = getSetting("accent", "violet");
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

/* ── Sidebar: árvore de páginas (páginas dentro de páginas) ── */
let expandedPages = null; // Set<pageId> — lazy, persistido (sem disparar sync)
function ensureExpandedLoaded() {
  if (!expandedPages) expandedPages = new Set(getSetting("sidebarExpanded", []) || []);
}
const persistExpanded = debounce(() => setSetting("sidebarExpanded", [...expandedPages]), 400);
function setExpanded(id, open) {
  ensureExpandedLoaded();
  open ? expandedPages.add(id) : expandedPages.delete(id);
  persistExpanded();
}

/* cria uma sub-página dentro de `parentId` e navega para ela */
function newSubpage(parentId) {
  ensureExpandedLoaded();
  expandedPages.add(parentId);
  const p = createPage({ parentId });
  navigate("page", p.id);
  return p;
}

function pageItem(p, active, { depth = 0, hasChildren = false, expanded = false, flat = false } = {}) {
  const caret = hasChildren
    ? h("span", {
        class: "si-caret" + (expanded ? " open" : ""),
        onclick: (e) => { e.stopPropagation(); e.preventDefault(); setExpanded(p.id, !expanded); renderSidebar(); },
      }, "▸")
    : h("span", { class: "si-caret empty" });

  const el = h("button", {
    class: "sidebar-item page-tree-item" + (active ? " active" : ""),
    style: flat ? "" : `padding-left: calc(var(--sp-2) + ${depth * 16}px)`,
    onclick: () => navigate("page", p.id),
  },
    flat ? null : caret,
    h("span", { class: "si-icon" }, p.icon || "▢"),
    h("span", { class: "si-label" }, p.title || "Sem título"),
    h("span", { class: "si-actions" },
      h("button", {
        class: "icon-btn", style: "width:22px;height:22px", "aria-label": "Nova sub-página", title: "Nova sub-página",
        onclick: (e) => { e.stopPropagation(); newSubpage(p.id); },
      }, "＋"),
      h("button", {
        class: "icon-btn", style: "width:22px;height:22px", "aria-label": "Mais opções",
        onclick: (e) => {
          e.stopPropagation();
          showMenu(e.currentTarget, [
            { icon: "☺", title: "Ícone", action: () => emojiPicker(el, (emoji) => updatePage(p.id, { icon: emoji })) },
            { icon: "＋", title: "Nova sub-página", action: () => newSubpage(p.id) },
            { icon: p.favorite ? "★" : "☆", title: p.favorite ? "Remover dos favoritos" : "Favoritar", action: () => updatePage(p.id, { favorite: !p.favorite }) },
            { icon: "⧉", title: "Duplicar", action: () => { const c = duplicatePage(p.id); navigate("page", c.id); } },
            { sep: true },
            { icon: "🗑", title: "Mover para lixeira", danger: true, action: () => deletePageWithConfirm(p) },
          ]);
        },
      }, "⋯")
    )
  );
  return el;
}

/* pede confirmação quando há sub-páginas, pois elas vão junto para a lixeira */
async function deletePageWithConfirm(p) {
  const kids = pageDescendants(p.id);
  if (kids.length) {
    const ok = await confirmDialog({
      title: "Mover para a lixeira?",
      message: `“${p.title || "Sem título"}” tem ${kids.length} sub-página${kids.length > 1 ? "s" : ""} — elas também irão para a lixeira. Você pode restaurar tudo depois.`,
      confirmText: "Mover", danger: true,
    });
    if (!ok) return;
  }
  await deletePage(p.id);
  toast(kids.length ? `Página e ${kids.length} sub-página${kids.length > 1 ? "s" : ""} movidas para a lixeira` : "Página movida para a lixeira");
  const active = parseHash();
  if (active.name === "page" && (active.params.id === p.id || kids.includes(active.params.id))) {
    const first = listPages()[0];
    navigate(first ? "page" : "home", first?.id);
  }
}

export function renderSidebar() {
  ensureExpandedLoaded();
  const route = parseHash();
  const pagesTree = document.getElementById("pages-tree");
  const dbsList = document.getElementById("dbs-list");
  const favSection = document.getElementById("section-favorites");
  const favList = document.getElementById("favorites-list");

  const pages = listPages().filter((p) => p.type !== "daily");
  const favs = pages.filter((p) => p.favorite);

  favSection.hidden = favs.length === 0;
  favList.innerHTML = "";
  favs.forEach((p) => favList.appendChild(pageItem(p, route.name === "page" && route.params.id === p.id, { flat: true })));

  // ── monta a árvore: pai → filhos. Página cujo parentId não existe mais
  // nesta lista (ex.: pai é uma daily note, ou virou órfã) vira raiz, para
  // nunca "desaparecer" da barra. ──
  const byId = new Map(pages.map((p) => [p.id, p]));
  const childrenOf = new Map();
  pages.forEach((p) => {
    const parent = p.parentId && byId.has(p.parentId) ? p.parentId : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(p);
  });
  const roots = childrenOf.get(null) || [];

  // expande automaticamente os ancestrais da página ativa, para ela nunca
  // ficar escondida dentro de um ramo recolhido
  if (route.name === "page") {
    let cur = byId.get(route.params.id);
    while (cur?.parentId && byId.has(cur.parentId)) {
      expandedPages.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }

  // achata a árvore (respeitando o que está expandido) em ordem de exibição
  const flat = [];
  const pushTree = (p, depth) => {
    flat.push({ p, depth, hasChildren: (childrenOf.get(p.id) || []).length > 0 });
    if (expandedPages.has(p.id)) (childrenOf.get(p.id) || []).forEach((c) => pushTree(c, depth + 1));
  };
  roots.forEach((p) => pushTree(p, 0));

  const isActive = (p) => route.name === "page" && route.params.id === p.id;

  // renderização em lotes: listas enormes não travam o primeiro paint —
  // um sentinela carrega +80 linhas visíveis conforme a barra rola
  pagesTree.innerHTML = "";
  const CHUNK = 80;
  let rendered = 0;
  const renderChunk = () => {
    const frag = document.createDocumentFragment();
    flat.slice(rendered, rendered + CHUNK).forEach(({ p, depth, hasChildren }) =>
      frag.appendChild(pageItem(p, isActive(p), { depth, hasChildren, expanded: expandedPages.has(p.id) })));
    rendered = Math.min(rendered + CHUNK, flat.length);
    pagesTree.appendChild(frag);
    if (rendered < flat.length) {
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
    const idx = flat.findIndex(({ p }) => p.id === route.params.id);
    while (idx >= rendered && rendered < flat.length) { dropSentinel(); renderChunk(); }
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

  // badge de tarefas pendentes (redesign): checklists não concluídos das páginas
  const badge = document.getElementById("nav-tasks-badge");
  if (badge) {
    let pend = 0, scanned = 0;
    const walk = (bs) => {
      for (const b of bs) {
        if (++scanned > 4000) return; // teto de varredura — o badge é informativo
        if (b.type === "todo" && !b.props?.checked) pend++;
        if (b.children?.length) walk(b.children);
      }
    };
    for (const p of listPages()) { walk(p.blocks || []); if (scanned > 4000) break; }
    badge.hidden = pend === 0;
    badge.textContent = pend > 99 ? "99+" : String(pend);
  }
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
      else if (a === "open-sync-settings") { setDrawer(false); navigate("settings"); }
    });
  });

  // alternância de tema no header (redesign): 🌙 no claro, ☀️ no escuro
  const themeBtn = document.getElementById("theme-toggle");
  const paintThemeBtn = () => {
    if (themeBtn) themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙";
  };
  themeBtn?.addEventListener("click", () => toggleTheme());
  paintThemeBtn();

  // ── Sincronização: o selo "100% local" da barra lateral reflete o status
  // real e leva às Configurações — sync continua opcional, mas descobrível. ──
  const syncBadge = document.getElementById("sidebar-sync-badge");
  const paintSyncBadge = () => {
    if (!syncBadge) return;
    const st = sync.syncState();
    syncBadge.classList.remove("sb-off", "sb-ready", "sb-syncing", "sb-error", "sb-locked");
    let text;
    if (!st.configured) {
      text = "🔒 100% local — sincronizar entre dispositivos →";
      syncBadge.classList.add("sb-off");
    } else if (st.status === "off") {
      text = "🔒 100% local — entrar / criar conta →";
      syncBadge.classList.add("sb-off");
    } else if (st.status === "locked") {
      text = "🔐 Sincronização bloqueada — toque para desbloquear";
      syncBadge.classList.add("sb-locked");
    } else if (st.status === "syncing") {
      text = "☁ Sincronizando…";
      syncBadge.classList.add("sb-syncing");
    } else if (st.status === "error") {
      text = "⚠ Erro de sincronização — toque para ver";
      syncBadge.classList.add("sb-error");
    } else {
      text = `☁ Sincronizado${st.user?.email ? " · " + st.user.email : ""}`;
      syncBadge.classList.add("sb-ready");
    }
    syncBadge.innerHTML = "";
    syncBadge.append(h("span", { class: "lb-dot" }), h("span", {}, text));
  };
  bus.on("sync:status", paintSyncBadge);
  paintSyncBadge();

  // re-render reativo
  bus.on("pages:changed", () => { renderSidebar(); renderBreadcrumb(); });
  bus.on("dbs:changed", () => { renderSidebar(); renderBreadcrumb(); });
  bus.on("route:changed", () => { renderSidebar(); renderBreadcrumb(); });
  bus.on("settings:changed", ({ key }) => {
    if (["theme", "accent", "density", "font", "pagewidth"].includes(key)) { applyAppearance(); paintThemeBtn(); }
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
