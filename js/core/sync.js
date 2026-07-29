// ═══════════════ NEXUS · Conta & Sincronização (Supabase + E2E) ═══════════════
// Login por e-mail/senha e sync entre dispositivos. Os dados são CIFRADOS no
// dispositivo (AES-GCM, chave derivada da senha via PBKDF2) antes de subir —
// o servidor guarda apenas texto cifrado. O app continua local-first: sem
// configurar/entrar, tudo funciona 100% offline como antes.

import { getSetting, setSetting, exportWorkspace, importWorkspace } from "./store.js";
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
function setStatus(s, extra = {}) { status = s; bus.emit("sync:status", { status: s, user, ...extra }); }
export function syncState() { return { status, user, configured: isConfigured(), unlocked: !!encKey }; }
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
    await importWorkspace(data, { merge: true }); // remoto vence em conflito por id
    lastPulledAt = remote.updated_at || null;
    setStatus("ready", { at: Date.now() });
  } catch (e) { setStatus("error", { message: e.message }); }
}

async function firstSync() {
  const remote = await fetchRemote().catch(() => null);
  if (remote) { const data = await decryptJSON(remote.data, remote.iv); await importWorkspace(data, { merge: true }); }
  await pushNow();
}

function startAuto() {
  clearInterval(pullTimer);
  pullTimer = setInterval(() => pullNow(), 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pullNow(); });
  // empurra mudanças locais (debounced)
  const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => pushNow().catch(() => {}), 4000); };
  bus.on("pages:changed", schedulePush);
  bus.on("dbs:changed", schedulePush);
  bus.on("settings:changed", ({ key }) => { if (!key.startsWith("supabase") && key !== "recentPages") schedulePush(); });
}

/* ── SQL de setup (mostrado nas Configurações) ── */
export const SETUP_SQL = `create table if not exists workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text, iv text,
  updated_at timestamptz default now()
);
alter table workspaces enable row level security;
create policy "own row" on workspaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

export async function initSync() {
  await resumeSession();
  if (status === "ready" || status === "locked") return;
}
