// ═══════════════ NEXUS · Espaço da equipe ═══════════════
// Cada pessoa continua dona do seu workspace. O que circula aqui é um
// RELATÓRIO compacto — tarefas, prazos, horas e números da semana —, nunca o
// conteúdo das páginas. O relatório é cifrado neste aparelho com a senha da
// equipe (AES-GCM) antes de subir, e a senha nunca sai do dispositivo: nem o
// servidor nem a sincronização pessoal a recebem.
//
// Transporte: REST direto do Supabase (PostgREST). Sem SDK e sem backend
// nosso — o mesmo projeto que já serve a sincronização.

import { getSetting, setSetting, listPages, listDatabases } from "./store.js";
import { bus } from "./bus.js";
import { uid, todayKey } from "./utils.js";
import { collectTasks } from "../modules/tasks.js";
import * as tt from "./timetrack.js";
import * as sync from "./sync.js";

export const REPORT_VERSION = 1;
const TABLE = "team_reports";
const MAX_TASKS = 80;

/* ═══════════ configuração ═══════════ */
const DEFAULTS = { id: "", name: "", memberId: "", memberName: "", color: "blue", autoPublish: true, shareTitles: true };

export const teamConfig = () => ({ ...DEFAULTS, ...(getSetting("teamSpace", {}) || {}) });
export function setTeamConfig(patch) {
  const next = { ...teamConfig(), ...patch };
  setSetting("teamSpace", next);
  bus.emit("team:changed", { type: "config", config: next });
  return next;
}
/* a senha da equipe mora fora do objeto de config e fora do sync */
export const teamSecret = () => getSetting("teamKey", "") || "";
export const setTeamSecret = (pass) => setSetting("teamKey", String(pass || ""));

export const teamReady = () => {
  const c = teamConfig();
  return !!(c.id && c.memberId && teamSecret());
};
export const teamOnline = () => !!(getSetting("supabaseUrl", "") && getSetting("supabaseKey", ""));

/* ═══════════ criptografia (chave da equipe) ═══════════ */
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

let keyCache = { pass: null, id: null, key: null };
async function teamKey() {
  const pass = teamSecret(), id = teamConfig().id;
  if (!pass || !id) throw new Error("Entre num espaço de equipe primeiro.");
  if (keyCache.key && keyCache.pass === pass && keyCache.id === id) return keyCache.key;
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("nexus-team:" + id.toLowerCase()), iterations: 150000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  keyCache = { pass, id, key };
  return key;
}

async function encryptReport(report) {
  const key = await teamKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(report)));
  return { data: b64(cipher), iv: b64(iv) };
}
async function decryptReport(dataB64, ivB64) {
  const key = await teamKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(dataB64));
  return JSON.parse(dec.decode(new Uint8Array(plain)));
}

/* ═══════════ datas da semana ═══════════ */
export function weekRange(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return { from: todayKey(d), to: todayKey(end) };
}

/* ═══════════ o relatório ═══════════
   Só metadados de trabalho. Páginas privadas e conteúdo de blocos ficam fora. */
