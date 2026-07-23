// ═══════════════ NEXUS · Home (dashboard) ═══════════════

import { listPages, listDatabases, workspaceStats, getOrCreateDaily } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, fmtRelative, escapeHtml, stripHtml } from "../core/utils.js";
import { newPage, newDatabase } from "../shell.js";

export default {
  async mount(container) {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 6 ? "Boa madrugada" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    const dateStr = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

    const wrap = h("div", { class: "page-container home" });

    wrap.appendChild(h("div", { class: "home-hero" },
      h("h1", { class: "home-greeting" }, greeting),
      h("p", { class: "home-date" }, dateStr[0].toUpperCase() + dateStr.slice(1))));

    // ações rápidas
    const actions = [
      { icon: "＋", title: "Nova página", desc: "Comece a escrever", run: () => newPage() },
      { icon: "▦", title: "Nova database", desc: "Tabela e kanban", run: () => newDatabase() },
      { icon: "☀", title: "Nota de hoje", desc: "Abra seu journal", run: () => { const p = getOrCreateDaily(); navigate("page", p.id); } },
      { icon: "✳", title: "Assistente IA", desc: "100% local e privado", run: () => navigate("assistant") },
    ];
    const qa = h("div", { class: "home-quick" });
    actions.forEach((a, i) => qa.appendChild(h("button", {
      class: "card hoverable home-quick-card", style: `animation-delay:${i * 40}ms`, onclick: a.run,
    },
      h("span", { class: "hq-icon" }, a.icon),
      h("span", { class: "hq-title" }, a.title),
      h("span", { class: "hq-desc" }, a.desc))));
    wrap.appendChild(qa);

    // retomar
    const recents = listPages().filter((p) => p.type !== "daily").slice(0, 6);
    if (recents.length) {
      wrap.appendChild(h("h2", { class: "home-section-title" }, "Retomar"));
      const grid = h("div", { class: "home-grid" });
      recents.forEach((p, i) => {
        const preview = stripHtml((p.blocks || []).map((b) => b.content).join(" ")).slice(0, 90);
        grid.appendChild(h("button", {
          class: "card hoverable home-page-card", style: `animation-delay:${i * 35}ms`,
          onclick: () => navigate("page", p.id),
        },
          h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, p.icon || "▢"),
            h("span", { class: "hp-title" }, p.title || "Sem título")),
          h("div", { class: "hp-preview" }, preview || "Página vazia"),
          h("div", { class: "hp-meta" }, "editado " + fmtRelative(p.updatedAt))));
      });
      wrap.appendChild(grid);
    }

    // databases
    const dbs = listDatabases();
    if (dbs.length) {
      wrap.appendChild(h("h2", { class: "home-section-title" }, "Databases"));
      const grid = h("div", { class: "home-grid" });
      dbs.forEach((d, i) => grid.appendChild(h("button", {
        class: "card hoverable home-page-card", style: `animation-delay:${i * 35}ms`,
        onclick: () => navigate("db", d.id),
      },
        h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, d.icon || "▦"),
          h("span", { class: "hp-title" }, d.name)),
        h("div", { class: "hp-meta" }, `${d.rows.length} ${d.rows.length === 1 ? "linha" : "linhas"} · ${d.views.length} views`))));
      wrap.appendChild(grid);
    }

    // estatísticas
    const s = workspaceStats();
    const kpis = [
      [s.pages, "páginas"], [s.words.toLocaleString("pt-BR"), "palavras"],
      [s.databases, "databases"], [s.rows, "linhas"],
    ];
    const stats = h("div", { class: "home-stats" });
    kpis.forEach(([n, label]) => stats.appendChild(h("div", { class: "home-kpi" },
      h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label))));
    wrap.appendChild(stats);

    container.appendChild(wrap);
  },
  unmount() {},
};
