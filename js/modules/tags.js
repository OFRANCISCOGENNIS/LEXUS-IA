// ═══════════════ NEXUS · Tags globais + coleções ═══════════════

import { listPages, pageText } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, fmtRelative, stripHtml } from "../core/utils.js";

let state = null;

export default {
  async mount(container, params) {
    state = { active: params.id || null, container };
    render();
  },
  unmount() { state = null; },
};

function allTags() {
  const counts = new Map();
  listPages().forEach((p) => (p.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function render() {
  const { container, active } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container tags" });
  wrap.appendChild(h("h1", { class: "home-greeting" }, "Tags & Coleções"));

  const tags = allTags();
  if (!tags.length) {
    wrap.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "🏷"),
      h("div", { class: "es-title" }, "Nenhuma tag ainda"),
      h("div", { class: "es-desc" }, "Adicione tags a uma página (no topo do editor) e elas aparecem aqui, com páginas de tag automáticas.")));
    container.appendChild(wrap);
    return;
  }

  // nuvem de tags
  const cloud = h("div", { class: "tag-cloud" });
  const max = Math.max(...tags.map((t) => t[1]));
  tags.forEach(([tag, count]) => {
    cloud.appendChild(h("button", {
      class: "tag-chip" + (tag === active ? " active" : ""),
      style: `font-size:${0.8 + (count / max) * 0.5}rem`,
      onclick: () => navigate("tags", tag),
    }, `#${tag}`, h("span", { class: "tag-count" }, String(count))));
  });
  wrap.appendChild(cloud);

  // coleções inteligentes (queries salvas)
  wrap.appendChild(h("h2", { class: "home-section-title", style: "margin-top:28px" }, "Coleções inteligentes"));
  const collections = h("div", { class: "home-grid" });
  smartCollections().forEach((c) => {
    collections.appendChild(h("button", { class: "card hoverable home-page-card", onclick: c.run },
      h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, c.icon), h("span", { class: "hp-title" }, c.name)),
      h("div", { class: "hp-meta" }, `${c.count()} páginas`)));
  });
  wrap.appendChild(collections);

  // páginas da tag ativa
  if (active) {
    const pages = listPages().filter((p) => (p.tags || []).includes(active));
    wrap.appendChild(h("h2", { class: "home-section-title", style: "margin-top:28px" }, `Páginas com #${active}`));
    const list = h("div", { class: "home-grid" });
    pages.forEach((p) => {
      const preview = stripHtml((p.blocks || []).map((b) => b.content).join(" ")).slice(0, 80);
      list.appendChild(h("button", { class: "card hoverable home-page-card", onclick: () => navigate("page", p.id) },
        h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, p.icon || "▢"), h("span", { class: "hp-title" }, p.title || "Sem título")),
        h("div", { class: "hp-preview" }, preview || "Documento em branco"),
        h("div", { class: "hp-meta" }, "editado " + fmtRelative(p.updatedAt))));
    });
    wrap.appendChild(list);
  }

  container.appendChild(wrap);
}

function smartCollections() {
  const weekAgo = Date.now() - 7 * 86400000;
  return [
    { icon: "🕒", name: "Modificadas esta semana", count: () => listPages().filter((p) => p.updatedAt >= weekAgo).length,
      run: () => showFiltered("Modificadas esta semana", (p) => p.updatedAt >= weekAgo) },
    { icon: "★", name: "Favoritas", count: () => listPages().filter((p) => p.favorite).length,
      run: () => showFiltered("Favoritas", (p) => p.favorite) },
    { icon: "📄", name: "Sem tags", count: () => listPages().filter((p) => !(p.tags || []).length && p.type !== "daily").length,
      run: () => showFiltered("Sem tags", (p) => !(p.tags || []).length && p.type !== "daily") },
    { icon: "✎", name: "Rascunhos curtos", count: () => listPages().filter((p) => pageText(p).length < 120).length,
      run: () => showFiltered("Rascunhos curtos", (p) => pageText(p).length < 120) },
  ];
}

function showFiltered(title, fn) {
  const { container } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container tags" });
  wrap.appendChild(h("button", { class: "btn ghost sm", style: "margin-bottom:12px", onclick: () => { state.active = null; render(); } }, "‹ Voltar"));
  wrap.appendChild(h("h1", { class: "home-greeting" }, title));
  const pages = listPages().filter(fn);
  const list = h("div", { class: "home-grid", style: "margin-top:16px" });
  if (!pages.length) list.appendChild(h("div", { class: "es-desc" }, "Nenhuma página nesta coleção."));
  pages.forEach((p) => {
    list.appendChild(h("button", { class: "card hoverable home-page-card", onclick: () => navigate("page", p.id) },
      h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, p.icon || "▢"), h("span", { class: "hp-title" }, p.title || "Sem título")),
      h("div", { class: "hp-meta" }, "editado " + fmtRelative(p.updatedAt))));
  });
  wrap.appendChild(list);
  container.appendChild(wrap);
}