export function buildReport({ note = "" } = {}) {
  const c = teamConfig();
  const { from, to } = weekRange();
  const today = todayKey();
  const privateIds = new Set(listPages({ includeArchived: true }).filter((p) => p.private).map((p) => p.id));

  const all = collectTasks().filter((t) => !(t.source === "block" && privateIds.has(t.pageId)));
  const pending = all.filter((t) => !t.done);
  const overdue = pending.filter((t) => t.date && t.date < today);
  const doneWeek = all.filter((t) => t.done && t.date && t.date >= from && t.date <= to);
  const dueWeek = pending.filter((t) => t.date && t.date >= from && t.date <= to);

  const hide = !c.shareTitles;
  const slim = (t, late = false) => ({
    id: `${t.source}:${t.rowId || t.blockId}`,
    title: hide ? "(título oculto)" : String(t.title || "Sem nome").slice(0, 140),
    date: t.date || null,
    done: !!t.done,
    origin: hide ? "" : String(t.origin || "").slice(0, 60),
    late,
  });

  const sessions = tt.sessionsBetween(from, to);
  const blocks = getSetting("timeBlocks", {}) || {};
  let plannedMin = 0, blocksDone = 0, blocksTotal = 0;
  Object.entries(blocks).forEach(([k, list]) => {
    if (k < from || k > to) return;
    (list || []).forEach((b) => {
      if (b.cancelled) return;
      const toMin = (s) => { const [a, m] = String(s || "0:0").split(":").map(Number); return (a || 0) * 60 + (m || 0); };
      plannedMin += Math.max(0, toMin(b.end) - toMin(b.start));
      blocksTotal++;
      if (b.done) blocksDone++;
    });
  });

  const pomoLog = getSetting("pomodoroLog", {}) || {};
  let pomodoros = 0;
  Object.entries(pomoLog).forEach(([k, n]) => { if (k >= from && k <= to) pomodoros += n || 0; });

  return {
    v: REPORT_VERSION,
    member: { id: c.memberId, name: c.memberName || "Sem nome", color: c.color || "blue" },
    at: Date.now(),
    range: { from, to },
    counts: {
      pending: pending.length,
      overdue: overdue.length,
      doneWeek: doneWeek.length,
      dueWeek: dueWeek.length,
      trackedSec: tt.totalSeconds(sessions),
      plannedMin, blocksDone, blocksTotal, pomodoros,
      pages: listPages().length,
      databases: listDatabases().length,
    },
    tasks: [
      ...overdue.map((t) => slim(t, true)),
      ...dueWeek.filter((t) => !(t.date && t.date < today)).map((t) => slim(t)),
      ...doneWeek.map((t) => slim(t)),
    ].slice(0, MAX_TASKS),
    time: tt.byLabel(sessions).slice(0, 10).map((g) => (hide ? { label: "(oculto)", seconds: g.seconds } : g)),
    note: String(note || "").slice(0, 400),
    titlesHidden: hide,
  };
}

/* ═══════════ cache local dos relatórios recebidos ═══════════ */
export const storedReports = () => getSetting("teamReports", {}) || {};
function storeReports(map) {
  setSetting("teamReports", map);
  bus.emit("team:changed", { type: "reports", count: Object.keys(map).length });
}
export function mergeReport(report) {
  if (!report?.member?.id) throw new Error("Relatório sem identificação de membro.");
  const map = { ...storedReports() };
  const cur = map[report.member.id];
  if (cur && cur.at > report.at) return cur;            // já temos um mais novo
  map[report.member.id] = report;
  storeReports(map);
  return report;
}
export function forgetMember(memberId) {
  const map = { ...storedReports() };
  delete map[memberId];
  storeReports(map);
}

/* Relatórios de todo mundo (o meu é sempre recalculado na hora) */
export function allReports() {
  const c = teamConfig();
  const list = Object.values(storedReports()).filter((r) => r?.member?.id !== c.memberId);
  if (c.memberId) list.unshift({ ...buildReport(), me: true });
  return list.sort((a, b) => (a.me ? -1 : b.me ? 1 : (a.member.name || "").localeCompare(b.member.name || "")));
}

/* ═══════════ transporte (Supabase REST) ═══════════ */
const base = () => String(getSetting("supabaseUrl", "") || "").replace(/\/+$/, "");
const anon = () => getSetting("supabaseKey", "") || "";

async function rest(path, init = {}) {
  if (!teamOnline()) throw new Error("Configure a sincronização (URL e chave do Supabase) para usar o espaço online.");
  const token = (await sync.authToken()) || anon();
  let res;
  try {
    res = await fetch(`${base()}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: anon(), Authorization: `Bearer ${token}`,
        "Content-Type": "application/json", ...(init.headers || {}),
      },
    });
  } catch {
    throw new Error(`Não consegui falar com ${base()}. Confira a conexão e a URL do projeto.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = "";
    try { msg = JSON.parse(text)?.message || ""; } catch { msg = text.slice(0, 160); }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`O Supabase recusou (HTTP ${res.status}). Entre na sua conta em Configurações → Conta & Sincronização${msg ? ` — ${msg}` : ""}.`);
    }
    if (res.status === 404 || /relation .* does not exist/i.test(msg)) {
      throw new Error("A tabela team_reports ainda não existe no seu projeto. Rode o SQL mostrado nas Configurações.");
    }
    throw new Error(`Falha no espaço da equipe (HTTP ${res.status})${msg ? ` — ${msg}` : ""}`);
  }
  return res;
}

