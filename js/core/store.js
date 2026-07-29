// ═══════════════ NEXUS · Store (camada de dados do workspace) ═══════════════
// Cache em memória + persistência IndexedDB (debounced). Fonte única de verdade.

import { idb } from "./db.js";
import { bus } from "./bus.js";
import { uid, debounce, stripHtml, todayKey, countWords } from "./utils.js";

const pages = new Map();      // id -> page
const databases = new Map();  // id -> database
const settings = new Map();   // key -> value
let ready = false;

/* ── Modelos ── */
export function makeBlock(type = "p", content = "", props = {}) {
  return { id: uid("b"), type, content, props, children: [] };
}

export function makePage(partial = {}) {
  const now = Date.now();
  return {
    id: uid("p"),
    title: "",
    icon: "",
    cover: "",
    type: "page",           // "page" | "daily"
    journalDate: null,       // "YYYY-MM-DD" para daily notes
    parentId: null,
    blocks: [makeBlock()],
    tags: [],
    favorite: false,
    archived: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function makeDatabase(partial = {}) {
  const now = Date.now();
  const pStatus = { id: uid("pr"), name: "Status", type: "select",
    options: [
      { id: uid("o"), name: "A fazer", color: "gray" },
      { id: uid("o"), name: "Em andamento", color: "blue" },
      { id: uid("o"), name: "Concluído", color: "green" },
    ] };
  const pPrio = { id: uid("pr"), name: "Prioridade", type: "select",
    options: [
      { id: uid("o"), name: "Alta", color: "red" },
      { id: uid("o"), name: "Média", color: "amber" },
      { id: uid("o"), name: "Baixa", color: "gray" },
    ] };
  const pDate = { id: uid("pr"), name: "Prazo", type: "date" };
  return {
    id: uid("d"),
    name: "Nova database",
    icon: "▦",
    description: "",
    properties: [
      { id: "title", name: "Nome", type: "title" },
      pStatus, pPrio, pDate,
    ],
    rows: [],
    views: [
      { id: uid("v"), name: "Tabela", type: "table", filters: [], sorts: [], groupBy: null },
      { id: uid("v"), name: "Kanban", type: "kanban", filters: [], sorts: [], groupBy: pStatus.id },
    ],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function makeRow(db, values = {}) {
  const now = Date.now();
  return { id: uid("r"), values, createdAt: now, updatedAt: now };
}

/* ── Persistência (debounced por entidade) ── */
const persistPage = debounce((page) => idb.put("pages", page), 400);
const persistDb = debounce((d) => idb.put("databases", d), 400);

async function persistAllDirty() {
  persistPage.cancel(); persistDb.cancel();
  await Promise.all([
    idb.putMany("pages", [...pages.values()]),
    idb.putMany("databases", [...databases.values()]),
  ]);
}
addEventListener("beforeunload", () => { persistAllDirty(); });

/* ── Init + seed ── */
export async function initStore() {
  if (ready) return;
  const [pgs, dbs, sts] = await Promise.all([
    idb.getAll("pages"), idb.getAll("databases"), idb.getAll("settings"),
  ]);
  pgs.forEach((p) => pages.set(p.id, p));
  dbs.forEach((d) => databases.set(d.id, d));
  sts.forEach((s) => settings.set(s.key, s.value));
  if (pages.size === 0 && dbs.length === 0) await seed();
  ready = true;
}

async function seed() {
  const welcome = makePage({
    title: "Bem-vindo ao NEXUS",
    icon: "◆",
    blocks: [
      makeBlock("h1", "Bem-vindo ao NEXUS"),
      makeBlock("p", "Seu workspace all-in-one <b>100% local</b> — sem API, sem servidor, sem conta. Tudo o que você escreve vive apenas neste dispositivo."),
      makeBlock("h2", "Comece por aqui"),
      makeBlock("todo", "Pressione <code>Ctrl/⌘ K</code> para abrir o command palette"),
      makeBlock("todo", "Digite <code>/</code> em qualquer linha para inserir blocos"),
      makeBlock("todo", "Selecione um texto para formatar"),
      makeBlock("todo", "Crie uma database e arraste cartões no Kanban"),
      makeBlock("todo", "Use <code>[[</code> para linkar páginas — backlinks aparecem no rodapé"),
      makeBlock("h2", "Privacidade absoluta"),
      makeBlock("quote", "Seus dados nunca saem do dispositivo."),
      makeBlock("p", "Explore o grafo de conhecimento, as notas diárias e os templates na barra lateral."),
    ],
  });
  pages.set(welcome.id, welcome);

  const demo = makeDatabase({ name: "Projetos", icon: "▲" });
  const [stTodo, stDoing, stDone] = demo.properties[1].options;
  const [prHigh, prMed] = demo.properties[2].options;
  demo.rows = [
    makeRow(demo, { title: "Lançar o NEXUS", [demo.properties[1].id]: stDoing.id, [demo.properties[2].id]: prHigh.id }),
    makeRow(demo, { title: "Escrever documentação", [demo.properties[1].id]: stTodo.id, [demo.properties[2].id]: prMed.id }),
    makeRow(demo, { title: "Organizar workspace", [demo.properties[1].id]: stDone.id, [demo.properties[2].id]: prHigh.id }),
  ];
  databases.set(demo.id, demo);

  await Promise.all([idb.put("pages", welcome), idb.put("databases", demo)]);
  settings.set("firstPageId", welcome.id);
  await idb.put("settings", { key: "firstPageId", value: welcome.id });
}

/* ── Páginas ── */
export const listPages = ({ includeArchived = false } = {}) =>
  [...pages.values()]
    .filter((p) => includeArchived || !p.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);

export const getPage = (id) => pages.get(id) || null;

export function createPage(partial = {}) {
  const p = makePage(partial);
  pages.set(p.id, p);
  idb.put("pages", p);
  bus.emit("pages:changed", { type: "create", id: p.id });
  return p;
}

export function updatePage(id, patch, { silent = false } = {}) {
  const p = pages.get(id);
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: Date.now() });
  persistPage(p);
  if (!silent) bus.emit("pages:changed", { type: "update", id });
  return p;
}

export function touchPageBlocks(id) {
  // blocos mutados in-place pelo editor — só persiste e notifica levemente
  const p = pages.get(id);
  if (!p) return;
  p.updatedAt = Date.now();
  persistPage(p);
  bus.emit("pages:changed", { type: "blocks", id });
}

export async function deletePage(id) {
  const p = pages.get(id);
  if (!p) return;
  pages.delete(id);
  persistPage.cancel();
  await idb.del("pages", id);
  await idb.put("trash", { id: uid("t"), kind: "page", data: p, deletedAt: Date.now() });
  bus.emit("pages:changed", { type: "delete", id });
}

export function duplicatePage(id) {
  const p = pages.get(id);
  if (!p) return null;
  const copy = makePage({
    ...structuredClone({ ...p }),
    id: undefined, title: `${p.title || "Sem título"} (cópia)`,
    createdAt: undefined, updatedAt: undefined,
  });
  copy.id = uid("p");
  copy.blocks = structuredClone(p.blocks).map((b) => ({ ...b, id: uid("b") }));
  pages.set(copy.id, copy);
  idb.put("pages", copy);
  bus.emit("pages:changed", { type: "create", id: copy.id });
  return copy;
}

/* Daily notes */
export function getOrCreateDaily(dateKey = todayKey()) {
  let p = [...pages.values()].find((x) => x.type === "daily" && x.journalDate === dateKey);
  if (!p) {
    const d = new Date(dateKey + "T12:00:00");
    p = createPage({
      type: "daily",
      journalDate: dateKey,
      title: d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }),
      icon: "☀",
      blocks: [
        makeBlock("h2", "Hoje"),
        makeBlock("todo", ""),
        makeBlock("h2", "Notas"),
        makeBlock("p", ""),
      ],
    });
  }
  return p;
}

