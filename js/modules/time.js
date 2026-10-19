// ═══════════════ NEXUS · Tempo ═══════════════
// Módulo de organização do tempo, com cinco frentes:
//   Planejador  — grade semanal de blocos (time blocking), com rotinas que repetem
//   Timeline    — linha do tempo global, cruzando TODAS as databases
//   Cronômetro  — registro de tempo por tarefa + relatório
//   Metas       — metas/OKRs por período, com resultados-chave
//   Revisão     — fechamento da semana (o que entregou, atrasou e vem aí)
// Tudo 100% local: blocos, rotinas, sessões e metas vivem em settings (IndexedDB).

import {
  listDatabases, listPages, getDatabase, getPage,
  createPage, makeBlock, getSetting, setSetting,
  touchDatabase, touchPageBlocks,
} from "../core/store.js";
import { listReminders } from "../core/reminders.js";
import { navigate } from "../core/router.js";
import { bus } from "../core/bus.js";
import { h, todayKey, fmtDate, uid, clamp, escapeHtml } from "../core/utils.js";
import { toast, showMenu, showModal, confirmDialog, promptDialog, focusSoon } from "../core/ui.js";
import { collectTasks } from "./tasks.js";
import * as tt from "../core/timetrack.js";

/* ═══════════ paleta ═══════════ */
const CHIP = {
  slate: "215 28% 50%", blue: "214 84% 56%", green: "148 55% 46%",
  amber: "36 90% 52%", red: "4 74% 57%", purple: "268 60% 58%", teal: "176 62% 44%",
};
const COLORS = Object.keys(CHIP);
const col = (c) => `hsl(${CHIP[c] || CHIP.slate})`;

/* ═══════════ datas ═══════════ */
const DAY = 86400000;
const WD = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // semana começa na segunda
  return x;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const keyOf = (d) => todayKey(d);
const dayIdx = (key, fromKey) =>
  Math.round((new Date(key + "T12:00:00") - new Date(fromKey + "T12:00:00")) / DAY);
const weekdayOf = (key) => (new Date(key + "T12:00:00").getDay() + 6) % 7; // 0 = segunda