export async function publishReport({ note = "" } = {}) {
  const c = teamConfig();
  if (!teamReady()) throw new Error("Entre num espaço de equipe primeiro.");
  const report = buildReport({ note });
  const { data, iv } = await encryptReport(report);
  const user = sync.currentUser?.();
  await rest(`${TABLE}?on_conflict=team_id,member_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      team_id: c.id, member_id: c.memberId,
      ...(user?.id ? { user_id: user.id } : {}),
      data, iv, updated_at: new Date().toISOString(),
    }),
  });
  setTeamConfig({ lastPublish: Date.now() });
  bus.emit("team:changed", { type: "published", at: Date.now() });
  return report;
}

/* Busca os relatórios da equipe; devolve {ok, novos, ignorados} */
export async function pullReports() {
  const c = teamConfig();
  if (!teamReady()) throw new Error("Entre num espaço de equipe primeiro.");
  const res = await rest(`${TABLE}?team_id=eq.${encodeURIComponent(c.id)}&select=member_id,data,iv,updated_at`);
  const rows = await res.json();
  let novos = 0, ignorados = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.member_id === c.memberId) continue;          // o meu é recalculado na hora
    try {
      const report = await decryptReport(row.data, row.iv);
      mergeReport(report);
      novos++;
    } catch { ignorados++; }                              // senha diferente → não é da minha equipe
  }
  setTeamConfig({ lastPull: Date.now() });
  bus.emit("team:changed", { type: "pulled", novos, ignorados });
  return { ok: true, novos, ignorados };
}

/* ═══════════ troca por arquivo (sem servidor nenhum) ═══════════ */
export const exportReport = (opts) => JSON.stringify(buildReport(opts), null, 2);
export function importReport(json) {
  const report = typeof json === "string" ? JSON.parse(json) : json;
  if (!report?.v || !report?.member?.id) throw new Error("Esse arquivo não é um relatório do NEXUS.");
  return mergeReport(report);
}

/* ═══════════ entrar / sair de um espaço ═══════════ */
export function joinTeam({ id, pass, memberName, color = "blue", teamName = "" }) {
  const cleanId = String(id || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!cleanId) throw new Error("Dê um identificador ao espaço (ex.: time-produto).");
  if (!String(pass || "").trim()) throw new Error("A senha da equipe é obrigatória — é ela que cifra os relatórios.");
  keyCache = { pass: null, id: null, key: null };
  setTeamSecret(String(pass).trim());
  return setTeamConfig({
    id: cleanId,
    name: teamName || cleanId,
    memberId: teamConfig().memberId || uid("m"),
    memberName: String(memberName || "").trim() || "Eu",
    color,
  });
}

export function leaveTeam({ keepReports = false } = {}) {
  keyCache = { pass: null, id: null, key: null };
  setTeamSecret("");
  if (!keepReports) setSetting("teamReports", {});
  setTeamConfig({ id: "", name: "" });
  bus.emit("team:changed", { type: "left" });
}

export const SETUP_SQL = `create table if not exists team_reports (
  team_id text not null,
  member_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  data text, iv text,
  updated_at timestamptz default now(),
  primary key (team_id, member_id)
);
alter table team_reports enable row level security;
-- quem está logado no projeto lê os relatórios (o conteúdo é cifrado com a senha da equipe)
create policy "team read" on team_reports for select to authenticated using (true);
create policy "own insert" on team_reports for insert to authenticated with check (auth.uid() = user_id);
create policy "own update" on team_reports for update to authenticated using (auth.uid() = user_id);`;

/* ═══════════ publicação automática ═══════════
   Nada de ficar subindo a cada tecla: marca "sujo" e, no máximo a cada 5
   minutos, puxa o que há de novo e publica se algo mudou de fato. */
let autoTimer = null, autoOffs = [], dirty = false;

export function startAutoTeam() {
  stopAutoTeam();
  if (!teamReady() || !teamOnline() || !teamConfig().autoPublish) return;
  const mark = () => { dirty = true; };
  autoOffs.push(bus.on("pages:changed", mark), bus.on("dbs:changed", mark), bus.on("settings:changed", mark));
  autoTimer = setInterval(async () => {
    try { await pullReports(); } catch {}
    if (!dirty) return;
    dirty = false;
    try { await publishReport(); } catch {}
  }, 300000);
}

export function stopAutoTeam() {
  clearInterval(autoTimer);
  autoTimer = null;
  autoOffs.forEach((off) => { try { off(); } catch {} });
  autoOffs = [];
}