/* ── Versões ── */
export async function snapshotPage(id) {
  const p = pages.get(id);
  if (!p) return;
  const versions = await idb.getAllByIndex("versions", "pageId", id);
  const last = versions.sort((a, b) => b.ts - a.ts)[0];
  const snapshotData = JSON.stringify(p.blocks);
  if (last && JSON.stringify(last.blocks) === snapshotData) return; // sem mudanças
  await idb.put("versions", {
    id: uid("v"), pageId: id, ts: Date.now(),
    title: p.title, blocks: structuredClone(p.blocks),
  });
  // mantém no máximo 30 versões por página
  const all = (await idb.getAllByIndex("versions", "pageId", id)).sort((a, b) => b.ts - a.ts);
  for (const v of all.slice(30)) await idb.del("versions", v.id);
}
export const listVersions = async (pageId) =>
  (await idb.getAllByIndex("versions", "pageId", pageId)).sort((a, b) => b.ts - a.ts);
export async function restoreVersion(pageId, versionId) {
  const v = await idb.get("versions", versionId);
  if (!v) return;
  await snapshotPage(pageId);
  updatePage(pageId, { blocks: structuredClone(v.blocks) });
}

/* ── Databases ── */
export const listDatabases = () =>
  [...databases.values()].sort((a, b) => b.updatedAt - a.updatedAt);

export const getDatabase = (id) => databases.get(id) || null;

export function createDatabase(partial = {}) {
  const d = makeDatabase(partial);
  databases.set(d.id, d);
  idb.put("databases", d);
  bus.emit("dbs:changed", { type: "create", id: d.id });
  return d;
}

