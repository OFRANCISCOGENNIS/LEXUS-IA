// ═══════════════ NEXUS · Daily notes / Journal ═══════════════

import { listPages, getOrCreateDaily, updatePage, getPage } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, todayKey, stripHtml } from "../core/utils.js";
import { toast } from "../core/ui.js";

const MOODS = ["😄", "🙂", "😐", "😕", "😞"];

let viewMonth = null; // Date do primeiro dia do mês exibido

export default {
  async mount(container) {
    if (!viewMonth) viewMonth = firstOfMonth(new Date());
    render(container);
  },
  unmount() {},
};

const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const dailies = () => listPages({ includeArchived: true }).filter((p) => p.type === "daily" && p.journalDate);

function computeStreak() {
  const dates = new Set(dailies().filter((p) => stripHtml((p.blocks || []).map((b) => b.content).join("")).trim()).map((p) => p.journalDate));
  let streak = 0;
  const d = new Date();
  // hoje conta se tem nota; senão começa de ontem
  if (!dates.has(todayKey(d))) d.setDate(d.getDate() - 1);
  while (dates.has(todayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function render(container) {
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container daily" });

  const today = todayKey();
  const byDate = new Map(dailies().map((p) => [p.journalDate, p]));
  const streak = computeStreak();

  // header: hoje + streak
  const todayPage = byDate.get(today);
  wrap.appendChild(h("div", { class: "daily-hero" },
    h("div", {},
      h("h1", { class: "home-greeting" }, "Notas diárias"),
      h("p", { class: "home-date" }, new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))),
    h("div", { class: "daily-streak", title: "Dias consecutivos com nota" },
      h("span", { class: "ds-flame" }, "🔥"),
      h("span", { class: "ds-num" }, String(streak)),
      h("span", { class: "ds-label" }, streak === 1 ? "dia" : "dias"))));

  // humor do dia
  const moodRow = h("div", { class: "daily-mood" });
  moodRow.appendChild(h("span", { class: "dm-label" }, "Como você está hoje?"));
  MOODS.forEach((m) => {
    moodRow.appendChild(h("button", {
      class: "dm-emoji" + (todayPage?.mood === m ? " on" : ""),
      onclick: () => {
        const p = getOrCreateDaily(today);
        updatePage(p.id, { mood: p.mood === m ? null : m });
        toast("Humor registrado " + m);
        render(container);
      },
    }, m));
  });
  wrap.appendChild(moodRow);

  // botão abrir hoje
  wrap.appendChild(h("button", {
    class: "btn primary daily-open-today",
    onclick: () => { const p = getOrCreateDaily(today); navigate("page", p.id); },
  }, "☀ Abrir nota de hoje"));

  // calendário do mês
  const cal = h("div", { class: "daily-cal card" });
  const monthLabel = viewMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  cal.appendChild(h("div", { class: "dc-head" },
    h("button", { class: "icon-btn", "aria-label": "Mês anterior", onclick: () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); render(container); } }, "‹"),
    h("span", { class: "dc-month" }, monthLabel[0].toUpperCase() + monthLabel.slice(1)),
    h("button", { class: "icon-btn", "aria-label": "Próximo mês", onclick: () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); render(container); } }, "›")));

  const grid = h("div", { class: "dc-grid" });
  ["D", "S", "T", "Q", "Q", "S", "S"].forEach((d) => grid.appendChild(h("span", { class: "dc-dow" }, d)));
  const start = new Date(viewMonth);
  const pad = start.getDay();
  for (let i = 0; i < pad; i++) grid.appendChild(h("span", {}));
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const key = todayKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
    const has = byDate.has(key);
    grid.appendChild(h("button", {
      class: "dc-day" + (key === today ? " today" : "") + (has ? " has-note" : ""),
      onclick: () => { const p = getOrCreateDaily(key); navigate("page", p.id); },
      title: has ? "Abrir nota" : "Criar nota deste dia",
    }, h("span", {}, String(day)), has ? h("span", { class: "dc-dot" }) : null));
  }
  cal.appendChild(grid);
  wrap.appendChild(cal);

  // histórico de humor (14 dias)
  const hist = h("div", { class: "daily-mood-hist" });
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const p = byDate.get(todayKey(d));
    hist.appendChild(h("span", { class: "dmh-cell", title: d.toLocaleDateString("pt-BR") }, p?.mood || "·"));
  }
  wrap.appendChild(h("div", { class: "daily-section" },
    h("h2", { class: "home-section-title" }, "Humor · últimos 14 dias"), hist));

  // entradas anteriores
  const prev = dailies().sort((a, b) => (b.journalDate < a.journalDate ? -1 : 1)).slice(0, 15);
  if (prev.length) {
    const list = h("div", { class: "daily-list" });
    prev.forEach((p) => {
      const preview = stripHtml((p.blocks || []).map((b) => b.content).join(" ")).trim().slice(0, 100);
      list.appendChild(h("button", { class: "daily-entry", onclick: () => navigate("page", p.id) },
        h("span", { class: "de-date" }, p.journalDate.split("-").reverse().slice(0, 2).join("/")),
        h("span", { class: "de-mood" }, p.mood || "☀"),
        h("span", { class: "de-title" }, p.title || p.journalDate),
        h("span", { class: "de-preview" }, preview || "—")));
    });
    wrap.appendChild(h("div", { class: "daily-section" },
      h("h2", { class: "home-section-title" }, "Entradas anteriores"), list));
  }

  container.appendChild(wrap);
}
