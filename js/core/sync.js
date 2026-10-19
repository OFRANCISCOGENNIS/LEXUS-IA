// ═══════════════ NEXUS · Conta & Sincronização (Supabase + E2E) ═══════════════
// Login por e-mail/senha e sync entre dispositivos. Os dados são CIFRADOS no
// dispositivo (AES-GCM, chave derivada da senha via PBKDF2) antes de subir —
// o servidor guarda apenas texto cifrado. O app continua local-first: sem
// configurar/entrar, tudo funciona 100% offline como antes.

import { getSetting, setSetting, exportWorkspace, importWorkspace, deviceName } from "./store.js";
import { bus } from "./bus.js";

const SUPABASE_CDN = "https://esm.sh/@supabase/supabase-js@2";
const TABLE = "workspaces";

let client = null;
let encKey = null;      // CryptoKey da sessão (nunca persiste)
let user = null;
let pushTimer = null;
let pullTimer = null;
let status = "off";     // off | ready | syncing | error | locked

/* ── Estado / eventos ── */
let lastPushAt = null, lastPullAt = null;
function setStatus(s, extra = {}) { status = s; bus.emit("sync:status", { status: s, user, ...extra }); }
export function syncState() {
  return {
    status, user, configured: isConfigured(), unlocked: !!encKey,
    lastPushAt, lastPullAt,
    lastSyncAt: lastPushAt || lastPullAt || getSetting("lastSyncAt", null),
    device: deviceName(),
    remoteDevice: getSetting("lastRemoteDevice", null),
  };
}
function markSync(kind) {
  const now = Date.now();
  if (kind === "push") lastPushAt = now; else lastPullAt = now;
  setSetting("lastSyncAt", now);   // local-only: não entra no snapshot
}
export const isConfigured = () => !!(getSetting("supabaseUrl", "") && getSetting("supabaseKey", ""));

/* ── Config ── */
export function saveConfig(url, key) {
  setSetting("supabaseUrl", (url || "").trim().replace(/\/$/, ""));
  setSetting("supabaseKey", (key || "").trim());
  client = null;
}

async function getClient() {
  if (client) return client;
  if (!isConfigured()) throw new Error("Configure a URL e a chave do Supabase primeiro.");
  const { createClient } = await import(/* @vite-ignore */ SUPABASE_CDN);
  client = createClient(getSetting("supabaseUrl"), getSetting("supabaseKey"), {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "nexus-supabase-auth" },
  });
  return client;
}

/* ── Criptografia (WebCrypto) ── */
const enc = new TextEncoder();
const dec = new TextDecoder();
// base64 em blocos: espalhar um buffer grande em String.fromCharCode estoura a pilha
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

/* gzip antes de criptografar (~5-10× menos tráfego); descompressão detecta
   o magic number, então payloads antigos sem compressão continuam legíveis */
async function gzipBytes(bytes) {
  if (typeof CompressionStream === "undefined") return bytes;
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
async function gunzipBytes(bytes) {
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

async function deriveKey(password, email) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("nexus:" + email.toLowerCase()), iterations: 150000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptJSON(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await gzipBytes(enc.encode(typeof obj === "string" ? obj : JSON.stringify(obj)));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, packed);
  return { cipher: b64(cipher), iv: b64(iv) };
}
async function decryptJSON(cipherB64, ivB64) {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, encKey, unb64(cipherB64)));
  const bytes = plain[0] === 0x1f && plain[1] === 0x8b ? await gunzipBytes(plain) : plain;
  return JSON.parse(dec.decode(bytes));
}

/* ── Autenticação ── */
export async function signUp(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw error;
  user = data.user;
  encKey = await deriveKey(password, email);
  if (user) { await firstSync(); setStatus("ready"); }
  return data;
}

export async function signIn(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  user = data.user;
  encKey = await deriveKey(password, email);
  await firstSync();
  startAuto();
  setStatus("ready");
  return data;
}

export async function signOut() {
  try { const c = await getClient(); await c.auth.signOut(); } catch {}
  user = null; encKey = null;
  clearInterval(pullTimer); clearTimeout(pushTimer);
  autoOffs.forEach((off) => off()); autoOffs = [];
  lastPushHash = null; lastPulledAt = null;
  setStatus("off");
}