export function updateDatabase(id, patch = {}, { silent = false } = {}) {
  const d = databases.get(id);
  if (!d) return null;
  Object.assign(d, patch, { updatedAt: Date.now() });
  persistDb(d);
  if (!silent) bus.emit("dbs:changed", { type: "update", id });
  return d;
}

export function touchDatabase(id) {
  const d = databases.get(id);
  if (!d) return;
  d.updatedAt = Date.now();
  persistDb(d);
  bus.emit("dbs:changed", { type: "rows", id });
}

export async function deleteDatabase(id) {
  const d = databases.get(id);
  if (!d) return;
  databases.delete(id);
  persistDb.cancel();
  await idb.del("databases", id);
  await idb.put("trash", { id: uid("t"), kind: "database", data: d, deletedAt: Date.now() });
  bus.emit("dbs:changed", { type: "delete", id });
}

/* ── Lixeira ── */
export const listTrash = async () =>
  (await idb.getAll("trash")).sort((a, b) => b.deletedAt - a.deletedAt);

export async function restoreFromTrash(trashId) {
  const item = await idb.get("trash", trashId);
  if (!item) return;
  if (item.kind === "page") {
    pages.set(item.data.id, item.data);
    await idb.put("pages", item.data);
    bus.emit("pages:changed", { type: "create", id: item.data.id });
  } else if (item.kind === "database") {
    databases.set(item.data.id, item.data);
    await idb.put("databases", item.data);
    bus.emit("dbs:changed", { type: "create", id: item.data.id });
  }
  await idb.del("trash", trashId);
}

export async function purgeTrash(trashId = null) {
  if (trashId) await idb.del("trash", trashId);
  else await idb.clear("trash");
}

/* ── Settings ── */
export const getSetting = (key, fallback = null) =>
  settings.has(key) ? settings.get(key) : fallback;

export function setSetting(key, value) {
  settings.set(key, value);
  idb.put("settings", { key, value });
  bus.emit("settings:changed", { key, value });
}

/* ── Texto / busca / links ── */
export function pageText(p) {
  const parts = [p.title];
  const walk = (blocks) => blocks.forEach((b) => {
    parts.push(stripHtml(b.content || ""));
    if (b.children?.length) walk(b.children);
  });
  walk(p.blocks || []);
  return parts.join("\n");
}

export function pageWordCount(p) { return countWords(pageText(p)); }

/* ── Índice de busca: texto cacheado + índice invertido (token → páginas) ──
   Sem ele, cada tecla no palette reconstruía o texto de TODAS as páginas.
   Com ele, a digitação só examina páginas candidatas que contêm os termos. */
const textCache = new Map();  // pageId → texto minúsculo
const postings = new Map();   // token → Set(pageId)
const pageTokens = new Map(); // pageId → Set(token), para remoção incremental
let indexReady = false;

function tokenize(s) {
  const out = new Set();
  for (const m of s.toLowerCase().matchAll(/[\p{L}\p{N}]{2,}/gu)) out.add(m[0]);
  return out;
}

function unindexPage(id) {
  textCache.delete(id);
  const toks = pageTokens.get(id);
  if (!toks) return;
  toks.forEach((t) => {
    const s = postings.get(t);
    if (s) { s.delete(id); if (!s.size) postings.delete(t); }
  });
  pageTokens.delete(id);
}

function indexPage(p) {
  unindexPage(p.id);
  if (!p || p.archived) return;
  const text = pageText(p).toLowerCase();
  textCache.set(p.id, text);
  const toks = tokenize(text);
  pageTokens.set(p.id, toks);
  toks.forEach((t) => {
    let s = postings.get(t);
    if (!s) postings.set(t, (s = new Set()));
    s.add(p.id);
  });
}

function ensureIndex() {
  if (indexReady) return;
  textCache.clear(); postings.clear(); pageTokens.clear();
  for (const p of pages.values()) indexPage(p);
  indexReady = true;
}

bus.on("pages:changed", (e) => {
  if (!indexReady) return;
  if (e?.type === "delete") { unindexPage(e.id); return; }
  const p = e?.id ? pages.get(e.id) : null;
  if (p) indexPage(p);
  else indexReady = false; // import/lote → reconstrói na próxima busca
});

