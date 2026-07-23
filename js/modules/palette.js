// ═══════════════ NEXUS · Command palette (⌘K) + captura rápida + atalhos ═══════════════

import { bus } from "../core/bus.js";
import { navigate, parseHash } from "../core/router.js";
import {
  listPages, listDatabases, createPage, createDatabase, searchAll,
  getOrCreateDaily, makeBlock, getSetting, setSetting,
} from "../core/store.js";
import { h, fuzzyScore, highlightMatch, escapeHtml, modKey } from "../core/utils.js";
import { toast, showModal } from "../core/ui.js";
import { newPage, newDatabase, setTheme, toggleTheme } from "../shell.js";

let paletteEl = null;

/* Comandos estáticos */
function commands() {
  return [
    { icon: "＋", title: "Nova página", kind: "Ação", kbd: "", run: () => newPage() },
    { icon: "▦", title: "Nova database", kind: "Ação", run: () => newDatabase() },
    { icon: "☀", title: "Abrir nota de hoje", kind: "Ação", run: () => { getOrCreateDaily(); navigate("daily"); } },
    { icon: "✳", title: "Abrir assistente IA", kind: "IA", run: () => navigate("assistant") },
    { icon: "◉", title: "Ver grafo de conhecimento", kind: "Navegar", run: () => navigate("graph") },
    { icon: "▤", title: "Galeria de templates", kind: "Navegar", run: () => navigate("templates") },
    { icon: "⚙", title: "Configurações", kind: "Navegar", run: () => navigate("settings") },
    { icon: "🗑", title: "Abrir lixeira", kind: "Navegar", run: () => navigate("trash") },
    { icon: "◐", title: "Alternar tema claro/escuro", kind: "Tema", kbd: "⌘⇧L", run: () => toggleTheme() },
    { icon: "☀", title: "Tema claro", kind: "Tema", run: () => setTheme("light") },
    { icon: "☾", title: "Tema escuro", kind: "Tema", run: () => setTheme("dark") },
    { icon: "◑", title: "Tema automático (sistema)", kind: "Tema", run: () => setTheme("auto") },
    { icon: "⌨", title: "Atalhos de teclado", kind: "Ajuda", kbd: "?", run: () => showShortcuts() },
  ];
}

export function initPalette() {
  bus.on("palette:open", openPalette);
  bus.on("capture:open", openQuickCapture);
  bus.on("shortcuts:open", showShortcuts);
}

export function openPalette() {
  if (paletteEl) { closePalette(); return; }
  const scrim = h("div", { class: "scrim", style: "background:transparent" });
  const input = h("input", {
    class: "palette-input", placeholder: "Buscar páginas, comandos, databases…",
    autocomplete: "off", spellcheck: "false",
  });
  const list = h("div", { class: "palette-list" });
  const pal = h("div", { class: "palette", role: "dialog", "aria-label": "Command palette" },
    h("div", { class: "palette-input-row" }, h("span", { class: "palette-glyph" }, "⌕"), input),
    list,
    h("div", { class: "palette-foot" },
      h("span", {}, "↑↓ navegar"),
      h("span", {}, "↵ abrir"),
      h("span", {}, "esc fechar"),
      h("span", { style: "margin-left:auto;color:var(--accent-text)" }, "100% local"))
  );
  paletteEl = h("div", {}, scrim, pal);
  document.getElementById("overlay-root").appendChild(paletteEl);

  let selected = 0;
  let items = [];

  const render = (query) => {
    items = buildResults(query);
    selected = 0;
    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(h("div", { class: "palette-empty" }, "Nada encontrado para “" + query + "”"));
      return;
    }
    items.forEach((item, i) => {
      const el = h("button", {
        class: "palette-item" + (i === selected ? " selected" : ""),
        style: `animation-delay:${Math.min(i * 20, 200)}ms`,
        onclick: () => execute(item),
        onmousemove: () => { if (selected !== i) { selected = i; paint(); } },
      },
        h("i", { class: "pi-icon" }, item.icon || "▢"),
        h("div", { class: "pi-body" },
          h("div", { class: "pi-title", html: item.titleHtml || escapeHtml(item.title) }),
          item.sub ? h("div", { class: "pi-sub" }, item.sub) : null),
        item.kbd ? h("kbd", { class: "mi-kbd" }, item.kbd) : null,
        h("span", { class: "pi-kind" }, item.kind)
      );
      list.appendChild(el);
    });
  };
  const paint = () => {
    [...list.querySelectorAll(".palette-item")].forEach((el, i) => {
      el.classList.toggle("selected", i === selected);
    });
  };
  const execute = (item) => {
    closePalette();
    item.run();
  };

  input.addEventListener("input", () => render(input.value.trim()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, items.length - 1); paint(); scrollSel(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(selected - 1, 0); paint(); scrollSel(); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[selected]) execute(items[selected]); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });
  const scrollSel = () => list.querySelectorAll(".palette-item")[selected]?.scrollIntoView({ block: "nearest" });

  scrim.addEventListener("pointerdown", closePalette);
  render("");
  input.focus();
}

