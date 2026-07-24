// ═══════════════ NEXUS · Produtividade (Pomodoro · Hábitos · Lembretes) ═══════════════

import { getSetting, setSetting } from "../core/store.js";
import { h, uid, todayKey, clamp, escapeHtml, fmtDate } from "../core/utils.js";
import { toast, confirmDialog, promptDialog, showMenu } from "../core/ui.js";
import { listReminders, saveReminders, requestNotifyPermission } from "../core/reminders.js";

const COLORS = ["slate", "blue", "green", "amber", "red", "purple", "teal"];
const chipClass = (c) => `hb-c-${COLORS.includes(c) ? c : "slate"}`;

let state = null; // { tab, container, cleanups: [] }

export default {
  async mount(container) {
    state = { tab: getSetting("prodTab", "pomodoro"), container, cleanups: [] };
    render();
  },
  unmount() {
    state?.cleanups.forEach((fn) => { try { fn(); } catch {} });
    state = null;
  },
};

function render() {
  const { container } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container productivity" });
  wrap.appendChild(h("h1", { class: "home-greeting" }, "Produtividade"));

  const tabs = [
    ["pomodoro", "🍅 Pomodoro"],
    ["habits", "🔁 Hábitos"],
    ["reminders", "⏰ Lembretes"],
  ];
  const tabBar = h("div", { class: "prod-tabs" });
  tabs.forEach(([id, label]) => tabBar.appendChild(h("button", {
    class: "prod-tab" + (state.tab === id ? " active" : ""),
    onclick: () => { state.tab = id; setSetting("prodTab", id); render(); },
  }, label)));
  wrap.appendChild(tabBar);

  const body = h("div", { class: "prod-body anim-fade" });
  wrap.appendChild(body);
  container.appendChild(wrap);

  if (state.tab === "pomodoro") renderPomodoro(body);
  else if (state.tab === "habits") renderHabits(body);
  else renderReminders(body);
}

/* ═══════════ POMODORO ═══════════ */
function pomoConfig() {
  return { focus: 25, short: 5, long: 15, sound: true, ...(getSetting("pomodoro", {}) || {}) };
}
function pomoLog() { return getSetting("pomodoroLog", {}) || {}; }

const pomo = { mode: "focus", remaining: 0, running: false, endAt: 0, tick: null, focusLabel: "" };

function renderPomodoro(root) {
  const cfg = pomoConfig();
  if (!pomo.remaining) pomo.remaining = cfg.focus * 60;

  const MODES = [["focus", "Foco", cfg.focus], ["short", "Pausa curta", cfg.short], ["long", "Pausa longa", cfg.long]];

  const modeBar = h("div", { class: "pomo-modes" });
  MODES.forEach(([id, label, min]) => modeBar.appendChild(h("button", {
    class: "pomo-mode" + (pomo.mode === id ? " active" : ""),
    onclick: () => { switchMode(id, min); render(); },
  }, `${label} · ${min}m`)));

  // anel de progresso
  const total = MODES.find((m) => m[0] === pomo.mode)[2] * 60;
  const ring = ringSvg();
  const timeText = h("div", { class: "pomo-time" }, fmtTime(pomo.remaining));
  const label = h("div", { class: "pomo-label" }, pomo.focusLabel || (pomo.mode === "focus" ? "Sessão de foco" : "Pausa"));
  const dial = h("div", { class: "pomo-dial" }, ring.svg, h("div", { class: "pomo-center" }, timeText, label));

  const startBtn = h("button", { class: "btn primary pomo-main" }, pomo.running ? "Pausar" : "Iniciar");
  startBtn.onclick = () => { pomo.running ? pausePomo() : startPomo(total); paintControls(); };
  const resetBtn = h("button", { class: "btn ghost", onclick: () => { resetPomo(total); render(); } }, "Zerar");

  const focusInput = h("input", {
    class: "input pomo-focus", placeholder: "Focando em… (opcional)",
    value: pomo.focusLabel,
    oninput: (e) => { pomo.focusLabel = e.target.value; label.textContent = e.target.value || (pomo.mode === "focus" ? "Sessão de foco" : "Pausa"); },
  });

  // estatísticas
  const log = pomoLog();
  const today = log[todayKey()] || 0;
  const week = last7Keys().reduce((n, k) => n + (log[k] || 0), 0);
  const totalAll = Object.values(log).reduce((a, b) => a + b, 0);
  const stats = h("div", { class: "pomo-stats" },
    kpi(today, "hoje"), kpi(week, "esta semana"), kpi(totalAll, "total"));

  const chart = weekBars(last7Keys().map((k) => log[k] || 0));

  const settingsBtn = h("button", {
    class: "btn ghost sm", onclick: (e) => pomoSettingsMenu(e),
  }, "⚙ Durações");

  root.append(
    modeBar, dial,
    h("div", { class: "pomo-controls" }, startBtn, resetBtn),
    focusInput,
    h("div", { class: "prod-section-title" }, "Foco desta semana"),
    chart, stats,
    h("div", { style: "display:flex;justify-content:center;margin-top:12px" }, settingsBtn),
  );

  // atualiza o anel/tempo em tempo real
  const updateRing = () => {
    const frac = clamp(pomo.remaining / total, 0, 1);
    ring.set(frac);
    timeText.textContent = fmtTime(pomo.remaining);
  };
  updateRing();
  const paintControls = () => { startBtn.textContent = pomo.running ? "Pausar" : "Iniciar"; };

  pomo.onUpdate = () => { updateRing(); };
  pomo.onDone = () => { updateRing(); render(); };
  state.cleanups.push(() => { pomo.onUpdate = null; pomo.onDone = null; });
}

