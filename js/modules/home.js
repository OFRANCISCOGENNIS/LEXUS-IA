// ═══════════════ NEXUS · Home (visão geral do workspace) ═══════════════
// Painel montado por widgets que o usuário pode reordenar e ocultar. O layout
// fica em settings ("homeLayout"); sem nada salvo, usa a ordem padrão.

import { listPages, listDatabases, workspaceStats, getOrCreateDaily, getPage, getSetting, setSetting } from "../core/store.js";
import { estimateStorage } from "../core/db.js";
import { navigate } from "../core/router.js";
import { h, fmtRelative, stripHtml, todayKey } from "../core/utils.js";
import { isUnlocked } from "../core/privacy.js";
import { newPage, newDatabase } from "../shell.js";
import { collectTasks } from "./tasks.js";
import { toast } from "../core/ui.js";

/* ── Registro de widgets ───────────────────────────────────────────────
   Cada um devolve o conteúdo ou null quando não há o que mostrar (aí o
   widget some sozinho, sem deixar título órfão). */
const WIDGETS = [
  { id: "quick",     title: "Ações rápidas",  render: wQuick },
  { id: "tasks",     title: "Para hoje",      render: wTasks },
  { id: "recents",   title: "Recentes",       render: wRecents },
  { id: "databases", title: "Databases",      render: wDatabases },
  { id: "activity",  title: "Atividade",      render: wActivity },
  { id: "stats",     title: "Estatísticas",   render: wStats },
];
const DEFAULT_ORDER = WIDGETS.map((w) => w.id);

function loadLayout() {
  const saved = getSetting("homeLayout", null) || {};
  const hidden = new Set(saved.hidden || []);
  // ordem salva + widgets novos (que ainda não existiam quando o usuário salvou)
  const order = (saved.order || []).filter((id) => DEFAULT_ORDER.includes(id));
  DEFAULT_ORDER.forEach((id) => { if (!order.includes(id)) order.push(id); });
  return { order, hidden };
}
const saveLayout = (l) => setSetting("homeLayout", { order: l.order, hidden: [...l.hidden] });

let editing = false;

export default {
  async mount(container) {
    const wrap = h("div", { class: "page-container home" });
    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const hour = now.getHours();
    const saud = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

    const editBtn = h("button", { class: "btn ghost sm home-edit-btn" });
    const body = h("div", { class: "home-widgets" });

    const paint = () => {
      const layout = loadLayout();
      body.innerHTML = "";
      body.classList.toggle("editing", editing);
      editBtn.textContent = editing ? "✓ Concluir" : "⚙ Personalizar";

      layout.order.forEach((id, i) => {
        const def = WIDGETS.find((w) => w.id === id);
        if (!def) return;
        const isHidden = layout.hidden.has(id);
        if (isHidden && !editing) return;          // fora do modo editar, oculto some
        const content = isHidden ? null : def.render();
        if (!content && !editing) return;          // sem conteúdo → não mostra título vazio

        const sec = h("section", { class: "home-widget" + (isHidden ? " hidden" : ""), dataset: { widget: id } });
        const head = h("div", { class: "hw-head" }, h("h2", { class: "home-section-title" }, def.title));
        if (editing) {
          head.appendChild(h("div", { class: "hw-actions" },
            h("button", { class: "icon-btn", title: "Mover para cima", disabled: i === 0 || null,
              onclick: () => moveWidget(layout, id, -1, paint) }, "↑"),
            h("button", { class: "icon-btn", title: "Mover para baixo", disabled: i === layout.order.length - 1 || null,
              onclick: () => moveWidget(layout, id, +1, paint) }, "↓"),
            h("button", { class: "icon-btn", title: isHidden ? "Mostrar" : "Ocultar",
              onclick: () => { isHidden ? layout.hidden.delete(id) : layout.hidden.add(id); saveLayout(layout); paint(); } },
              isHidden ? "👁" : "🚫")));
        }
        sec.appendChild(head);
        if (content) sec.appendChild(content);
        else if (isHidden) sec.appendChild(h("div", { class: "hw-hidden-note" }, "Oculto no painel"));
        body.appendChild(sec);
      });

      if (editing) {
        body.appendChild(h("button", {
          class: "btn ghost sm", style: "align-self:flex-start",
          onclick: () => { setSetting("homeLayout", { order: DEFAULT_ORDER, hidden: [] }); toast("Painel restaurado"); paint(); },
        }, "↺ Restaurar padrão"));
      }
    };

    editBtn.onclick = () => { editing = !editing; paint(); };

    wrap.appendChild(h("div", { class: "home-hero" },
      h("p", { class: "home-date" }, dateStr[0].toUpperCase() + dateStr.slice(1)),
      h("div", { class: "home-hero-row" },
        h("h1", { class: "home-greeting" }, `${saud} 👋`),
        editBtn)));
    wrap.appendChild(body);
    paint();
    container.appendChild(wrap);
  },
  unmount() { editing = false; },
};