function buildResults(query) {
  const out = [];
  const recents = getSetting("recentPages", []);

  if (!query) {
    // recentes + comandos principais
    const recentPages = recents.map((id) => listPages().find((p) => p.id === id)).filter(Boolean).slice(0, 4);
    recentPages.forEach((p) => out.push({
      icon: p.icon || "▢", title: p.title || "Sem título", kind: "Recente",
      run: () => navigate("page", p.id),
    }));
    listPages().slice(0, 5).forEach((p) => {
      if (!recentPages.includes(p)) out.push({
        icon: p.icon || "▢", title: p.title || "Sem título", kind: "Página",
        run: () => navigate("page", p.id),
      });
    });
    out.push(...commands().slice(0, 8));
    return out.slice(0, 12);
  }

  // comandos com fuzzy
  commands().forEach((c) => {
    const s = fuzzyScore(query, c.title);
    if (s >= 0) out.push({ ...c, score: s + 10 });
  });

  // conteúdo
  searchAll(query, { limit: 12 }).forEach((r) => {
    out.push({
      icon: r.icon, title: r.title,
      titleHtml: highlightMatch(r.title, query),
      sub: r.snippet, kind: r.kind === "page" ? "Página" : r.kind === "database" ? "Database" : "Linha",
      score: r.score,
      run: () => navigate(r.kind === "page" ? "page" : "db", r.id),
    });
  });

  // criação rápida
  out.push({
    icon: "＋", title: `Criar página “${query}”`, kind: "Ação", score: -5,
    run: () => { const p = createPage({ title: query }); navigate("page", p.id); },
  });
  out.push({
    icon: "⌕", title: `Busca completa por “${query}”`, kind: "Ação", score: -6,
    run: () => navigate("search", query),
  });

  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 14);
}

export function closePalette() {
  if (!paletteEl) return;
  const pal = paletteEl.querySelector(".palette");
  pal?.classList.add("leaving");
  const el = paletteEl;
  paletteEl = null;
  setTimeout(() => el.remove(), 140);
}

/* Rastreia páginas recentes */
bus.on("route:changed", ({ name, params }) => {
  if (name === "page" && params.id) {
    const rec = (getSetting("recentPages", []) || []).filter((x) => x !== params.id);
    rec.unshift(params.id);
    setSetting("recentPages", rec.slice(0, 8));
  }
});

/* ── Captura rápida ── */
function openQuickCapture() {
  const input = h("textarea", {
    class: "textarea", rows: 4,
    placeholder: "Anote qualquer coisa… vai para a sua Inbox.",
    style: "border:none;box-shadow:none;background:transparent;font-size:var(--fs-md);padding:0;min-height:96px",
  });
  const save = h("button", { class: "btn primary" }, "Capturar  ⌘↵");
  const m = showModal({
    title: "✦ Captura rápida",
    body: h("div", {}, input),
    footer: [save],
    width: 480,
  });
  const doSave = () => {
    const text = input.value.trim();
    if (!text) { m.close(); return; }
    let inbox = listPages().find((p) => p.title === "📥 Inbox");
    if (!inbox) inbox = createPage({ title: "📥 Inbox", icon: "📥" });
    const lines = text.split("\n").filter(Boolean);
    lines.forEach((l) => inbox.blocks.push(makeBlock("bulleted",
      escapeHtml(l) + ` <span style="color:var(--text-faint)">· ${new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>`)));
    import("../core/store.js").then(({ touchPageBlocks }) => touchPageBlocks(inbox.id));
    m.close();
    toast("Capturado na Inbox ✦");
  };
  save.onclick = doSave;
  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doSave(); }
  });
  setTimeout(() => input.focus(), 50);
}

/* ── Folha de atalhos ── */
function showShortcuts() {
  const rows = [
    ["Command palette", `${modKey} K`],
    ["Captura rápida", `${modKey} ⇧ N`],
    ["Alternar sidebar", `${modKey} \\`],
    ["Alternar tema", `${modKey} ⇧ L`],
    ["Blocos: menu slash", "/"],
    ["Wiki-link", "[["],
    ["Duplicar bloco", `${modKey} D`],
    ["Mover bloco", `${modKey} ⇧ ↑↓`],
    ["Negrito / Itálico", `${modKey} B · ${modKey} I`],
    ["Esta folha", "?"],
  ];
  const body = h("div", { style: "display:grid;grid-template-columns:1fr auto;gap:8px 24px;padding:4px 0 12px" });
  rows.forEach(([label, keys]) => {
    body.appendChild(h("span", { style: "font-size:var(--fs-sm);color:var(--text-2)" }, label));
    body.appendChild(h("kbd", {}, keys));
  });
  showModal({ title: "Atalhos de teclado", body, width: 420 });
}