/* Reidrata a sessão ao abrir o app (sem a senha ainda → estado "locked") */
export async function resumeSession() {
  if (!isConfigured()) return;
  try {
    const c = await getClient();
    const { data } = await c.auth.getSession();
    if (data?.session?.user) {
      user = data.session.user;
      setStatus("locked"); // precisa da senha para derivar a chave de descriptografia
    }
  } catch (e) { /* offline / sem config */ }
}

/* Reabre a sessão fornecendo a senha (deriva a chave e sincroniza) */
export async function unlock(password) {
  if (!user) throw new Error("Sem sessão ativa.");
  encKey = await deriveKey(password, user.email);
  try {
    const remote = await fetchRemote();
    if (remote) await decryptJSON(remote.data, remote.iv); // valida a senha
  } catch {
    encKey = null;
    throw new Error("Senha incorreta para descriptografar.");
  }
  await firstSync();
  startAuto();
  setStatus("ready");
}

/* ── Sincronização ── */
async function fetchRemote() {
  const c = await getClient();
  const { data, error } = await c.from(TABLE).select("data,iv,updated_at").eq("user_id", user.id).maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

let lastPushHash = null;   // hash do último snapshot enviado → evita uploads redundantes
let lastPulledAt = null;   // updated_at do último pull → evita re-importar sem mudança

export async function pushNow({ force = false } = {}) {
  if (!user || !encKey) return;
  const snapshot = await exportWorkspace();
  const json = JSON.stringify(snapshot);
  const hash = b64(await crypto.subtle.digest("SHA-256", enc.encode(json)));
  if (!force && hash === lastPushHash) return; // nada mudou desde o último push
  setStatus("syncing");
  try {
    const { cipher, iv } = await encryptJSON(json);
    const c = await getClient();
    const { error } = await c.from(TABLE).upsert({
      user_id: user.id, data: cipher, iv, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    lastPushHash = hash;
    markSync("push");
    setStatus("ready", { at: Date.now() });
  } catch (e) { setStatus("error", { message: e.message }); throw e; }
}

export async function pullNow() {
  if (!user || !encKey) return;
  try {
    const remote = await fetchRemote();
    if (!remote) return;
    if (remote.updated_at && remote.updated_at === lastPulledAt) return; // remoto inalterado
    const data = await decryptJSON(remote.data, remote.iv);
    // mescla item a item pelo updatedAt (o mais recente vence dos dois lados)
    const stats = await importWorkspace(data, { merge: true });
    if (data.device) setSetting("lastRemoteDevice", data.device);
    lastPulledAt = remote.updated_at || null;
    markSync("pull");
    setStatus("ready", { at: Date.now(), stats });
  } catch (e) { setStatus("error", { message: e.message }); }
}

async function firstSync() {
  const remote = await fetchRemote().catch(() => null);
  if (remote) { const data = await decryptJSON(remote.data, remote.iv); await importWorkspace(data, { merge: true }); }
  await pushNow();
}

let autoOffs = [];
function startAuto() {
  // idempotente: sign-out→sign-in repetido não deve empilhar listeners/timers
  autoOffs.forEach((off) => off());
  autoOffs = [];
  clearInterval(pullTimer);
  pullTimer = setInterval(() => pullNow(), 45000);
  const onVisible = () => { if (!document.hidden) pullNow(); };
  document.addEventListener("visibilitychange", onVisible);
  autoOffs.push(() => document.removeEventListener("visibilitychange", onVisible));
  // empurra mudanças locais (debounced)
  const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => pushNow().catch(() => {}), 4000); };
  autoOffs.push(bus.on("pages:changed", schedulePush));
  autoOffs.push(bus.on("dbs:changed", schedulePush));
  // teamKey é o segredo da equipe: fica só neste aparelho, nem cifrado sobe
  const EPHEMERAL_KEYS = new Set(["recentPages", "sidebarExpanded", "timeActive", "teamKey"]);
  autoOffs.push(bus.on("settings:changed", ({ key }) => { if (!key.startsWith("supabase") && !EPHEMERAL_KEYS.has(key)) schedulePush(); }));
}

/* Token da sessão (para chamadas REST diretas, como o espaço da equipe).
   Sem sessão ou sem rede devolve null — quem chama decide o fallback. */
let tokenMiss = 0;
export async function authToken() {
  // sem rede/CDN o import do SDK demora: erra uma vez e segura por 1 min
  if (Date.now() - tokenMiss < 60000) return null;
  try {
    const c = await getClient();
    const { data } = await c.auth.getSession();
    return data?.session?.access_token || null;
  } catch { tokenMiss = Date.now(); return null; }
}
export const currentUser = () => user;

/* ── Diagnóstico ──
   Checa o projeto com fetch puro (sem SDK): cada passo diz exatamente o que
   fazer quando falha. É o que transforma "configurei e não funciona" em algo
   resolvível sem adivinhação. */
export async function diagnose() {
  const url = String(getSetting("supabaseUrl", "") || "").replace(/\/+$/, "");
  const key = getSetting("supabaseKey", "") || "";
  const steps = [];
  const add = (name, ok, detail, fix = "") => steps.push({ name, ok, detail, fix });

  if (!url || !key) {
    add("Projeto configurado", false, "URL ou chave ausente", "Preencha a URL do projeto e a chave pública (Settings → API Keys).");
    return { ok: false, steps };
  }
  add("Projeto configurado", true, url.replace(/^https:\/\//, ""));

  // 1) API REST responde?
  try {
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key } });
    if (r.ok || r.status === 404) add("API do projeto responde", true, `HTTP ${r.status}`);
    else if (r.status === 401) add("API do projeto responde", false, "HTTP 401", "A chave pública não confere. Copie de novo em Settings → API Keys (Publishable key, ou a anon public na aba Legacy).");
    else add("API do projeto responde", false, `HTTP ${r.status}`, "Confira a URL do projeto.");
  } catch {
    add("API do projeto responde", false, "sem resposta",
      "Confira a URL (https://xxxx.supabase.co), a conexão, e se o projeto não está pausado por inatividade no painel do Supabase.");
  }

  // 2) tabela workspaces existe?
  try {
    const r = await fetch(`${url}/rest/v1/${TABLE}?select=user_id&limit=1`, { headers: { apikey: key } });
    const body = await r.text();
    if (r.ok) add("Tabela de sincronização", true, "workspaces encontrada");
    else if (/does not exist/i.test(body) || r.status === 404) {
      add("Tabela de sincronização", false, "workspaces não existe",
        "Abra SQL Editor → New query no Supabase, cole o SQL desta tela e clique em Run.");
    } else if (r.status === 401 || r.status === 403) {
      add("Tabela de sincronização", true, "existe (protegida por RLS, como deve ser)");
    } else add("Tabela de sincronização", false, `HTTP ${r.status}`, "Rode o SQL de setup novamente.");
  } catch {
    add("Tabela de sincronização", false, "sem resposta", "Resolva o passo anterior primeiro.");
  }

  // 3) serviço de contas no ar?
  try {
    const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    add("Serviço de contas", r.ok, r.ok ? "no ar" : `HTTP ${r.status}`,
      r.ok ? "" : "O projeto pode estar pausado — abra o painel do Supabase e reative.");
  } catch {
    add("Serviço de contas", false, "sem resposta", "O projeto pode estar pausado no Supabase.");
  }

  // 4) criptografia funciona neste navegador?
  try {
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode("nexus"));
    const back = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, c));
    add("Criptografia no aparelho", back === "nexus", back === "nexus" ? "AES-256-GCM ok" : "falhou",
      back === "nexus" ? "" : "Abra o app por https:// ou http://localhost — WebCrypto exige contexto seguro.");
  } catch {
    add("Criptografia no aparelho", false, "indisponível",
      "Abra o app por https:// ou http://localhost — WebCrypto exige contexto seguro.");
  }

  // 5) sessão
  add("Sua conta", !!user, user ? user.email : "sem sessão neste aparelho",
    user ? "" : "Entre com e-mail e senha para sincronizar.");

  return { ok: steps.every((s) => s.ok), steps };
}

/* ── SQL de setup (mostrado nas Configurações) ── */
export const SETUP_SQL = `-- NEXUS · sincronização. Pode rodar quantas vezes quiser.
create table if not exists workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text,
  iv text,
  updated_at timestamptz default now()
);

alter table workspaces enable row level security;

-- recria a regra de acesso (cada pessoa só enxerga a própria linha)
drop policy if exists "own row" on workspaces;
create policy "own row" on workspaces
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

select 'tabela workspaces pronta' as nexus;`;

export async function initSync() {
  await resumeSession();
  if (status === "ready" || status === "locked") return;
}