export function searchAll(query, { limit = 30 } = {}) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  ensureIndex();

  // candidatas: interseção das páginas que têm cada termo (match parcial,
  // igual à semântica de substring da busca original)
  let candidates = null;
  for (const term of tokenize(q)) {
    const withTerm = new Set();
    for (const [tok, ids] of postings) {
      if (tok.includes(term)) ids.forEach((id) => withTerm.add(id));
    }
    candidates = candidates ? new Set([...candidates].filter((id) => withTerm.has(id))) : withTerm;
    if (!candidates.size) break;
  }

  const results = [];
  const scan = candidates ? [...candidates].map((id) => pages.get(id)).filter(Boolean) : [...pages.values()];
  for (const p of scan) {
    if (p.archived) continue;
    const title = (p.title || "").toLowerCase();
    const text = textCache.get(p.id) ?? pageText(p).toLowerCase();
    const ti = title.indexOf(q);
    const ci = text.indexOf(q);
    if (ti >= 0 || ci >= 0) {
      let snippet = "";
      if (ci >= 0) {
        const raw = pageText(p);
        const start = Math.max(0, ci - 40);
        snippet = (start > 0 ? "…" : "") + raw.slice(start, ci + q.length + 60).replace(/\n/g, " ") + "…";
      }
      results.push({
        kind: "page", id: p.id, title: p.title || "Sem título", icon: p.icon || "▢",
        snippet, score: ti === 0 ? 100 : ti > 0 ? 60 : 20,
        updatedAt: p.updatedAt,
      });
    }
  }
  for (const d of databases.values()) {
    if ((d.name || "").toLowerCase().includes(q))
      results.push({ kind: "database", id: d.id, title: d.name, icon: d.icon || "▦", snippet: "", score: 80, updatedAt: d.updatedAt });
    for (const r of d.rows) {
      const t = String(r.values?.title || "");
      if (t.toLowerCase().includes(q))
        results.push({ kind: "row", id: d.id, rowId: r.id, title: t, icon: "•", snippet: `em ${d.name}`, score: 40, updatedAt: r.updatedAt });
    }
  }
  return results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit);
}

/* Wiki-links: extrai títulos referenciados em [[...]] e data-page-id */
export function pageLinks(p) {
  const ids = new Set();
  const walk = (blocks) => blocks.forEach((b) => {
    const c = b.content || "";
    for (const m of c.matchAll(/data-page-id="([^"]+)"/g)) ids.add(m[1]);
    if (b.children?.length) walk(b.children);
  });
  walk(p.blocks || []);
  return [...ids];
}

export function backlinksTo(pageId) {
  const out = [];
  for (const p of pages.values()) {
    if (p.id === pageId || p.archived) continue;
    if (pageLinks(p).includes(pageId)) out.push(p);
  }
  return out;
}

/* Menções não linkadas: páginas cujo texto cita o título desta página */
export function unlinkedMentions(pageId) {
  const target = pages.get(pageId);
  if (!target || !target.title || target.title.length < 3) return [];
  const t = target.title.toLowerCase();
  const out = [];
  for (const p of pages.values()) {
    if (p.id === pageId || p.archived) continue;
    if (pageLinks(p).includes(pageId)) continue;
    if (pageText(p).toLowerCase().includes(t)) out.push(p);
  }
  return out;
}

/* Grafo: nós + arestas de todos os wiki-links */
export function knowledgeGraph() {
  const nodes = listPages().map((p) => ({ id: p.id, title: p.title || "Sem título", icon: p.icon, links: 0 }));
  const idSet = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (const p of pages.values()) {
    if (p.archived) continue;
    for (const to of pageLinks(p)) {
      if (idSet.has(to)) edges.push({ from: p.id, to });
    }
  }
  const degree = new Map();
  edges.forEach((e) => {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  });
  nodes.forEach((n) => { n.links = degree.get(n.id) || 0; });
  return { nodes, edges };
}

/* ── Estatísticas ── */
export function workspaceStats() {
  const pgs = listPages({ includeArchived: true });
  let words = 0;
  pgs.forEach((p) => { words += pageWordCount(p); });
  return {
    pages: pgs.length,
    databases: databases.size,
    rows: [...databases.values()].reduce((n, d) => n + d.rows.length, 0),
    words,
  };
}

/* ── Export / Import ── */
export async function exportWorkspace() {
  await persistAllDirty();
  const [pgs, dbs, sts, trash] = await Promise.all([
    idb.getAll("pages"), idb.getAll("databases"), idb.getAll("settings"), idb.getAll("trash"),
  ]);
  return {
    app: "nexus", version: 1, exportedAt: new Date().toISOString(),
    pages: pgs, databases: dbs, settings: sts, trash,
  };
}

export async function importWorkspace(data, { merge = true } = {}) {
  if (!data || data.app !== "nexus") throw new Error("Arquivo de backup inválido");
  if (!merge) {
    pages.clear(); databases.clear();
    await Promise.all([idb.clear("pages"), idb.clear("databases")]);
  }
  (data.pages || []).forEach((p) => pages.set(p.id, p));
  (data.databases || []).forEach((d) => databases.set(d.id, d));
  await Promise.all([
    idb.putMany("pages", data.pages || []),
    idb.putMany("databases", data.databases || []),
  ]);
  bus.emit("pages:changed", { type: "import" });
  bus.emit("dbs:changed", { type: "import" });
}