/* "09:30" ⇄ minutos */
const toMin = (s) => { const [a, b] = String(s || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
const fromMin = (m) => {
  m = clamp(Math.round(m), 0, 24 * 60 - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
};

/* ═══════════ persistência dos blocos ═══════════ */
const allBlocks = () => getSetting("timeBlocks", {}) || {};
const routines = () => getSetting("timeRoutines", []) || [];
const goals = () => getSetting("timeGoals", []) || [];
const planRange = () => ({ from: 7, to: 23, ...(getSetting("timePlanRange", {}) || {}) });

const byStart = (a, b) => toMin(a.start) - toMin(b.start);
const blocksOn = (key) => (allBlocks()[key] || []).slice().sort(byStart);

function writeBlocks(map) {
  // remove dias vazios para o objeto não acumular lixo
  Object.keys(map).forEach((k) => { if (!map[k]?.length) delete map[k]; });
  setSetting("timeBlocks", map);
}
function putBlock(key, block) {
  const map = { ...allBlocks() };
  const list = (map[key] || []).filter((b) => b.id !== block.id);
  list.push(block);
  map[key] = list.sort(byStart);
  writeBlocks(map);
}
function delBlock(key, id) {
  const map = { ...allBlocks() };
  map[key] = (map[key] || []).filter((b) => b.id !== id);
  writeBlocks(map);
}
function moveBlock(fromKey, toKey, block) {
  if (fromKey === toKey) { putBlock(toKey, block); return; }
  const map = { ...allBlocks() };
  map[fromKey] = (map[fromKey] || []).filter((b) => b.id !== block.id);
  map[toKey] = [...(map[toKey] || []).filter((b) => b.id !== block.id), block].sort(byStart);
  writeBlocks(map);
}

/* Blocos efetivos de um dia = concretos + rotinas ainda não materializadas.
   Um bloco `cancelled` não aparece, mas continua "ocupando" a rotina — é assim
   que uma exceção ("remover só deste dia") impede o fantasma de voltar. */
function effectiveBlocks(key) {
  const concrete = blocksOn(key);
  const used = new Set(concrete.map((b) => b.routineId).filter(Boolean));
  const wd = weekdayOf(key);
  const ghosts = routines()
    .filter((r) => r.weekday === wd && !used.has(r.id))
    .map((r) => ({ ...r, id: "ghost-" + r.id, routineId: r.id, ghost: true, done: false }));
  return [...concrete.filter((b) => !b.cancelled), ...ghosts].sort(byStart);
}

/* ═══════════ ciclo de vida ═══════════ */
const TABS = [
  ["plan", "🗓", "Planejador"],
  ["timeline", "▤", "Timeline"],
  ["track", "⏱", "Cronômetro"],
  ["goals", "◎", "Metas"],
  ["review", "✓", "Revisão"],
];

let state = null;

export default {
  async mount(container, params) {
    const asked = params?.id;
    const tab = TABS.some((t) => t[0] === asked) ? asked : getSetting("timeTab", "plan");
    state = {
      container, tab,
      week: startOfWeek(new Date()),
      tlAnchor: startOfWeek(new Date()),
      tlDays: getSetting("timeTlDays", 30),
      reviewOffset: 0,
      trackRange: "week",
      ticker: null,
      offs: [],
    };
    state.offs.push(bus.on("timer:changed", () => {
      if (state && (state.tab === "track" || state.tab === "review")) render();
    }));
    render();
  },
  unmount() {
    stopTicker();
    state?.offs.forEach((off) => { try { off?.(); } catch {} });
    state = null;
  },
};

function stopTicker() { if (state?.ticker) { clearInterval(state.ticker); state.ticker = null; } }

function setTab(tab) {
  state.tab = tab;
  setSetting("timeTab", tab);
  history.replaceState(null, "", "#/time/" + tab);
  render();
}

function render() {
  if (!state) return;
  stopTicker();
  const { container } = state;
  container.innerHTML = "";

  const wrap = h("div", { class: "page-container time-page" });
  wrap.appendChild(h("div", { class: "time-head" },
    h("h1", { class: "home-greeting" }, "Tempo"),
    h("p", { class: "time-sub" }, "Planeje a semana, veja tudo na linha do tempo, meça o foco e feche o ciclo.")));

  const tabBar = h("div", { class: "prod-tabs time-tabs" });
  TABS.forEach(([id, icon, label]) => tabBar.appendChild(h("button", {
    class: "prod-tab" + (state.tab === id ? " active" : ""),
    dataset: { timeTab: id },
    onclick: () => setTab(id),
  }, `${icon} ${label}`)));
  wrap.appendChild(tabBar);

  const body = h("div", { class: "prod-body time-body anim-fade" });
  wrap.appendChild(body);
  container.appendChild(wrap);

  if (state.tab === "plan") renderPlanner(body);
  else if (state.tab === "timeline") renderTimeline(body);
  else if (state.tab === "track") renderTracker(body);
  else if (state.tab === "goals") renderGoals(body);
  else renderReview(body);
}

/* ════════════════════════════════════════════════════════════
   1 · PLANEJADOR SEMANAL (time blocking)
   ════════════════════════════════════════════════════════════ */
const PX_PER_HOUR = 52;
const SNAP = 15; // minutos

function renderPlanner(root) {
  const { from, to } = planRange();
  const days = Array.from({ length: 7 }, (_, i) => keyOf(addDays(state.week, i)));
  const today = todayKey();

  /* ── barra de controle ── */
  const label = `${fmtDate(days[0] + "T12:00:00", { day: "numeric", month: "short" })} – ${fmtDate(days[6] + "T12:00:00", { day: "numeric", month: "short", year: "numeric" })}`;
  root.appendChild(h("div", { class: "time-bar" },
    h("div", { class: "tb-nav" },
      h("button", { class: "btn ghost icon", title: "Semana anterior", onclick: () => { state.week = addDays(state.week, -7); render(); } }, "◂"),
      h("button", { class: "btn ghost", onclick: () => { state.week = startOfWeek(new Date()); render(); } }, "Hoje"),
      h("button", { class: "btn ghost icon", title: "Próxima semana", onclick: () => { state.week = addDays(state.week, 7); render(); } }, "▸")),
    h("div", { class: "tb-title" }, label),
    h("div", { class: "tb-actions" },
      h("button", { class: "btn ghost", onclick: (e) => planMenu(e.currentTarget) }, "⋯ Opções"),
      h("button", { class: "btn primary", onclick: () => blockModal({ date: today >= days[0] && today <= days[6] ? today : days[0] }) }, "＋ Novo bloco"))));

  /* ── totais do dia ── */
  const totals = days.map((k) => effectiveBlocks(k).reduce((a, b) => a + (toMin(b.end) - toMin(b.start)), 0));

  /* ── grade ── */
  const grid = h("div", { class: "tplan", style: `--tp-hour:${PX_PER_HOUR}px` });
  const header = h("div", { class: "tp-header" }, h("div", { class: "tp-gutter" }, ""));
  days.forEach((k, i) => {
    const d = new Date(k + "T12:00:00");
    header.appendChild(h("div", { class: "tp-day-head" + (k === today ? " is-today" : "") },
      h("span", { class: "tpd-wd" }, WD[i]),
      h("span", { class: "tpd-num" }, String(d.getDate())),
      h("span", { class: "tpd-total" }, totals[i] ? tt.fmtDur(totals[i] * 60) : "—")));
  });
  grid.appendChild(header);

  const bodyEl = h("div", { class: "tp-body" });
  const gutter = h("div", { class: "tp-gutter tp-hours" });
  for (let hh = from; hh < to; hh++) gutter.appendChild(h("div", { class: "tp-hour" }, `${String(hh).padStart(2, "0")}:00`));
  bodyEl.appendChild(gutter);

  days.forEach((k) => {
    const colEl = h("div", {
      class: "tp-col" + (k === today ? " is-today" : ""),
      dataset: { date: k },
      style: `height:${(to - from) * PX_PER_HOUR}px`,
    });
    for (let hh = from; hh < to; hh++) colEl.appendChild(h("div", { class: "tp-slot" + (hh % 2 ? " alt" : "") }));

    // clique em área vazia → cria bloco naquele horário
    colEl.addEventListener("click", (e) => {
      if (e.target.closest(".tp-block")) return;
      const y = e.clientY - colEl.getBoundingClientRect().top;
      const mins = from * 60 + Math.round((y / PX_PER_HOUR * 60) / SNAP) * SNAP;
      blockModal({ date: k, start: fromMin(mins), end: fromMin(mins + 60) });
    });

    const dayBlocks = effectiveBlocks(k);
    const layout = overlapLayout(dayBlocks);
    dayBlocks.forEach((b) => colEl.appendChild(blockEl(b, k, from, to, layout.get(b.id) || { i: 0, n: 1 })));

    if (k === today) {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= from * 60 && mins <= to * 60) {
        colEl.appendChild(h("div", { class: "tp-now", style: `top:${(mins - from * 60) / 60 * PX_PER_HOUR}px` }));
      }
    }
    bodyEl.appendChild(colEl);
  });
  grid.appendChild(bodyEl);
  root.appendChild(grid);

  // em telas estreitas a semana não cabe inteira: centraliza o dia de hoje
  // (ou o primeiro da semana) para a grade nunca abrir fora do campo de visão
  requestAnimationFrame(() => {
    if (grid.scrollWidth <= grid.clientWidth + 2) return;
    const idx = days.indexOf(today);
    const target = bodyEl.querySelectorAll(".tp-col")[idx >= 0 ? idx : 0];
    if (!target) return;
    const gr = grid.getBoundingClientRect(), tr = target.getBoundingClientRect();
    grid.scrollLeft += (tr.left - gr.left) - (gr.width - tr.width) / 2;
  });

  /* ── caixa de entrada: tarefas sem horário ── */
  root.appendChild(backlogPanel(days));
}

/* Blocos que se sobrepõem dividem a largura da coluna, como num calendário:
   devolve { id → { i, n } } (posição dentro do grupo e tamanho do grupo). */
function overlapLayout(list) {
  const pos = new Map();
  const groups = [];
  list.slice().sort(byStart).forEach((b) => {
    const g = groups.find((g) => g.end > toMin(b.start));
    if (g) { g.items.push(b); g.end = Math.max(g.end, toMin(b.end)); }
    else groups.push({ items: [b], end: toMin(b.end) });
  });
  groups.forEach((g) => g.items.forEach((b, i) => pos.set(b.id, { i, n: g.items.length })));
  return pos;
}

function blockEl(b, dateKey, from, to, slot = { i: 0, n: 1 }) {
  const s = clamp(toMin(b.start), from * 60, to * 60);
  const e = clamp(toMin(b.end), s + SNAP, to * 60);
  const w = 100 / slot.n;
  const el = h("div", {
    class: "tp-block" + (b.ghost ? " ghost" : "") + (b.done ? " done" : ""),
    dataset: { blockId: b.id, date: dateKey },
    style: `top:${(s - from * 60) / 60 * PX_PER_HOUR}px;height:${(e - s) / 60 * PX_PER_HOUR}px;`
      + `left:calc(${slot.i * w}% + 2px);width:calc(${w}% - 4px);right:auto;--c:${col(b.color)}`,
    title: `${b.start}–${b.end} · ${b.title}`,
  },
    h("div", { class: "tpb-time" }, `${b.start}`),
    h("div", { class: "tpb-title" }, (b.done ? "✓ " : "") + (b.title || "Bloco")),
    b.ref ? h("span", { class: "tpb-ref", title: "Ligado a uma tarefa" }, "🔗") : null,
    b.routineId ? h("span", { class: "tpb-rep", title: "Repete toda semana" }, "↻") : null,
    h("div", { class: "tpb-resize", title: "Arrastar para ajustar a duração" }));

  setupBlockDrag(el, b, dateKey, from);
  return el;
}

/* Arrastar para mover (vertical + entre dias) e redimensionar.
   Pointer Events cobrem mouse e toque com o mesmo código.
   Durante o arrasto o bloco NÃO troca de pai no DOM — só recebe um
   `transform`. Reparentar no meio do gesto fazia o navegador soltar o
   pointer capture e o arrasto morria calado ao cruzar mais de uma coluna. */
function setupBlockDrag(el, b, dateKey, from) {
  let drag = null;

  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const resizing = !!e.target.closest(".tpb-resize");
    const cols = [...document.querySelectorAll(".tp-col")].map((c) => ({ key: c.dataset.date, rect: c.getBoundingClientRect(), el: c }));
    drag = {
      resizing, moved: false, x0: e.clientX, y0: e.clientY,
      start: toMin(b.start), end: toMin(b.end), cols,
      ownLeft: (cols.find((c) => c.key === dateKey) || cols[0])?.rect.left ?? 0,
      key: dateKey, pid: e.pointerId,
    };
    try { el.setPointerCapture(e.pointerId); } catch {}
  };

  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (!drag.moved) { drag.moved = true; el.classList.add("dragging"); }
    e.preventDefault();
    const dMin = Math.round((dy / PX_PER_HOUR * 60) / SNAP) * SNAP;

    if (drag.resizing) {
      const end = clamp(drag.end + dMin, drag.start + SNAP, 24 * 60);
      el.style.height = `${(end - drag.start) / 60 * PX_PER_HOUR}px`;
      drag.newEnd = end;
    } else {
      const dur = drag.end - drag.start;
      const start = clamp(drag.start + dMin, 0, 24 * 60 - dur);
      drag.newStart = start;
      const over = drag.cols.find((c) => e.clientX >= c.rect.left && e.clientX <= c.rect.right);
      drag.newKey = over ? over.key : dateKey;
      const shiftX = over ? over.rect.left - drag.ownLeft : 0;
      const shiftY = (start - drag.start) / 60 * PX_PER_HOUR;
      el.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
      drag.cols.forEach((c) => c.el.classList.toggle("drop-target", c.key === drag.newKey && c.key !== dateKey));
    }
  };

  const onUp = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    try { el.releasePointerCapture(d.pid); } catch {}
    el.classList.remove("dragging");
    el.style.transform = "";
    document.querySelectorAll(".tp-col.drop-target").forEach((c) => c.classList.remove("drop-target"));
    if (!d.moved) { blockMenu(el, b, dateKey); return; }
    const concrete = materialize(b, dateKey);
    if (d.resizing) concrete.end = fromMin(d.newEnd ?? d.end);
    else {
      const dur = d.end - d.start;
      concrete.start = fromMin(d.newStart ?? d.start);
      concrete.end = fromMin((d.newStart ?? d.start) + dur);
    }
    moveBlock(dateKey, d.newKey || dateKey, concrete);
    render();
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

/* Transforma um "fantasma" de rotina num bloco de verdade daquele dia */
function materialize(b, dateKey) {
  if (!b.ghost) return { ...b };
  const real = { ...b, id: uid("tb"), ghost: false };
  putBlock(dateKey, real);
  return real;
}

function blockMenu(anchor, b, dateKey) {
  const isGhost = !!b.ghost;
  showMenu(anchor, [
    { icon: "✎", title: "Editar bloco", action: () => blockModal({ date: dateKey, block: b }) },
    { icon: b.done ? "↺" : "✓", title: b.done ? "Reabrir" : "Marcar como concluído", action: () => {
      const real = materialize(b, dateKey);
      real.done = !real.done;
      putBlock(dateKey, real);
      if (real.done && real.ref) completeTaskRef(real.ref);
      render();
    } },
    { icon: "⏱", title: "Iniciar cronômetro neste bloco", action: () => {
      tt.startTimer({ label: b.title || "Bloco", ref: b.ref || null });
      toast("Cronômetro iniciado ⏱");
      setTab("track");
    } },
    { sep: true },
    { icon: "⧉", title: "Duplicar", action: () => {
      putBlock(dateKey, { ...b, id: uid("tb"), ghost: false, routineId: null, done: false });
      render();
    } },
    isGhost || b.routineId
      ? { icon: "↻", title: "Parar de repetir", action: async () => {
          if (!(await confirmDialog({ title: "Parar a repetição?", message: "O bloco deixa de aparecer nas próximas semanas. Os blocos já criados permanecem.", confirmText: "Parar", danger: true }))) return;
          setSetting("timeRoutines", routines().filter((r) => r.id !== b.routineId));
          render();
        } }
      : { icon: "↻", title: "Repetir toda semana", action: () => {
          const r = { id: uid("tr"), weekday: weekdayOf(dateKey), start: b.start, end: b.end, title: b.title, color: b.color };
          setSetting("timeRoutines", [...routines(), r]);
          putBlock(dateKey, { ...b, routineId: r.id });
          toast(`Repete toda ${WD[r.weekday]}. ↻`);
          render();
        } },
    b.ref ? { icon: "→", title: "Abrir tarefa ligada", action: () => openRef(b.ref) } : null,
    { sep: true },
    { icon: "🗑", title: isGhost ? "Remover só deste dia" : "Excluir bloco", danger: true, action: () => {
      // No fantasma, gravamos uma exceção: um bloco concreto "cancelado" que
      // não é desenhado, mas impede a rotina de reaparecer neste dia.
      if (isGhost) putBlock(dateKey, { ...b, id: uid("tb"), ghost: false, cancelled: true });
      else delBlock(dateKey, b.id);
      render();
    } },
  ].filter(Boolean));
}

function planMenu(anchor) {
  const r = planRange();
  showMenu(anchor, [
    { label: "Faixa de horário visível" },
    { icon: "↑", title: `Começa às ${String(r.from).padStart(2, "0")}:00`, action: async () => {
      const v = parseInt(await promptDialog({ title: "Hora inicial do dia", value: String(r.from) }), 10);
      if (v >= 0 && v < r.to) { setSetting("timePlanRange", { ...r, from: v }); render(); }
    } },
    { icon: "↓", title: `Termina às ${String(r.to).padStart(2, "0")}:00`, action: async () => {
      const v = parseInt(await promptDialog({ title: "Hora final do dia", value: String(r.to) }), 10);
      if (v > r.from && v <= 24) { setSetting("timePlanRange", { ...r, to: v }); render(); }
    } },
    { sep: true },
    { icon: "⧉", title: "Copiar semana anterior", action: () => copyPrevWeek() },
    { icon: "🗑", title: "Limpar esta semana", danger: true, action: async () => {
      if (!(await confirmDialog({ title: "Limpar a semana?", message: "Todos os blocos desta semana serão removidos. As rotinas que repetem continuam.", confirmText: "Limpar", danger: true }))) return;
      const map = { ...allBlocks() };
      for (let i = 0; i < 7; i++) delete map[keyOf(addDays(state.week, i))];
      writeBlocks(map);
      render();
    } },
  ]);
}

function copyPrevWeek() {
  const map = { ...allBlocks() };
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const src = keyOf(addDays(state.week, i - 7));
    const dst = keyOf(addDays(state.week, i));
    const copy = (map[src] || []).filter((b) => !b.cancelled).map((b) => ({ ...b, id: uid("tb"), done: false }));
    if (!copy.length) continue;
    map[dst] = [...(map[dst] || []), ...copy].sort(byStart);
    n += copy.length;
  }
  writeBlocks(map);
  toast(n ? `${n} bloco(s) copiados da semana anterior` : "A semana anterior está vazia", { type: n ? "ok" : "warn" });
  render();
}