function switchMode(id, min) {
  pausePomo();
  pomo.mode = id;
  pomo.remaining = min * 60;
}
function startPomo(total) {
  pomo.running = true;
  pomo.endAt = Date.now() + pomo.remaining * 1000;
  clearInterval(pomo.tick);
  pomo.tick = setInterval(() => {
    pomo.remaining = Math.max(0, Math.round((pomo.endAt - Date.now()) / 1000));
    pomo.onUpdate?.();
    if (pomo.remaining <= 0) completePomo();
  }, 250);
}
function pausePomo() {
  pomo.running = false;
  clearInterval(pomo.tick);
}
function resetPomo(total) {
  pausePomo();
  pomo.remaining = total;
}
function completePomo() {
  pausePomo();
  const cfg = pomoConfig();
  if (pomo.mode === "focus") {
    const log = pomoLog();
    const k = todayKey();
    log[k] = (log[k] || 0) + 1;
    setSetting("pomodoroLog", log);
    if (cfg.sound) beep();
    notify("🍅 Sessão de foco concluída!", pomo.focusLabel || "Hora de uma pausa.");
    // alterna automaticamente para pausa
    pomo.mode = "short"; pomo.remaining = cfg.short * 60;
  } else {
    if (cfg.sound) beep();
    notify("Pausa encerrada", "Pronto para focar de novo?");
    pomo.mode = "focus"; pomo.remaining = cfg.focus * 60;
  }
  pomo.onDone?.();
}

function pomoSettingsMenu(e) {
  const cfg = pomoConfig();
  showMenu(e.currentTarget, [
    { label: "Duração (minutos)" },
    { icon: "🎯", title: `Foco: ${cfg.focus} min`, action: async () => setDur("focus", cfg.focus) },
    { icon: "☕", title: `Pausa curta: ${cfg.short} min`, action: async () => setDur("short", cfg.short) },
    { icon: "🛋", title: `Pausa longa: ${cfg.long} min`, action: async () => setDur("long", cfg.long) },
    { sep: true },
    { icon: cfg.sound ? "🔔" : "🔕", title: cfg.sound ? "Som: ativado" : "Som: desativado",
      action: () => { setSetting("pomodoro", { ...cfg, sound: !cfg.sound }); render(); } },
  ]);
  async function setDur(key, cur) {
    const v = await promptDialog({ title: "Duração em minutos", value: String(cur) });
    const n = parseInt(v, 10);
    if (n > 0 && n <= 180) { setSetting("pomodoro", { ...cfg, [key]: n }); pomo.remaining = 0; render(); }
  }
}

/* ═══════════ HÁBITOS ═══════════ */
function habits() { return getSetting("habits", []) || []; }
function saveHabits(list) { setSetting("habits", list); }

function renderHabits(root) {
  const list = habits();

  const addBtn = h("button", { class: "btn primary", onclick: addHabit }, "＋ Novo hábito");
  root.appendChild(h("div", { class: "prod-toolbar" }, addBtn));

  if (!list.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "🔁"),
      h("div", { class: "es-title" }, "Nenhum hábito ainda"),
      h("div", { class: "es-desc" }, "Crie um hábito e marque cada dia — o mapa de calor mostra sua constância.")));
    return;
  }

  const today = todayKey();
  list.forEach((hb) => {
    const doneToday = !!hb.log?.[today];
    const streak = habitStreak(hb);

    const check = h("button", {
      class: "habit-today" + (doneToday ? " on" : "") + " " + chipClass(hb.color),
      title: doneToday ? "Concluído hoje" : "Marcar hoje",
      onclick: () => { toggleHabit(hb.id, today); },
    }, doneToday ? "✓" : "");

    const head = h("div", { class: "habit-head" },
      h("span", { class: "habit-icon" }, hb.icon || "🔁"),
      h("div", { class: "habit-info" },
        h("div", { class: "habit-name" }, hb.name),
        h("div", { class: "habit-meta" }, streak > 0 ? `🔥 ${streak} ${streak === 1 ? "dia" : "dias"} seguidos` : "sem sequência ativa")),
      check,
      h("button", { class: "icon-btn", "aria-label": "Opções", onclick: (e) => habitMenu(e, hb) }, "⋯"));

    const card = h("div", { class: "habit-card card" }, head, heatmap(hb));
    root.appendChild(card);
  });
}

