// ═══════════════ NEXUS · Calendário (agrega todas as datas do workspace) ═══════════════
// Junta prazos das databases + notas diárias + lembretes num calendário unificado.

import { listDatabases, listPages } from "../core/store.js";
import { listReminders } from "../core/reminders.js";
import { navigate } from "../core/router.js";
import { h, todayKey } from "../core/utils.js";

const CHIP = { gray: "215 12% 55%", slate: "215 28% 50%", blue: "214 84% 56%", green: "148 55% 46%", amber: "36 90% 52%", red: "4 74% 57%", purple: "268 60% 58%", teal: "176 62% 44%" };
const col = (c) => `hsl(${CHIP[c] || CHIP.slate})`;

let month = null;
let mode = "month"; // month | agenda

export default {
  async mount(container) {
    if (!month) month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    render(container);
  },
  unmount() {},
};

/* coleta { "YYYY-MM-DD": [ {title, color, kind, go} ] } */
function collectEvents() {
  const map = new Map();
  const add = (date, ev) => { if (!date) return; if (!map.has(date)) map.set(date, []); map.get(date).push(ev); };

  listDatabases().forEach((db) => {
    const dateProps = db.properties.filter((p) => p.type === "date");
    if (!dateProps.length) return;
    const selProp = db.properties.find((p) => p.type === "select");
    db.rows.forEach((r) => {
      dateProps.forEach((dp) => {
        const d = r.values[dp.id];
        if (!d) return;
        const opt = selProp && selProp.options?.find((o) => o.id === r.values[selProp.id]);
        add(d, { title: r.values.title || "Sem nome", color: opt?.color || "slate", kind: db.icon || "▦", go: () => navigate("db", db.id) });
      });
    });
  });

  listPages({ includeArchived: false }).forEach((p) => {
    if (p.type === "daily" && p.journalDate) add(p.journalDate, { title: "Nota do dia", color: "amber", kind: "☀", go: () => navigate("page", p.id) });
  });

  listReminders().forEach((r) => {
    if (r.done) return;
    add(todayKey(new Date(r.at)), { title: r.title, color: "purple", kind: "⏰", go: () => navigate("productivity") });
  });

  return map;
}

function render(container) {
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container calendar-page" });
  const events = collectEvents();

  const monthLabel = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const head = h("div", { class: "calp-head" },
    h("h1", { class: "home-greeting" }, monthLabel[0].toUpperCase() + monthLabel.slice(1)),
    h("div", { class: "calp-controls" },
      h("button", { class: "icon-btn", "aria-label": "Mês anterior", onclick: () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); render(container); } }, "‹"),
      h("button", { class: "btn ghost sm", onclick: () => { month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(container); } }, "Hoje"),
      h("button", { class: "icon-btn", "aria-label": "Próximo mês", onclick: () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); render(container); } }, "›"),
      h("span", { class: "calp-sep" }),
      segBtn("month", "Mês", container), segBtn("agenda", "Agenda", container)));
  wrap.appendChild(head);

  // legenda
  wrap.appendChild(h("div", { class: "calp-legend" },
    legendItem("blue", "Databases"), legendItem("amber", "Notas diárias"), legendItem("purple", "Lembretes")));

  if (mode === "agenda") wrap.appendChild(renderAgenda(events));
  else wrap.appendChild(renderMonth(events, container));

  container.appendChild(wrap);
}

function segBtn(m, label, container) {
  return h("button", { class: "calp-seg" + (mode === m ? " on" : ""), onclick: () => { mode = m; render(container); } }, label);
}
function legendItem(c, label) {
  return h("span", { class: "calp-leg" }, h("span", { class: "cl-dot", style: `background:${col(c)}` }), label);
}

function renderMonth(events, container) {
  const grid = h("div", { class: "calp-grid" });
  ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach((d) => grid.appendChild(h("div", { class: "calp-dow" }, d)));
  const pad = month.getDay();
  for (let i = 0; i < pad; i++) grid.appendChild(h("div", { class: "calp-cell empty" }));
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const todayK = todayKey();
  for (let day = 1; day <= days; day++) {
    const key = todayKey(new Date(month.getFullYear(), month.getMonth(), day));
    const list = events.get(key) || [];
    const cell = h("div", { class: "calp-cell" + (key === todayK ? " today" : "") },
      h("div", { class: "calp-daynum" }, String(day)));
    list.slice(0, 4).forEach((ev) => cell.appendChild(
      h("button", { class: "calp-event", style: `--evc:${col(ev.color)}`, title: ev.title, onclick: ev.go },
        h("span", { class: "ce-dot" }), h("span", { class: "ce-t" }, ev.title))));
    if (list.length > 4) cell.appendChild(h("div", { class: "calp-more" }, `+${list.length - 4}`));
    grid.appendChild(cell);
  }
  return grid;
}

function renderAgenda(events) {
  const wrap = h("div", { class: "calp-agenda" });
  const y = month.getFullYear(), m = month.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  let any = false;
  for (let day = 1; day <= days; day++) {
    const d = new Date(y, m, day);
    const key = todayKey(d);
    const list = events.get(key);
    if (!list?.length) continue;
    any = true;
    wrap.appendChild(h("div", { class: "agenda-row" },
      h("div", { class: "agenda-date" },
        h("div", { class: "ad-day" }, String(day)),
        h("div", { class: "ad-dow" }, d.toLocaleDateString("pt-BR", { weekday: "short" }))),
      h("div", { class: "agenda-events" },
        ...list.map((ev) => h("button", { class: "agenda-ev", onclick: ev.go },
          h("span", { class: "ce-dot", style: `background:${col(ev.color)}` }),
          h("span", { class: "ae-kind" }, ev.kind),
          h("span", {}, ev.title))))));
  }
  if (!any) wrap.appendChild(h("div", { class: "empty-state" },
    h("div", { class: "es-icon" }, "📅"),
    h("div", { class: "es-desc" }, "Nenhum evento neste mês. Datas de databases, notas diárias e lembretes aparecem aqui.")));
  return wrap;
}