/* Modal de criação/edição de bloco */
function blockModal({ date, start = "09:00", end = "10:00", block = null, ref = null, title = "" } = {}) {
  const b = block || {};
  const fTitle = h("input", { class: "input", value: b.title || title, placeholder: "Ex.: Escrever proposta" });
  const fDate = h("input", { class: "input", type: "date", value: date });
  const fStart = h("input", { class: "input", type: "time", value: b.start || start });
  const fEnd = h("input", { class: "input", type: "time", value: b.end || end });
  let color = b.color || "blue";
  const swatches = h("div", { class: "tb-colors" });
  COLORS.forEach((c) => {
    const sw = h("button", { class: "tb-sw" + (c === color ? " on" : ""), style: `background:${col(c)}`, title: c, dataset: { color: c } });
    sw.onclick = () => { color = c; swatches.querySelectorAll(".tb-sw").forEach((s) => s.classList.toggle("on", s.dataset.color === c)); };
    swatches.appendChild(sw);
  });
  const linked = b.ref || ref;
  const fRepeat = h("input", { type: "checkbox", ...(b.routineId ? { checked: true } : {}) });

  const body = h("div", { class: "form-grid" },
    field("Título", fTitle),
    h("div", { class: "fg-row" }, field("Dia", fDate), field("Início", fStart), field("Fim", fEnd)),
    field("Cor", swatches),
    linked ? h("div", { class: "tb-linked" }, "🔗 Ligado a: ", h("strong", {}, linked.title || "tarefa")) : null,
    h("label", { class: "tb-check" }, fRepeat, h("span", {}, "Repetir toda semana neste dia e horário")));

  const save = h("button", { class: "btn primary" }, block ? "Salvar" : "Criar bloco");
  const cancel = h("button", { class: "btn ghost" }, "Cancelar");
  const m = showModal({ title: block ? "Editar bloco" : "Novo bloco de tempo", body, footer: [cancel, save], width: 520 });
  cancel.onclick = () => m.close();
  save.onclick = () => {
    const newDate = fDate.value || date;
    let s = toMin(fStart.value), e = toMin(fEnd.value);
    if (e <= s) e = s + SNAP;
    const wasGhost = !!b.ghost;
    const out = {
      id: wasGhost || !b.id ? uid("tb") : b.id,
      start: fromMin(s), end: fromMin(e),
      title: fTitle.value.trim() || "Bloco",
      color, ref: linked || null,
      done: !!b.done, routineId: b.routineId || null,
    };
    // repetição
    const wantRepeat = fRepeat.checked;
    let rs = routines();
    if (wantRepeat && !out.routineId) {
      const r = { id: uid("tr"), weekday: weekdayOf(newDate), start: out.start, end: out.end, title: out.title, color };
      rs = [...rs, r];
      out.routineId = r.id;
    } else if (wantRepeat && out.routineId) {
      rs = rs.map((r) => (r.id === out.routineId ? { ...r, weekday: weekdayOf(newDate), start: out.start, end: out.end, title: out.title, color } : r));
    } else if (!wantRepeat && out.routineId) {
      rs = rs.filter((r) => r.id !== out.routineId);
      out.routineId = null;
    }
    setSetting("timeRoutines", rs);
    if (block && !wasGhost && date && date !== newDate) moveBlock(date, newDate, out);
    else putBlock(newDate, out);
    m.close();
    render();
  };
  focusSoon(fTitle);
}

