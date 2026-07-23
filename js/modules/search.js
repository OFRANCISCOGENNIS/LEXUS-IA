// ═══════════════ NEXUS · Busca universal ═══════════════

import { searchAll, listPages, getSetting } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, debounce, highlightMatch, fmtRelative, escapeHtml, clamp } from "../core/utils.js";

const FILTERS = [
  ["all", "Tudo"], ["page", "Páginas"], ["database", "Databases"], ["row", "Linhas"],
];

let state = null;

export default {
  async mount(container, params) {
    state = { filter: "all", results: [], selected: 0, query: params.id || "" };

    const input = h("input", {
      class: "search-input", placeholder: "Busque em todo o workspace…",
      value: state.query, spellcheck: "false", autocomplete: "off",
    });
    const chipsRow = h("div", { class: "search-chips" });
    const resultsEl = h("div", { class: "search-results" });

    const wrap = h("div", { class: "page-container search" },
      h("div", { class: "search-hero" },
        h("span", { class: "search-glyph" }, "⌕"), input),
      chipsRow, resultsEl);
    container.appendChild(wrap);

    const run = () => {
      state.query = input.value.trim();
      state.results = state.query ? searchAll(state.query, { limit: 50 }) : [];
      state.selected = 0;
      paint(chipsRow, resultsEl);
    };
    input.addEventListener("input", debounce(run, 150));
    input.addEventListener("keydown", (e) => {
      const visible = visibleResults();
      if (e.key === "ArrowDown") { e.preventDefault(); state.selected = clamp(state.selected + 1, 0, visible.length - 1); paintSel(resultsEl); }
      else if (e.key === "ArrowUp") { e.preventDefault(); state.selected = clamp(state.selected - 1, 0, visible.length - 1); paintSel(resultsEl); }
      else if (e.key === "Enter") {
        const r = visible[state.selected];
        if (r) open(r);
      }
    });

    run();
    setTimeout(() => input.focus(), 60);
  },
  unmount() { state = null; },
};

const visibleResults = () =>
  state.filter === "all" ? state.results : state.results.filter((r) => r.kind === state.filter);

function open(r) {
  navigate(r.kind === "page" ? "page" : "db", r.id);
}

function paint(chipsRow, resultsEl) {
  // chips com contagem
  chipsRow.innerHTML = "";
  FILTERS.forEach(([key, label]) => {
    const count = key === "all" ? state.results.length : state.results.filter((r) => r.kind === key).length;
    chipsRow.appendChild(h("button", {
      class: "chip search-chip" + (state.filter === key ? " c-accent" : ""),
      onclick: () => { state.filter = key; state.selected = 0; paint(chipsRow, resultsEl); },
    }, `${label}${state.query ? ` · ${count}` : ""}`));
  });

  resultsEl.innerHTML = "";

  if (!state.query) {
    // recentes
    const rec = (getSetting("recentPages", []) || [])
      .map((id) => listPages().find((p) => p.id === id)).filter(Boolean).slice(0, 8);
    if (rec.length) {
      resultsEl.appendChild(h("div", { class: "home-section-title" }, "Recentes"));
      rec.forEach((p, i) => resultsEl.appendChild(resultCard({
        kind: "page", id: p.id, icon: p.icon || "▢", title: p.title || "Sem título",
        snippet: "", updatedAt: p.updatedAt,
      }, i)));
    } else {
      resultsEl.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "es-icon" }, "⌕"),
        h("div", { class: "es-desc" }, "Digite para buscar em páginas, databases e linhas — busca instantânea e 100% local.")));
    }
    return;
  }

  const visible = visibleResults();
  if (!visible.length) {
    resultsEl.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "∅"),
      h("div", { class: "es-title" }, `Nada para “${state.query}”`),
      h("div", { class: "es-desc" }, "Tente outros termos ou remova o filtro.")));
    return;
  }
  visible.forEach((r, i) => resultsEl.appendChild(resultCard(r, i)));
  paintSel(resultsEl);
}

function resultCard(r, i) {
  const kindLabel = { page: "Página", database: "Database", row: "Linha" }[r.kind] || r.kind;
  return h("button", {
    class: "search-result card hoverable",
    style: `animation-delay:${Math.min(i * 25, 300)}ms`,
    dataset: { idx: i },
    onclick: () => open(r),
  },
    h("span", { class: "sr-icon" }, r.icon || "▢"),
    h("div", { class: "sr-body" },
      h("div", { class: "sr-title", html: highlightMatch(r.title, state.query) }),
      r.snippet ? h("div", { class: "sr-snippet", html: highlightSnippet(r.snippet, state.query) }) : null),
    h("div", { class: "sr-side" },
      h("span", { class: "pi-kind" }, kindLabel),
      r.updatedAt ? h("span", { class: "sr-date" }, fmtRelative(r.updatedAt)) : null));
}

function highlightSnippet(snippet, query) {
  return highlightMatch(snippet, query);
}

function paintSel(resultsEl) {
  resultsEl.querySelectorAll(".search-result").forEach((el, i) => {
    el.classList.toggle("selected", i === state.selected);
  });
  resultsEl.querySelectorAll(".search-result")[state.selected]?.scrollIntoView({ block: "nearest" });
}
