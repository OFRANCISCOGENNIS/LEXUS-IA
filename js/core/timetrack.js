// ═══════════════ NEXUS · Controle de tempo (cronômetro + sessões) ═══════════════
// O cronômetro vive aqui, e não dentro da tela, por dois motivos:
//  1) continua contando enquanto você navega pelo app;
//  2) sobrevive a recarregar a página — o que fica gravado é o INSTANTE de
//     início, nunca um contador, então o tempo é sempre recalculado do relógio.
// Tudo 100% local (settings → IndexedDB).

import { getSetting, setSetting } from "./store.js";
import { bus } from "./bus.js";
import { uid, todayKey } from "./utils.js";

const MAX_SESSIONS = 3000;   // teto para a lista não crescer sem limite
const MIN_SECONDS = 5;       // sessões mais curtas que isso são descartadas

/* ── Cronômetro ativo ── */
export const activeTimer = () => getSetting("timeActive", null);

export const elapsedOf = (t = activeTimer()) =>
  t ? Math.max(0, Math.floor((Date.now() - t.startedAt) / 1000)) : 0;

export function startTimer({ label = "Foco", ref = null } = {}) {
  if (activeTimer()) stopTimer();
  const t = {
    id: uid("tt"),
    label: String(label || "Foco").trim().slice(0, 140) || "Foco",
    ref: ref || null,
    startedAt: Date.now(),
  };
  setSetting("timeActive", t);
  bus.emit("timer:changed", { type: "start", timer: t });
  return t;
}

export function stopTimer() {
  const t = activeTimer();
  if (!t) return null;
  setSetting("timeActive", null);
  const end = Date.now();
  const seconds = Math.floor((end - t.startedAt) / 1000);
  let session = null;
  if (seconds >= MIN_SECONDS) {
    session = {
      id: t.id, label: t.label, ref: t.ref,
      start: t.startedAt, end, seconds,
      date: todayKey(new Date(t.startedAt)),
    };
    writeSessions([...listSessions(), session], { silent: true });
  }
  bus.emit("timer:changed", { type: "stop", session });
  return session;
}

export const toggleTimer = (opts) => (activeTimer() ? stopTimer() : startTimer(opts));

/* ── Sessões registradas ── */
export const listSessions = () => getSetting("timeSessions", []) || [];

function writeSessions(list, { silent = false } = {}) {
  const trimmed = list.slice(-MAX_SESSIONS);
  setSetting("timeSessions", trimmed);
  if (!silent) bus.emit("timer:changed", { type: "sessions" });
  return trimmed;
}

export function addSession({ label = "Foco", date = todayKey(), minutes = 30, ref = null } = {}) {
  const mins = Math.max(1, Math.min(24 * 60, Math.round(Number(minutes) || 0)));
  // lançamento manual: ancora no meio do dia (12h) só para ter um horário válido
  const start = new Date(date + "T12:00:00").getTime();
  const s = {
    id: uid("tt"), label: String(label || "Foco").trim().slice(0, 140) || "Foco",
    ref, start, end: start + mins * 60000, seconds: mins * 60, date, manual: true,
  };
  writeSessions([...listSessions(), s]);
  return s;
}

export function removeSession(id) {
  writeSessions(listSessions().filter((s) => s.id !== id));
}

export const sessionsBetween = (fromKey, toKey) =>
  listSessions().filter((s) => s.date >= fromKey && s.date <= toKey);

export const totalSeconds = (list) => list.reduce((a, s) => a + (s.seconds || 0), 0);

/* Agrupa por rótulo → [{ label, seconds }] (maior primeiro) */
export function byLabel(list) {
  const map = new Map();
  list.forEach((s) => map.set(s.label, (map.get(s.label) || 0) + (s.seconds || 0)));
  return [...map.entries()].map(([label, seconds]) => ({ label, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

/* ── Formatação ── */
export function fmtDur(sec = 0) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh}h ${String(mm).padStart(2, "0")}min` : `${hh}h`;
}

export function fmtClock(sec = 0) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (n) => String(n).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