const field = (label, control) =>
  h("label", { class: "fg-field" }, h("span", { class: "fg-label" }, label), control);

/* Caixa de entrada — tarefas pendentes que ainda não têm bloco na semana */
function backlogPanel(days) {
  const planned = new Set();
  days.forEach((k) => effectiveBlocks(k).forEach((b) => { if (b.ref) planned.add(refKey(b.ref)); }));

  const items = collectTasks()
    .filter((t) => !t.done && !planned.has(refKey(t)))
    .sort((a, b) => (a.date || "9").localeCompare(b.date || "9"))
    .slice(0, 12);

  const list = h("div", { class: "tbk-list" });
  if (!items.length) {
    list.appendChild(h("div", { class: "tbk-empty" }, "Nada na fila — tudo já está planejado ou concluído. ✓"));
  }
  items.forEach((t) => {
    list.appendChild(h("div", { class: "tbk-item" },
      h("span", { class: "tbk-icon" }, t.icon || "○"),
      h("div", { class: "tbk-body" },
        h("div", { class: "tbk-title" }, t.title),
        h("div", { class: "tbk-meta" }, t.origin + (t.date ? " · 📅 " + fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" }) : ""))),
      h("button", { class: "btn ghost sm", title: "Agendar na semana", onclick: () => {
        const target = t.date && days.includes(t.date) ? t.date : (days.includes(todayKey()) ? todayKey() : days[0]);
        blockModal({ date: target, title: t.title, ref: refOf(t), start: "09:00", end: "10:00" });
      } }, "Agendar"),
      h("button", { class: "btn ghost sm", title: "Medir o tempo agora", onclick: () => {
        tt.startTimer({ label: t.title, ref: refOf(t) });
        toast("Cronômetro iniciado ⏱");
        setTab("track");
      } }, "⏱")));
  });

  return h("section", { class: "tbk" },
    h("div", { class: "tbk-head" },
      h("h2", {}, "Fila de tarefas"),
      h("span", { class: "tbk-hint" }, "Arraste os blocos na grade ou use “Agendar”")),
    list);
}

/* ═══════════ referências a tarefas ═══════════ */
const refOf = (t) => t.source === "row"
  ? { kind: "row", dbId: t.dbId, rowId: t.rowId, title: t.title }
  : { kind: "block", pageId: t.pageId, blockId: t.blockId, title: t.title };
const refKey = (r) => r.kind === "row" || r.source === "row"
  ? `row:${r.dbId}:${r.rowId}` : `block:${r.pageId}:${r.blockId}`;

function openRef(ref) {
  if (!ref) return;
  if (ref.kind === "row") navigate("db", ref.dbId);
  else navigate("page", ref.pageId);
}

/* Marca a tarefa ligada como concluída (checkbox do bloco ou da linha) */
function completeTaskRef(ref) {
  if (!ref) return;
  if (ref.kind === "block") {
    const p = getPage(ref.pageId);
    if (!p) return;
    const find = (bs) => { for (const b of bs) { if (b.id === ref.blockId) return b; if (b.children?.length) { const f = find(b.children); if (f) return f; } } return null; };
    const b = find(p.blocks || []);
    if (b && !b.props?.checked) { b.props = { ...b.props, checked: true }; touchPageBlocks(p.id); }
  } else {
    const db = getDatabase(ref.dbId);
    const row = db?.rows.find((r) => r.id === ref.rowId);
    if (!row) return;
    const cp = db.properties.find((p) => p.type === "checkbox");
    if (cp) { row.values[cp.id] = true; row.updatedAt = Date.now(); touchDatabase(db.id); }
  }
}

/* ════════════════════════════════════════════════════════════
   2 · TIMELINE GLOBAL
   ════════════════════════════════════════════════════════════ */
function timelineLanes() {
  const lanes = [];

  listDatabases().forEach((db) => {
    const dateProps = db.properties.filter((p) => p.type === "date");
    if (!dateProps.length) return;
    const [sp, ep] = dateProps;
    const selProp = db.properties.find((p) => p.type === "select");
    const checkProp = db.properties.find((p) => p.type === "checkbox");
    const items = [];
    db.rows.forEach((r) => {
      const a = r.values[sp.id];
      if (!a) return;
      const bRaw = ep ? r.values[ep.id] : null;
      const b = bRaw || a;
      const opt = selProp?.options?.find((o) => o.id === r.values[selProp.id]);
      items.push({
        start: a <= b ? a : b, end: a <= b ? b : a,
        title: r.values.title || "Sem nome",
        color: opt?.color || "blue",
        done: checkProp ? !!r.values[checkProp.id] : false,
        go: () => navigate("db", db.id),
      });
    });
    if (items.length) lanes.push({ id: db.id, name: db.name || "Database", icon: db.icon || "▦", items });
  });

  const dailies = listPages().filter((p) => p.type === "daily" && p.journalDate)
    .map((p) => ({ start: p.journalDate, end: p.journalDate, title: "Nota do dia", color: "amber", go: () => navigate("page", p.id) }));
  if (dailies.length) lanes.push({ id: "daily", name: "Notas diárias", icon: "☀", items: dailies });

  const plan = [];
  Object.entries(allBlocks()).forEach(([k, list]) => (list || []).forEach((b) => {
    if (b.cancelled) return;
    plan.push({ start: k, end: k, title: `${b.start} ${b.title}`, color: b.color || "teal", done: !!b.done, go: () => { state.week = startOfWeek(new Date(k + "T12:00:00")); setTab("plan"); } });
  }));
  if (plan.length) lanes.push({ id: "plan", name: "Blocos planejados", icon: "🗓", items: plan });

  const rem = listReminders().filter((r) => !r.done)
    .map((r) => ({ start: todayKey(new Date(r.at)), end: todayKey(new Date(r.at)), title: r.title, color: "purple", go: () => navigate("productivity") }));
  if (rem.length) lanes.push({ id: "rem", name: "Lembretes", icon: "⏰", items: rem });

  return lanes;
}

function renderTimeline(root) {
  const lanes = timelineLanes();
  const days = state.tlDays;
  const dayW = days <= 14 ? 58 : days <= 30 ? 32 : 13;
  const fromKey = keyOf(state.tlAnchor);
  const toKey = keyOf(addDays(state.tlAnchor, days - 1));
  const today = todayKey();

  root.appendChild(h("div", { class: "time-bar" },
    h("div", { class: "tb-nav" },
      h("button", { class: "btn ghost icon", title: "Voltar", onclick: () => { state.tlAnchor = addDays(state.tlAnchor, -Math.round(days / 2)); render(); } }, "◂"),
      h("button", { class: "btn ghost", onclick: () => { state.tlAnchor = startOfWeek(new Date()); render(); } }, "Hoje"),
      h("button", { class: "btn ghost icon", title: "Avançar", onclick: () => { state.tlAnchor = addDays(state.tlAnchor, Math.round(days / 2)); render(); } }, "▸")),
    h("div", { class: "tb-title" }, `${fmtDate(fromKey + "T12:00:00", { day: "numeric", month: "short" })} – ${fmtDate(toKey + "T12:00:00", { day: "numeric", month: "short", year: "numeric" })}`),
    h("div", { class: "tb-actions" },
      ...[[14, "2 sem"], [30, "Mês"], [90, "Trimestre"]].map(([n, lbl]) => h("button", {
        class: "btn ghost sm" + (days === n ? " active" : ""),
        onclick: () => { state.tlDays = n; setSetting("timeTlDays", n); render(); },
      }, lbl)))));

  if (!lanes.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "▤"),
      h("div", { class: "es-title" }, "Nada na linha do tempo ainda"),
      h("div", { class: "es-desc" }, "Databases com propriedade de Data, notas diárias e blocos planejados aparecem aqui automaticamente.")));
    return;
  }

  const width = days * dayW;
  const scroll = h("div", { class: "gtl-scroll" });
  const inner = h("div", { class: "gtl", style: `--gtl-w:${width}px;--gtl-day:${dayW}px` });

  /* cabeçalho de datas */
  const head = h("div", { class: "gtl-row gtl-head" }, h("div", { class: "gtl-label" }, "Linha do tempo"));
  const headTrack = h("div", { class: "gtl-track" });
  for (let i = 0; i < days; i++) {
    const k = keyOf(addDays(state.tlAnchor, i));
    const d = new Date(k + "T12:00:00");
    const first = d.getDate() === 1 || i === 0;
    headTrack.appendChild(h("div", { class: "gtl-tick" + (k === today ? " is-today" : "") + ((d.getDay() === 0 || d.getDay() === 6) ? " weekend" : "") },
      first ? h("span", { class: "gt-month" }, d.toLocaleDateString("pt-BR", { month: "short" })) : null,
      h("span", { class: "gt-num" }, days > 45 ? (d.getDate() % 5 === 0 ? String(d.getDate()) : "") : String(d.getDate()))));
  }
  head.appendChild(headTrack);
  inner.appendChild(head);

  /* raias */
  lanes.forEach((lane) => {
    // empilha em sub-linhas para barras não se sobreporem
    const rows = [];
    lane.items
      .filter((it) => it.end >= fromKey && it.start <= toKey)
      .sort((a, b) => a.start.localeCompare(b.start))
      .forEach((it) => {
        const s = clamp(dayIdx(it.start, fromKey), 0, days - 1);
        const e = clamp(dayIdx(it.end, fromKey), s, days - 1);
        let row = rows.find((r) => r.lastEnd < s);
        if (!row) { row = { lastEnd: -1, items: [] }; rows.push(row); }
        row.items.push({ ...it, s, e });
        row.lastEnd = e;
      });

    if (!rows.length) return;
    rows.forEach((row, ri) => {
      const laneRow = h("div", { class: "gtl-row" },
        h("div", { class: "gtl-label" }, ri === 0
          ? h("span", { class: "gl-name" }, `${lane.icon} ${lane.name}`)
          : h("span", { class: "gl-cont" }, "")));
      const track = h("div", { class: "gtl-track" });
      // fundo de fins de semana / hoje
      for (let i = 0; i < days; i++) {
        const d = new Date(keyOf(addDays(state.tlAnchor, i)) + "T12:00:00");
        track.appendChild(h("div", { class: "gtl-cell" + ((d.getDay() === 0 || d.getDay() === 6) ? " weekend" : "") }));
      }
      const todayIdx = dayIdx(today, fromKey);
      if (todayIdx >= 0 && todayIdx < days) track.appendChild(h("div", { class: "gtl-today", style: `left:${todayIdx * dayW}px` }));

      row.items.forEach((it, i) => {
        const barW = (it.e - it.s + 1) * dayW - 3;
        // barra estreita (ex.: item de um dia só) engole o texto; se houver espaço
        // livre até o próximo item, o rótulo vai PARA FORA, à direita da barra
        const nextS = row.items[i + 1] ? row.items[i + 1].s : days;
        const gapPx = (nextS - it.e - 1) * dayW;
        const outside = barW < 56 && gapPx >= 44;
        const bar = h("button", {
          class: "gtl-bar" + (it.done ? " done" : "") + (it.s === it.e ? " point" : "") + (outside ? " narrow" : ""),
          style: `left:${it.s * dayW + 1}px;width:${barW}px;--c:${col(it.color)}`,
          title: `${it.title} · ${fmtDate(it.start + "T12:00:00", { day: "numeric", month: "short" })}${it.end !== it.start ? " → " + fmtDate(it.end + "T12:00:00", { day: "numeric", month: "short" }) : ""}`,
          onclick: () => it.go?.(),
        }, outside ? null : h("span", { class: "gb-label" }, it.title));
        track.appendChild(bar);
        if (outside) {
          track.appendChild(h("span", {
            class: "gtl-outside" + (it.done ? " done" : ""),
            style: `left:${(it.e + 1) * dayW + 2}px;max-width:${gapPx - 6}px`,
          }, it.title));
        }
      });
      laneRow.appendChild(track);
      inner.appendChild(laneRow);
    });
  });

  scroll.appendChild(inner);
  root.appendChild(scroll);

  // centraliza o "hoje" na primeira pintura
  requestAnimationFrame(() => {
    const idx = dayIdx(today, fromKey);
    if (idx >= 0 && idx < days) scroll.scrollLeft = Math.max(0, idx * dayW - scroll.clientWidth / 2 + 90);
  });
}