function heatmap(hb) {
  const grid = h("div", { class: "heatmap" });
  const today = new Date();
  const start = new Date(today); start.setDate(start.getDate() - 83);
  start.setDate(start.getDate() - start.getDay()); // volta ao domingo
  const cur = new Date(start);
  let col = h("div", { class: "hm-col" });
  const todayK = todayKey();
  while (cur <= today || col.children.length % 7 !== 0) {
    const k = todayKey(cur);
    const future = cur > today;
    const done = !!hb.log?.[k];
    const cell = h("div", {
      class: "hm-cell" + (done ? " on " + chipClass(hb.color) : "") + (k === todayK ? " today" : "") + (future ? " future" : ""),
      title: future ? "" : fmtDate(k + "T12:00:00", { day: "numeric", month: "short" }) + (done ? " · ✓" : ""),
      onclick: future ? null : () => toggleHabit(hb.id, k),
    });
    col.appendChild(cell);
    if (col.children.length === 7) { grid.appendChild(col); col = h("div", { class: "hm-col" }); }
    cur.setDate(cur.getDate() + 1);
  }
  if (col.children.length) grid.appendChild(col);
  return grid;
}

function habitStreak(hb) {
  let streak = 0;
  const d = new Date();
  if (!hb.log?.[todayKey(d)]) d.setDate(d.getDate() - 1);
  while (hb.log?.[todayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function toggleHabit(id, dateKey) {
  const list = habits();
  const hb = list.find((x) => x.id === id);
  if (!hb) return;
  hb.log = hb.log || {};
  if (hb.log[dateKey]) delete hb.log[dateKey];
  else hb.log[dateKey] = true;
  saveHabits(list);
  render();
}

async function addHabit() {
  const name = await promptDialog({ title: "Novo hábito", placeholder: "Ex.: Exercício, Ler, Meditar" });
  if (!name) return;
  const list = habits();
  const icons = ["🏃", "📖", "🧘", "💧", "🥗", "😴", "✍️", "🎯"];
  list.push({ id: uid("hb"), name, icon: icons[list.length % icons.length], color: COLORS[list.length % COLORS.length], log: {} });
  saveHabits(list);
  render();
}

function habitMenu(e, hb) {
  e.stopPropagation();
  showMenu(e.currentTarget, [
    { icon: "✎", title: "Renomear", action: async () => {
      const name = await promptDialog({ title: "Renomear hábito", value: hb.name });
      if (name) { const l = habits(); l.find((x) => x.id === hb.id).name = name; saveHabits(l); render(); }
    } },
    { label: "Cor" },
    ...COLORS.map((c) => ({ icon: hb.color === c ? "●" : "○", title: c, action: () => {
      const l = habits(); l.find((x) => x.id === hb.id).color = c; saveHabits(l); render();
    } })),
    { sep: true },
    { icon: "🗑", title: "Excluir hábito", danger: true, action: async () => {
      const ok = await confirmDialog({ title: "Excluir hábito?", message: `“${hb.name}” e todo o histórico serão removidos.`, confirmText: "Excluir", danger: true });
      if (ok) { saveHabits(habits().filter((x) => x.id !== hb.id)); render(); }
    } },
  ]);
}

/* ═══════════ LEMBRETES ═══════════ */
function renderReminders(root) {
  const list = listReminders();

  const addBtn = h("button", { class: "btn primary", onclick: addReminder }, "＋ Novo lembrete");
  const permBadge = notifBadge();
  root.appendChild(h("div", { class: "prod-toolbar" }, addBtn, permBadge));

  const now = Date.now();
  const pending = list.filter((r) => !r.done);
  const done = list.filter((r) => r.done);

  if (!pending.length && !done.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "⏰"),
      h("div", { class: "es-title" }, "Nenhum lembrete"),
      h("div", { class: "es-desc" }, "Agende lembretes locais — o navegador te notifica na hora, sem servidor.")));
    return;
  }

  const listEl = h("div", { class: "reminder-list" });
  pending.forEach((r) => listEl.appendChild(reminderRow(r, now)));
  if (done.length) {
    listEl.appendChild(h("div", { class: "prod-section-title" }, "Concluídos"));
    done.slice(0, 10).forEach((r) => listEl.appendChild(reminderRow(r, now)));
  }
  root.appendChild(listEl);
}