function moveWidget(layout, id, dir, paint) {
  const i = layout.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.order.length) return;
  [layout.order[i], layout.order[j]] = [layout.order[j], layout.order[i]];
  saveLayout(layout);
  paint();
}

/* ═══════════ Widgets ═══════════ */

function wQuick() {
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
  return qa;
}

/* Pendências de hoje + atrasadas, vindas de databases e checklists */
function wTasks() {
  const today = todayKey();
  const all = collectTasks().filter((t) => !t.done);
  const due = all.filter((t) => t.date && t.date <= today);
  const list = (due.length ? due : all).slice(0, 5);
  if (!list.length) return null;

  const card = h("div", { class: "card home-tasks" });
  list.forEach((t) => {
    const late = t.date && t.date < today;
    card.appendChild(h("button", {
      class: "home-task-row",
      onclick: () => t.source === "block" ? navigate("page", t.pageId) : navigate("db", t.dbId),
    },
      h("span", { class: "ht-box" }),
      h("span", { class: "ht-title" }, t.title),
      late ? h("span", { class: "chip c-red" }, "atrasada") : null,
      h("span", { class: "ht-origin" }, `${t.icon} ${t.origin}`)));
  });
  const rest = (due.length ? due : all).length - list.length;
  card.appendChild(h("button", { class: "home-task-more", onclick: () => navigate("tasks") },
    rest > 0 ? `ver todas (+${rest}) →` : "ver todas →"));
  return card;
}

function wRecents() {
  const recents = listPages().filter((p) => p.type !== "daily").slice(0, 6);
  if (!recents.length) return null;
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
  return grid;
}

function wDatabases() {
  const dbs = listDatabases();
  if (!dbs.length) return null;
  const grid = h("div", { class: "home-grid" });
  dbs.forEach((d, i) => grid.appendChild(h("button", {
    class: "card hoverable home-page-card", style: `animation-delay:${i * 35}ms`,
    onclick: () => navigate("db", d.id),
  },
    h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, d.icon || "▦"),
      h("span", { class: "hp-title" }, d.name)),
    h("div", { class: "hp-meta" }, `${d.rows.length} ${d.rows.length === 1 ? "registro" : "registros"} · ${d.views.length} visualizações`))));
  return grid;
}

function wActivity() {
  const perf = h("div", { class: "home-perf" });
  perf.appendChild(h("span", {}, "Atividade · 14 dias"));
  perf.appendChild(sparkline(activitySeries()));
  const storageEl = h("span", {}, "—");
  estimateStorage().then((est) => { if (est) storageEl.textContent = "⬇ " + fmtBytes(est.usage) + " em uso"; });
  perf.appendChild(storageEl);
  return perf;
}

function wStats() {
  const s = workspaceStats();
  const kpis = [
    [s.pages, "Páginas"], [s.words.toLocaleString("pt-BR"), "Palavras"],
    [s.databases, "Bancos de Dados"], [s.rows, "Registros"],
  ];
  const stats = h("div", { class: "home-stats" });
  kpis.forEach(([n, label]) => stats.appendChild(h("div", { class: "home-kpi" },
    h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label))));
  return stats;
}

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