/* ════════════════════════════════════════════════════════════
   3 · CRONÔMETRO / REGISTRO DE TEMPO
   ════════════════════════════════════════════════════════════ */
function renderTracker(root) {
  const active = tt.activeTimer();

  /* ── cronômetro ── */
  const clock = h("div", { class: "ttk-clock", id: "ttk-clock" }, tt.fmtClock(tt.elapsedOf(active)));
  const labelInput = h("input", { class: "input ttk-label", placeholder: "No que você está trabalhando?", value: "" });

  const mainBtn = h("button", {
    class: "btn " + (active ? "danger" : "primary") + " ttk-main",
    onclick: () => {
      if (active) {
        const s = tt.stopTimer();
        toast(s ? `Registrado: ${tt.fmtDur(s.seconds)} em “${s.label}”` : "Sessão curta descartada", { type: s ? "ok" : "warn" });
      } else {
        tt.startTimer({ label: labelInput.value.trim() || "Foco" });
      }
      render();
    },
  }, active ? "■ Parar" : "▶ Iniciar");

  const panel = h("div", { class: "ttk-panel" },
    h("div", { class: "ttk-left" },
      clock,
      h("div", { class: "ttk-now" }, active ? `⏱ ${active.label}` : "Nenhuma sessão em andamento")),
    h("div", { class: "ttk-right" },
      active ? null : labelInput,
      mainBtn,
      active?.ref ? h("button", { class: "btn ghost", onclick: () => openRef(active.ref) }, "→ Abrir tarefa") : null));
  root.appendChild(panel);

  if (active) {
    state.ticker = setInterval(() => {
      const el = document.getElementById("ttk-clock");
      if (!el) { stopTicker(); return; }
      el.textContent = tt.fmtClock(tt.elapsedOf());
    }, 1000);
  }

  /* ── início rápido ── */
  const quick = collectTasks().filter((t) => !t.done).slice(0, 6);
  if (quick.length) {
    const row = h("div", { class: "ttk-quick" }, h("span", { class: "ttk-qlabel" }, "Início rápido:"));
    quick.forEach((t) => row.appendChild(h("button", {
      class: "chip-btn", title: t.origin,
      onclick: () => { tt.startTimer({ label: t.title, ref: refOf(t) }); render(); },
    }, `⏱ ${t.title.length > 28 ? t.title.slice(0, 27) + "…" : t.title}`)));
    root.appendChild(row);
  }

  /* ── KPIs ── */
  const today = todayKey();
  const wStart = keyOf(state.week), wEnd = keyOf(addDays(state.week, 6));
  const mStart = today.slice(0, 8) + "01", mEnd = today.slice(0, 8) + "31";
  const dayS = tt.sessionsBetween(today, today);
  const weekS = tt.sessionsBetween(wStart, wEnd);
  const monthS = tt.sessionsBetween(mStart, mEnd);
  root.appendChild(h("div", { class: "home-stats", style: "margin:4px 0 18px" },
    kpi(tt.fmtDur(tt.totalSeconds(dayS)), "hoje"),
    kpi(tt.fmtDur(tt.totalSeconds(weekS)), "esta semana"),
    kpi(tt.fmtDur(tt.totalSeconds(monthS)), "este mês"),
    kpi(String(tt.listSessions().length), "sessões")));

  /* ── relatório ── */
  const ranges = { today: ["Hoje", today, today], week: ["Semana", wStart, wEnd], month: ["Mês", mStart, mEnd], all: ["Tudo", "0000-01-01", "9999-12-31"] };
  const bar = h("div", { class: "time-bar" },
    h("div", { class: "tb-title" }, "Relatório por atividade"),
    h("div", { class: "tb-actions" },
      ...Object.entries(ranges).map(([k, [lbl]]) => h("button", {
        class: "btn ghost sm" + (state.trackRange === k ? " active" : ""),
        onclick: () => { state.trackRange = k; render(); },
      }, lbl)),
      h("button", { class: "btn ghost sm", onclick: () => manualSessionModal() }, "＋ Lançar tempo")));
  root.appendChild(bar);

  const [, rFrom, rTo] = ranges[state.trackRange] || ranges.week;
  const sessions = tt.sessionsBetween(rFrom, rTo);
  const groups = tt.byLabel(sessions);
  const max = groups[0]?.seconds || 1;

  if (!groups.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "⏱"),
      h("div", { class: "es-title" }, "Nenhum tempo registrado neste período"),
      h("div", { class: "es-desc" }, "Inicie o cronômetro acima ou lance o tempo manualmente — o relatório soma por atividade.")));
  } else {
    const rep = h("div", { class: "ttk-report" });
    groups.forEach((g) => rep.appendChild(h("div", { class: "ttk-rrow" },
      h("div", { class: "ttk-rlabel", title: g.label }, g.label),
      h("div", { class: "ttk-rbar" }, h("div", { class: "ttk-rfill", style: `width:${Math.max(3, g.seconds / max * 100)}%` })),
      h("div", { class: "ttk-rval" }, tt.fmtDur(g.seconds)))));
    root.appendChild(rep);
  }

  /* ── histórico ── */
  const recent = sessions.slice().sort((a, b) => b.start - a.start).slice(0, 25);
  if (recent.length) {
    const det = h("details", { class: "task-done-wrap", open: true });
    det.appendChild(h("summary", {}, `Sessões (${sessions.length})`));
    const list = h("div", { class: "ttk-sessions" });
    recent.forEach((s) => list.appendChild(h("div", { class: "ttk-srow" },
      h("div", { class: "ttk-stitle" }, s.label),
      h("div", { class: "ttk-smeta" }, `${fmtDate(s.date + "T12:00:00", { day: "numeric", month: "short" })}${s.manual ? " · manual" : " · " + new Date(s.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`),
      h("div", { class: "ttk-sdur" }, tt.fmtDur(s.seconds)),
      s.ref ? h("button", { class: "icon-btn sm", title: "Abrir tarefa", onclick: () => openRef(s.ref) }, "→") : null,
      h("button", { class: "icon-btn sm", title: "Excluir sessão", onclick: () => { tt.removeSession(s.id); render(); } }, "✕"))));
    det.appendChild(list);
    root.appendChild(det);
  }
}

