// ═══════════════ NEXUS · Home (visão geral do workspace) ═══════════════

import { listPages, listDatabases, workspaceStats, getOrCreateDaily, getPage } from "../core/store.js";
import { estimateStorage } from "../core/db.js";
import { navigate } from "../core/router.js";
import { h, fmtRelative, stripHtml } from "../core/utils.js";
import { isUnlocked } from "../core/privacy.js";
import { newPage, newDatabase } from "../shell.js";

export default {
  async mount(container) {
    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

    const wrap = h("div", { class: "page-container home" });

    const hour = now.getHours();
    const saud = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    wrap.appendChild(h("div", { class: "home-hero" },
      h("p", { class: "home-date" }, dateStr[0].toUpperCase() + dateStr.slice(1)),
      h("h1", { class: "home-greeting" }, `${saud} 👋`)));

    // ações principais
    const actions = [
      { icon: "🗎", title: "Nova Página", desc: "Criar um novo documento", run: () => newPage() },
      { icon: "▦", title: "Nova Database", desc: "Tabelas e kanban", run: () => newDatabase() },
      { icon: "☰", title: "Diário de Bordo", desc: "Acessar registro diário", run: () => { const p = getOrCreateDaily(); navigate("page", p.id); } },
    ];
    const qa = h("div", { class: "home-quick" });
    actions.forEach((a, i) => qa.appendChild(h("button", {
      class: "card hoverable home-quick-card", style: `animation-delay:${i * 40}ms`, onclick: a.run,
    },
      h("span", { class: "hq-icon" }, a.icon),
      h("span", { class: "hq-title" }, a.title),
      h("span", { class: "hq-desc" }, a.desc))));
    wrap.appendChild(qa);

    // documentos recentes
    const recents = listPages().filter((p) => p.type !== "daily").slice(0, 6);
    if (recents.length) {
      wrap.appendChild(h("h2", { class: "home-section-title" }, "Recentes"));
      const grid = h("div", { class: "home-grid" });
      recents.forEach((p, i) => {
        const isPriv = p.private && !isUnlocked();
        const preview = isPriv ? "🔒 Página privada" : stripHtml((p.blocks || []).map((b) => b.content).join(" ")).slice(0, 90);
        const parent = p.parentId ? getPage(p.parentId) : null;
        grid.appendChild(h("button", {
          class: "card hoverable home-page-card", style: `animation-delay:${i * 35}ms`,
          onclick: () => navigate("page", p.id),
        },
          h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, p.icon || "▢"),
            h("span", { class: "hp-title" }, p.title || "Sem título")),
          h("div", { class: "hp-preview" }, preview || "Documento em branco"),
          h("div", { class: "hp-meta" },
            parent ? `↳ em ${parent.icon ? parent.icon + " " : ""}${parent.title || "Sem título"} · ` : "",
            "editado " + fmtRelative(p.updatedAt))));
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
        h("div", { class: "hp-meta" }, `${d.rows.length} ${d.rows.length === 1 ? "registro" : "registros"} · ${d.views.length} visualizações`))));
      wrap.appendChild(grid);
    }

    // desempenho: atividade dos últimos 14 dias + armazenamento
    const perf = h("div", { class: "home-perf" });
    perf.appendChild(h("span", {}, "Atividade · 14 dias"));
    perf.appendChild(sparkline(activitySeries()));
    const storageEl = h("span", {}, "—");
    estimateStorage().then((est) => {
      if (est) storageEl.textContent = "⬇ " + fmtBytes(est.usage) + " em uso";
    });
    perf.appendChild(storageEl);
    wrap.appendChild(perf);

    // indicadores
    const s = workspaceStats();
    const kpis = [
      [s.pages, "Páginas"], [s.words.toLocaleString("pt-BR"), "Palavras"],
      [s.databases, "Bancos de Dados"], [s.rows, "Registros"],
    ];
    const stats = h("div", { class: "home-stats" });
    kpis.forEach(([n, label]) => stats.appendChild(h("div", { class: "home-kpi" },
      h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label))));
    wrap.appendChild(stats);

    container.appendChild(wrap);
  },
  unmount() {},
};

/* edições por dia nos últimos 14 dias (páginas + linhas de databases) */
function activitySeries() {
  const days = new Array(14).fill(0);
  const now = Date.now();
  const bucket = (ts) => {
    const d = Math.floor((now - ts) / 86400000);
    if (d >= 0 && d < 14) days[13 - d]++;
  };
  listPages({ includeArchived: true }).forEach((p) => bucket(p.updatedAt));
  listDatabases().forEach((db) => db.rows.forEach((r) => bucket(r.updatedAt)));
  return days;
}

function sparkline(data, w = 120, h_ = 26) {
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h_ - 3 - (v / max) * (h_ - 8)).toFixed(1)}`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", w); svg.setAttribute("height", h_);
  svg.setAttribute("viewBox", `0 0 ${w} ${h_}`);
  const area = document.createElementNS(svg.namespaceURI, "polygon");
  area.setAttribute("class", "hp-spark-area");
  area.setAttribute("points", `0,${h_} ` + pts.join(" ") + ` ${w},${h_}`);
  const line = document.createElementNS(svg.namespaceURI, "polyline");
  line.setAttribute("class", "hp-spark");
  line.setAttribute("points", pts.join(" "));
  svg.append(area, line);
  return svg;
}

function fmtBytes(b) {
  if (b > 1073741824) return (b / 1073741824).toFixed(2).replace(".", ",") + " GB";
  if (b > 1048576) return (b / 1048576).toFixed(1).replace(".", ",") + " MB";
  return Math.round(b / 1024) + " KB";
}