function reminderRow(r, now) {
  const overdue = !r.done && r.at <= now;
  const check = h("button", {
    class: "todo-check" + (r.done ? " checked" : ""), title: r.done ? "Reabrir" : "Concluir",
    onclick: () => { const l = listReminders(); const x = l.find((y) => y.id === r.id); x.done = !x.done; saveReminders(l); render(); },
  }, "✓");
  return h("div", { class: "reminder-item card" + (r.done ? " done" : "") },
    check,
    h("div", { class: "ri-body" },
      h("div", { class: "ri-title" }, r.title),
      h("div", { class: "ri-when" + (overdue ? " overdue" : "") },
        (overdue ? "⚠ venceu · " : "⏰ ") + fmtWhen(r.at))),
    h("button", { class: "icon-btn", "aria-label": "Excluir", onclick: async () => {
      saveReminders(listReminders().filter((x) => x.id !== r.id)); render();
    } }, "✕"));
}

async function addReminder() {
  const perm = await requestNotifyPermission();
  const title = h("input", { class: "input", placeholder: "Sobre o que é o lembrete?" });
  const dt = h("input", { class: "input", type: "datetime-local", value: defaultWhen() });
  const { showModal } = await import("../core/ui.js");
  const ok = h("button", { class: "btn primary" }, "Agendar");
  const cancel = h("button", { class: "btn ghost" }, "Cancelar");
  const m = showModal({
    title: "⏰ Novo lembrete",
    body: h("div", { style: "display:flex;flex-direction:column;gap:10px" },
      title, dt,
      perm === "denied" ? h("div", { style: "font-size:var(--fs-xs);color:var(--warn)" },
        "Notificações bloqueadas no navegador — você verá um aviso dentro do app.") : null),
    footer: [cancel, ok], width: 420,
  });
  cancel.onclick = () => m.close();
  ok.onclick = () => {
    const at = new Date(dt.value).getTime();
    if (!title.value.trim() || !at || isNaN(at)) { toast("Preencha título e data", { type: "warn" }); return; }
    const l = listReminders();
    l.push({ id: uid("rm"), title: title.value.trim(), at, done: false, fired: at <= Date.now() });
    saveReminders(l);
    m.close();
    toast("Lembrete agendado ⏰");
    render();
  };
  setTimeout(() => title.focus(), 50);
}

function notifBadge() {
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  if (perm === "granted") return h("span", { class: "chip c-green" }, "🔔 Notificações ativas");
  if (perm === "unsupported") return h("span", { class: "chip" }, "Sem suporte a notificações");
  const b = h("button", { class: "chip", style: "cursor:pointer", onclick: async () => { await requestNotifyPermission(); render(); } },
    "🔕 Ativar notificações");
  return b;
}

/* ═══════════ helpers ═══════════ */
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function fmtWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " · " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function defaultWhen() {
  const d = new Date(Date.now() + 3600000);
  d.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function last7Keys() {
  const out = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(todayKey(d)); }
  return out;
}
function kpi(n, label) {
  return h("div", { class: "home-kpi" }, h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label));
}
function weekBars(data) {
  const max = Math.max(...data, 1);
  const labels = ["D", "S", "T", "Q", "Q", "S", "S"];
  const now = new Date();
  const wrap = h("div", { class: "week-bars" });
  data.forEach((v, i) => {
    const d = new Date(now); d.setDate(now.getDate() - (6 - i));
    const bar = h("div", { class: "wb-col" },
      h("div", { class: "wb-track" }, h("div", { class: "wb-fill", style: `height:${(v / max) * 100}%` })),
      h("div", { class: "wb-label" }, labels[d.getDay()]),
      h("div", { class: "wb-val" }, v ? String(v) : ""));
    wrap.appendChild(bar);
  });
  return wrap;
}
function ringSvg() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 120"); svg.setAttribute("class", "pomo-ring");
  const bg = document.createElementNS(NS, "circle");
  const fg = document.createElementNS(NS, "circle");
  [bg, fg].forEach((c) => { c.setAttribute("cx", "60"); c.setAttribute("cy", "60"); c.setAttribute("r", "54"); c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "8"); });
  bg.setAttribute("class", "ring-bg");
  fg.setAttribute("class", "ring-fg"); fg.setAttribute("stroke-linecap", "round");
  const C = 2 * Math.PI * 54;
  fg.setAttribute("stroke-dasharray", String(C));
  fg.setAttribute("transform", "rotate(-90 60 60)");
  svg.append(bg, fg);
  return { svg, set: (frac) => { fg.setAttribute("stroke-dashoffset", String(C * (1 - frac))); } };
}
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 680;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.62);
  } catch {}
}
function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body }); return; } catch {}
  }
  toast(title, { type: "ok", icon: "🍅", duration: 5000 });
}