function manualSessionModal() {
  const fLabel = h("input", { class: "input", placeholder: "Atividade" });
  const fDate = h("input", { class: "input", type: "date", value: todayKey() });
  const fMin = h("input", { class: "input", type: "number", min: "1", max: "1440", value: "30" });
  const ok = h("button", { class: "btn primary" }, "Lançar");
  const cancel = h("button", { class: "btn ghost" }, "Cancelar");
  const m = showModal({
    title: "Lançar tempo manualmente",
    body: h("div", { class: "form-grid" }, field("Atividade", fLabel), h("div", { class: "fg-row" }, field("Dia", fDate), field("Minutos", fMin))),
    footer: [cancel, ok], width: 460,
  });
  cancel.onclick = () => m.close();
  ok.onclick = () => {
    tt.addSession({ label: fLabel.value.trim() || "Foco", date: fDate.value || todayKey(), minutes: +fMin.value || 30 });
    m.close();
    render();
  };
  focusSoon(fLabel);
}

/* ════════════════════════════════════════════════════════════
   4 · METAS / OKRs
   ════════════════════════════════════════════════════════════ */
const PERIODS = () => {
  const now = new Date(), y = now.getFullYear(), q = Math.floor(now.getMonth() / 3) + 1;
  const p = (n) => String(n).padStart(2, "0");
  return [
    [`${y}-${p(now.getMonth() + 1)}`, `Mês · ${now.toLocaleDateString("pt-BR", { month: "long" })}`],
    [`${y}-Q${q}`, `Trimestre · Q${q} ${y}`],
    [`${y}`, `Ano · ${y}`],
  ];
};

/* Converte um período ("2026-10" | "2026-Q4" | "2026") em [de, até] */
function periodRange(period) {
  const p = (n) => String(n).padStart(2, "0");
  const lastDay = (y, m) => new Date(y, m, 0).getDate();
  let mm = /^(\d{4})-Q([1-4])$/.exec(period);
  if (mm) {
    const y = +mm[1], q = +mm[2], a = (q - 1) * 3 + 1, b = a + 2;
    return [`${y}-${p(a)}-01`, `${y}-${p(b)}-${p(lastDay(y, b))}`];
  }
  mm = /^(\d{4})-(\d{2})$/.exec(period);
  if (mm) { const y = +mm[1], m = +mm[2]; return [`${y}-${p(m)}-01`, `${y}-${p(m)}-${p(lastDay(y, m))}`]; }
  mm = /^(\d{4})$/.exec(period);
  if (mm) return [`${mm[1]}-01-01`, `${mm[1]}-12-31`];
  return ["0000-01-01", "9999-12-31"];
}

const periodLabel = (period) => {
  let m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(period);
  // só a inicial em maiúscula: "capitalize" do CSS viraria "Outubro De 2026"
  if (m) { const t = fmtDate(`${period}-01T12:00:00`, { month: "long", year: "numeric" }); return t[0].toUpperCase() + t.slice(1); }
  return period;
};

/* Progresso: manual, horas registradas ou % dos resultados-chave */
function goalProgress(g) {
  const [from, to] = periodRange(g.period);
  if (g.metric === "hours") {
    const needle = (g.match || "").toLowerCase();
    const list = tt.sessionsBetween(from, to).filter((s) => !needle || s.label.toLowerCase().includes(needle));
    return { current: tt.totalSeconds(list) / 3600, target: g.target || 1, unit: "h" };
  }
  if (g.metric === "krs") {
    const krs = g.krs || [];
    return { current: krs.filter((k) => k.done).length, target: krs.length || 1, unit: "RC" };
  }
  return { current: Number(g.progress) || 0, target: g.target || 1, unit: g.unit || "" };
}

function renderGoals(root) {
  const list = goals().filter((g) => !g.archived);

  root.appendChild(h("div", { class: "time-bar" },
    h("div", { class: "tb-title" }, "Metas & resultados-chave"),
    h("div", { class: "tb-actions" },
      goals().some((g) => g.archived) ? h("button", { class: "btn ghost sm", onclick: () => showArchivedGoals() }, "Arquivadas") : null,
      h("button", { class: "btn primary", onclick: () => goalModal() }, "＋ Nova meta"))));

  if (!list.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "◎"),
      h("div", { class: "es-title" }, "Nenhuma meta definida"),
      h("div", { class: "es-desc" }, "Uma meta tem período, alvo e resultados-chave. O progresso pode ser manual, vir das horas registradas ou da fração de resultados concluídos.")));
    return;
  }

  const grid = h("div", { class: "goal-grid" });
  list.sort((a, b) => String(a.period).localeCompare(String(b.period)));
  list.forEach((g) => {
    const { current, target, unit } = goalProgress(g);
    const pct = clamp(Math.round(current / (target || 1) * 100), 0, 100);
    const krs = g.krs || [];

    const krList = h("div", { class: "goal-krs" });
    krs.forEach((k) => krList.appendChild(h("label", { class: "goal-kr" + (k.done ? " done" : "") },
      h("input", { type: "checkbox", ...(k.done ? { checked: true } : {}), onchange: () => {
        updateGoal(g.id, { krs: krs.map((x) => (x.id === k.id ? { ...x, done: !x.done } : x)) });
        render();
      } }),
      h("span", {}, k.title))));

    grid.appendChild(h("article", { class: "goal-card", style: `--c:${col(g.color || "purple")}` },
      h("div", { class: "goal-head" },
        h("span", { class: "goal-icon" }, g.icon || "◎"),
        h("div", { class: "goal-ttl" },
          h("h3", {}, g.title),
          h("span", { class: "goal-period" }, periodLabel(g.period))),
        h("button", { class: "icon-btn", title: "Opções", onclick: (e) => goalMenu(e.currentTarget, g) }, "⋯")),
      h("div", { class: "goal-prog" },
        h("div", { class: "goal-bar" }, h("div", { class: "goal-fill", style: `width:${pct}%` })),
        h("div", { class: "goal-nums" },
          h("strong", {}, `${fmtNum(current)}${unit ? " " + unit : ""}`),
          h("span", {}, ` de ${fmtNum(target)}${unit ? " " + unit : ""} · ${pct}%`))),
      g.metric === "hours" ? h("div", { class: "goal-src" }, `⏱ Soma automática das sessões${g.match ? ` com “${g.match}”` : ""}`) : null,
      g.metric === "manual" ? h("div", { class: "goal-manual" },
        h("button", { class: "btn ghost sm", title: "Diminuir", onclick: () => { updateGoal(g.id, { progress: Math.max(0, (Number(g.progress) || 0) - 1) }); render(); } }, "−"),
        h("span", {}, "ajustar progresso"),
        h("button", { class: "btn ghost sm", title: "Aumentar", onclick: () => { updateGoal(g.id, { progress: (Number(g.progress) || 0) + 1 }); render(); } }, "＋")) : null,
      krs.length ? krList : null,
      h("button", { class: "btn ghost sm goal-addkr", onclick: async () => {
        const t = await promptDialog({ title: "Novo resultado-chave", placeholder: "Ex.: Publicar 3 artigos" });
        if (t?.trim()) { updateGoal(g.id, { krs: [...krs, { id: uid("kr"), title: t.trim(), done: false }] }); render(); }
      } }, "＋ Resultado-chave")));
  });
  root.appendChild(grid);
}

const fmtNum = (n) => (Math.round(n * 10) / 10).toLocaleString("pt-BR");

function updateGoal(id, patch) {
  setSetting("timeGoals", goals().map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

function goalMenu(anchor, g) {
  showMenu(anchor, [
    { icon: "✎", title: "Editar meta", action: () => goalModal(g) },
    { icon: "📦", title: "Arquivar", action: () => { updateGoal(g.id, { archived: true }); render(); } },
    { sep: true },
    { icon: "🗑", title: "Excluir", danger: true, action: async () => {
      if (!(await confirmDialog({ title: "Excluir meta?", message: `“${g.title}” e seus resultados-chave serão removidos.`, confirmText: "Excluir", danger: true }))) return;
      setSetting("timeGoals", goals().filter((x) => x.id !== g.id));
      render();
    } },
  ]);
}

function showArchivedGoals() {
  const arch = goals().filter((g) => g.archived);
  const body = h("div", { class: "goal-arch" });
  arch.forEach((g) => body.appendChild(h("div", { class: "goal-arow" },
    h("span", {}, `${g.icon || "◎"} ${g.title}`),
    h("span", { class: "ga-period" }, periodLabel(g.period)),
    h("button", { class: "btn ghost sm", onclick: () => { updateGoal(g.id, { archived: false }); m.close(); render(); } }, "Restaurar"))));
  const m = showModal({ title: `Metas arquivadas (${arch.length})`, body, width: 480 });
}

function goalModal(g = null) {
  const fTitle = h("input", { class: "input", value: g?.title || "", placeholder: "Ex.: Terminar o curso de estatística" });
  const fIcon = h("input", { class: "input", value: g?.icon || "◎", style: "max-width:72px;text-align:center" });
  const fPeriod = h("select", { class: "input" });
  const opts = PERIODS();
  if (g?.period && !opts.some(([v]) => v === g.period)) opts.unshift([g.period, periodLabel(g.period)]);
  opts.forEach(([v, lbl]) => fPeriod.appendChild(h("option", { value: v, ...(g?.period === v ? { selected: true } : {}) }, lbl)));

  const fMetric = h("select", { class: "input" });
  [["manual", "Manual (eu atualizo)"], ["hours", "Horas registradas no cronômetro"], ["krs", "Fração dos resultados-chave"]]
    .forEach(([v, lbl]) => fMetric.appendChild(h("option", { value: v, ...((g?.metric || "manual") === v ? { selected: true } : {}) }, lbl)));

  const fTarget = h("input", { class: "input", type: "number", min: "1", value: String(g?.target || 10) });
  const fUnit = h("input", { class: "input", value: g?.unit || "", placeholder: "páginas, aulas…" });
  const fMatch = h("input", { class: "input", value: g?.match || "", placeholder: "filtro do rótulo (opcional)" });

  let color = g?.color || "purple";
  const sw = h("div", { class: "tb-colors" });
  COLORS.forEach((c) => {
    const b = h("button", { class: "tb-sw" + (c === color ? " on" : ""), style: `background:${col(c)}`, dataset: { color: c } });
    b.onclick = () => { color = c; sw.querySelectorAll(".tb-sw").forEach((x) => x.classList.toggle("on", x.dataset.color === c)); };
    sw.appendChild(b);
  });

  const extra = h("div", { class: "goal-extra" });
  const paintExtra = () => {
    extra.innerHTML = "";
    if (fMetric.value === "krs") { extra.appendChild(h("p", { class: "fg-hint" }, "O alvo passa a ser o número de resultados-chave concluídos.")); return; }
    extra.append(h("div", { class: "fg-row" }, field("Alvo", fTarget), fMetric.value === "hours" ? field("Unidade", h("span", { class: "fg-static" }, "horas")) : field("Unidade", fUnit)));
    if (fMetric.value === "hours") extra.appendChild(field("Contar só sessões que contenham", fMatch));
  };
  fMetric.onchange = paintExtra;
  paintExtra();

  const ok = h("button", { class: "btn primary" }, g ? "Salvar" : "Criar meta");
  const cancel = h("button", { class: "btn ghost" }, "Cancelar");
  const m = showModal({
    title: g ? "Editar meta" : "Nova meta",
    body: h("div", { class: "form-grid" },
      h("div", { class: "fg-row" }, field("Ícone", fIcon), field("Título", fTitle)),
      h("div", { class: "fg-row" }, field("Período", fPeriod), field("Progresso vem de", fMetric)),
      extra,
      field("Cor", sw)),
    footer: [cancel, ok], width: 560,
  });
  cancel.onclick = () => m.close();
  ok.onclick = () => {
    const title = fTitle.value.trim();
    if (!title) { toast("Dê um nome à meta", { type: "warn" }); return; }
    const data = {
      title, icon: fIcon.value.trim() || "◎", period: fPeriod.value,
      metric: fMetric.value, target: Math.max(1, +fTarget.value || 1),
      unit: fMetric.value === "hours" ? "h" : fUnit.value.trim(),
      match: fMatch.value.trim(), color,
    };
    if (g) updateGoal(g.id, data);
    else setSetting("timeGoals", [...goals(), { id: uid("g"), progress: 0, krs: [], archived: false, ...data }]);
    m.close();
    render();
  };
  focusSoon(fTitle);
}

/* ════════════════════════════════════════════════════════════
   5 · REVISÃO SEMANAL
   ════════════════════════════════════════════════════════════ */
function reviewData(weekStart) {
  const from = keyOf(weekStart), to = keyOf(addDays(weekStart, 6));
  const nextFrom = keyOf(addDays(weekStart, 7)), nextTo = keyOf(addDays(weekStart, 13));
  const today = todayKey();
  const all = collectTasks();

  const delivered = all.filter((t) => t.done && t.date && t.date >= from && t.date <= to);
  const open = all.filter((t) => !t.done && t.date && t.date >= from && t.date <= to);
  const next = all.filter((t) => !t.done && t.date && t.date >= nextFrom && t.date <= nextTo);

  const sessions = tt.sessionsBetween(from, to);
  const pomo = getSetting("pomodoroLog", {}) || {};
  let pomos = 0;
  for (let i = 0; i < 7; i++) pomos += pomo[keyOf(addDays(weekStart, i))] || 0;

  const habits = (getSetting("habits", []) || []).map((hb) => {
    let n = 0;
    for (let i = 0; i < 7; i++) if (hb.log?.[keyOf(addDays(weekStart, i))]) n++;
    return { name: hb.name, done: n };
  });

  let planned = 0, blocksDone = 0, blocksTotal = 0;
  for (let i = 0; i < 7; i++) {
    effectiveBlocks(keyOf(addDays(weekStart, i))).forEach((b) => {
      if (b.cancelled) return;
      planned += toMin(b.end) - toMin(b.start);
      blocksTotal++;
      if (b.done) blocksDone++;
    });
  }

  const pages = listPages();
  const fromTs = new Date(from + "T00:00:00").getTime();
  const toTs = new Date(to + "T23:59:59").getTime();
  const created = pages.filter((p) => p.createdAt >= fromTs && p.createdAt <= toTs);
  const edited = pages.filter((p) => p.updatedAt >= fromTs && p.updatedAt <= toTs && !(p.createdAt >= fromTs));

  return { from, to, delivered, open, overdue: open.filter((t) => t.date < today), next, sessions, pomos, habits, planned, blocksDone, blocksTotal, created, edited };
}

function renderReview(root) {
  const weekStart = addDays(state.week, state.reviewOffset * 7);
  const d = reviewData(weekStart);
  const sameWeek = keyOf(startOfWeek(new Date())) === d.from;

  root.appendChild(h("div", { class: "time-bar" },
    h("div", { class: "tb-nav" },
      h("button", { class: "btn ghost icon", onclick: () => { state.reviewOffset--; render(); } }, "◂"),
      h("button", { class: "btn ghost", onclick: () => { state.week = startOfWeek(new Date()); state.reviewOffset = 0; render(); } }, "Esta semana"),
      h("button", { class: "btn ghost icon", onclick: () => { state.reviewOffset++; render(); } }, "▸")),
    h("div", { class: "tb-title" }, `Revisão · ${fmtDate(d.from + "T12:00:00", { day: "numeric", month: "short" })} – ${fmtDate(d.to + "T12:00:00", { day: "numeric", month: "short" })}${sameWeek ? " (em curso)" : ""}`),
    h("div", { class: "tb-actions" },
      h("button", { class: "btn primary", onclick: () => saveReviewAsPage(d) }, "📄 Salvar como página"))));

  root.appendChild(h("div", { class: "home-stats", style: "margin:4px 0 18px" },
    kpi(String(d.delivered.length), "entregues"),
    kpi(String(d.overdue.length), "atrasadas"),
    kpi(tt.fmtDur(tt.totalSeconds(d.sessions)), "registradas"),
    kpi(String(d.pomos), "pomodoros")));

  const grid = h("div", { class: "rev-grid" });

  grid.appendChild(revCard("✓ Entregue nesta semana", d.delivered.length, d.delivered.slice(0, 12).map((t) =>
    revItem(t.icon, t.title, t.origin, () => (t.source === "row" ? navigate("db", t.dbId) : navigate("page", t.pageId)))),
    "Nada marcado como concluído com data desta semana."));

  grid.appendChild(revCard("⚠ Atrasado", d.overdue.length, d.overdue.slice(0, 12).map((t) =>
    revItem("⚠", t.title, `${t.origin} · venceu ${fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" })}`, () => (t.source === "row" ? navigate("db", t.dbId) : navigate("page", t.pageId)))),
    "Nada atrasado. 🎉"));

  grid.appendChild(revCard("→ Vem na próxima semana", d.next.length, d.next.slice(0, 12).map((t) =>
    revItem("📅", t.title, `${t.origin} · ${fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" })}`, () => (t.source === "row" ? navigate("db", t.dbId) : navigate("page", t.pageId)))),
    "Semana seguinte sem prazos — bom momento para planejar."));

  const timeRows = tt.byLabel(d.sessions).slice(0, 10).map((g) =>
    revItem("⏱", g.label, tt.fmtDur(g.seconds), null));
  grid.appendChild(revCard("⏱ Onde o tempo foi", timeRows.length, timeRows, "Nenhuma sessão registrada nesta semana."));

  const planRows = [
    revItem("🗓", "Tempo planejado em blocos", tt.fmtDur(d.planned * 60), null),
    revItem("✓", "Blocos cumpridos", `${d.blocksDone} de ${d.blocksTotal}`, null),
    ...(d.planned ? [revItem("Σ", "Planejado × registrado", `${tt.fmtDur(d.planned * 60)} × ${tt.fmtDur(tt.totalSeconds(d.sessions))}`, null)] : []),
  ];
  grid.appendChild(revCard("🗓 Plano da semana", d.blocksTotal, planRows, "Nenhum bloco planejado."));

  const habitRows = d.habits.filter((x) => x.done).map((x) => revItem("🔁", x.name, `${x.done}/7 dias`, null));
  grid.appendChild(revCard("🔁 Hábitos", habitRows.length, habitRows, "Nenhum hábito marcado nesta semana."));

  const pageRows = [
    ...d.created.slice(0, 6).map((p) => revItem(p.icon || "＋", p.title || "Sem título", "criada", () => navigate("page", p.id))),
    ...d.edited.slice(0, 6).map((p) => revItem(p.icon || "✎", p.title || "Sem título", "editada", () => navigate("page", p.id))),
  ];
  grid.appendChild(revCard("📄 Páginas", d.created.length + d.edited.length, pageRows, "Nenhuma página criada ou editada."));

  root.appendChild(grid);
}

function revCard(title, count, rows, empty) {
  return h("section", { class: "rev-card" },
    h("div", { class: "rev-head" }, h("h3", {}, title), h("span", { class: "rev-count" }, String(count))),
    rows.length ? h("div", { class: "rev-list" }, ...rows) : h("div", { class: "rev-empty" }, empty));
}

function revItem(icon, title, meta, go) {
  return h(go ? "button" : "div", {
    class: "rev-item" + (go ? " clickable" : ""),
    ...(go ? { onclick: go } : {}),
  },
    h("span", { class: "ri-icon" }, icon),
    h("span", { class: "ri-title" }, title),
    h("span", { class: "ri-meta" }, meta));
}

/* Exporta a revisão como página de verdade (blocos nativos) */
function saveReviewAsPage(d) {
  const blocks = [];
  const push = (type, content, props) => blocks.push(makeBlock(type, content, props));
  push("h2", "Resumo");
  push("bullet", `Entregues: <strong>${d.delivered.length}</strong>`);
  push("bullet", `Atrasadas: <strong>${d.overdue.length}</strong>`);
  push("bullet", `Tempo registrado: <strong>${tt.fmtDur(tt.totalSeconds(d.sessions))}</strong> · planejado em blocos: <strong>${tt.fmtDur(d.planned * 60)}</strong>`);
  push("bullet", `Pomodoros: <strong>${d.pomos}</strong> · blocos cumpridos: <strong>${d.blocksDone}/${d.blocksTotal}</strong>`);

  const sec = (title, items) => {
    push("h2", title);
    if (!items.length) push("p", "<em>Nada aqui.</em>");
    else items.forEach((t) => push("bullet", escapeHtml(t)));
  };
  sec("✓ Entregue", d.delivered.map((t) => `${t.title} — ${t.origin}`));
  sec("⚠ Atrasado", d.overdue.map((t) => `${t.title} — ${t.origin} (venceu ${t.date})`));
  sec("→ Próxima semana", d.next.map((t) => `${t.title} — ${t.origin} (${t.date})`));
  sec("⏱ Onde o tempo foi", tt.byLabel(d.sessions).map((g) => `${g.label} — ${tt.fmtDur(g.seconds)}`));

  push("h2", "Reflexão");
  push("todo", "O que funcionou bem?");
  push("todo", "O que travou?");
  push("todo", "Qual é a prioridade nº 1 da próxima semana?");

  const p = createPage({
    title: `Revisão da semana · ${fmtDate(d.from + "T12:00:00", { day: "numeric", month: "short" })} – ${fmtDate(d.to + "T12:00:00", { day: "numeric", month: "short", year: "numeric" })}`,
    icon: "✓",
    blocks,
  });
  toast("Revisão salva como página 📄");
  navigate("page", p.id);
}

const kpi = (n, label) => h("div", { class: "home-kpi" }, h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label));
