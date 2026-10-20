// ═══════════════ NEXUS · Importador do Notion ═══════════════
// Lê o export "Markdown & CSV" do Notion (.zip, ou os arquivos soltos) e
// converte em páginas e databases do NEXUS. Tudo acontece no navegador:
// o arquivo não sai do aparelho.
//
// Como é um export do Notion:
//   Minha página 1a2b3c…hex.md          → página
//   Minha página 1a2b3c…hex/            → pasta com as sub-páginas e imagens
//   Meu banco 4d5e6f…hex.csv            → database (cada .md dentro da pasta é uma linha)
//   Meu banco 4d5e6f…hex_all.csv        → a mesma database, com todas as views

import { parseCsv, guessType } from "./csv.js";
import { markdownToBlocks } from "./markdown.js";
import { bytesToText, bytesToDataUrl, mimeOf, isImage } from "./zip.js";
import { makeBlock, makePage, makeDatabase, makeRow, createPage, createDatabase } from "./store.js";
import { uid } from "./utils.js";

const HEX_ID = /\s+[0-9a-f]{32}$/i;          // o sufixo que o Notion gruda no nome
const MAX_IMAGE = 2 * 1024 * 1024;           // 2 MB por imagem
const MAX_IMAGE_TOTAL = 40 * 1024 * 1024;    // 40 MB no total

const baseName = (path) => path.split("/").pop() || path;
const dirName = (path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const stripExt = (name) => name.replace(/\.[^.]+$/, "");
const cleanTitle = (name) => stripExt(baseName(name)).replace(HEX_ID, "").trim() || "Sem título";
/* chave de identidade sem o hash: casa "Página abc123.md" com a pasta "Página abc123/" */
const keyOf = (path) => stripExt(path).replace(HEX_ID, "").trim().toLowerCase();
/* o Notion exporta a mesma database duas vezes: "Banco abc.csv" e "Banco abc_all.csv".
   O "_all" vem DEPOIS do hash, então precisa sair antes de tirar o hash. */
const dbKey = (path) => stripExt(path).replace(/_all$/i, "").replace(HEX_ID, "").trim().toLowerCase();

/* ─────────── 1 · o que tem no export ─────────── */
export function analyzeNotion(files) {
  const mds = [], csvs = [], images = [], others = [];
  for (const f of files) {
    const n = f.name;
    if (/(^|\/)__MACOSX\//.test(n) || /(^|\/)\.DS_Store$/.test(n)) continue;
    if (/\.md$/i.test(n)) mds.push(f);
    else if (/\.csv$/i.test(n)) csvs.push(f);
    else if (isImage(n)) images.push(f);
    else others.push(f);
  }

  // databases: ignora o "_all.csv" quando existe a versão normal do mesmo banco
  const byBase = new Map();
  for (const c of csvs) {
    // csv sem nenhuma linha útil não vira database vazia e quebrada
    if (!bytesToText(c.bytes).trim()) continue;
    const base = dbKey(c.name);
    const cur = byBase.get(base);
    if (!cur || /_all\.csv$/i.test(cur.name)) byBase.set(base, c);
  }
  const databases = [...byBase.values()];

  // pastas que pertencem a uma database → os .md lá dentro são as linhas
  const dbDirs = new Set(databases.map((c) => dbKey(c.name)));
  const isRowPage = (path) => {
    const dir = dirName(path);
    return !!dir && dbDirs.has(keyOf(dir));
  };

  const pages = mds.filter((f) => !isRowPage(f.name));
  const rowPages = mds.filter((f) => isRowPage(f.name));

  return {
    pages, databases, rowPages, images, others,
    counts: {
      pages: pages.length, databases: databases.length,
      rowPages: rowPages.length, images: images.length, others: others.length,
    },
  };
}

/* ─────────── 2 · markdown do Notion → blocos ─────────── */
function stripNotionHeader(md, title) {
  const lines = md.replace(/\r/g, "").split("\n");
  let i = 0;
  // título repetido como H1
  if (lines[i]?.trim().replace(/^#\s+/, "").trim() === title.trim() && /^#\s+/.test(lines[i].trim())) i++;
  else if (/^#\s+/.test(lines[i]?.trim() || "")) i++;
  while (lines[i] !== undefined && lines[i].trim() === "") i++;
  // bloco de propriedades ("Status: Em andamento") que o Notion escreve após o título
  let j = i;
  while (lines[j] !== undefined && /^[^:\n]{1,40}:\s*.*$/.test(lines[j]) && lines[j].trim() !== "") j++;
  if (j > i && (lines[j] === undefined || lines[j].trim() === "")) i = j;
  return lines.slice(i).join("\n").trim();
}

/* Resolve o caminho relativo de uma imagem dentro do export */
function resolveAsset(fromPath, href, assetMap) {
  let rel = decodeURIComponent(href.trim());
  if (/^https?:/i.test(rel)) return null;
  rel = rel.replace(/^\.\//, "");
  const dir = dirName(fromPath);
  const candidates = [dir ? `${dir}/${rel}` : rel, rel, baseName(rel)];
  for (const c of candidates) {
    const hit = assetMap.get(c) || assetMap.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/* Converte o corpo em blocos, trocando imagens locais por data: URL */
export function notionMdToBlocks(md, { path = "", title = "", assetMap = new Map(), budget = { used: 0 } } = {}) {
  const body = stripNotionHeader(md, title);
  const blocks = [];
  let buffer = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text) blocks.push(...markdownToBlocks(text));
  };

  for (const line of body.split("\n")) {
    const only = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (only) {
      const asset = resolveAsset(path, only[2], assetMap);
      flush();
      if (asset && asset.bytes.length <= MAX_IMAGE && budget.used + asset.bytes.length <= MAX_IMAGE_TOTAL) {
        budget.used += asset.bytes.length;
        blocks.push(makeBlock("image", "", { src: bytesToDataUrl(asset.bytes, mimeOf(asset.name) || "image/png"), caption: only[1] || "" }));
      } else {
        blocks.push(makeBlock("p", `<em>[imagem não importada: ${escapeText(baseName(decodeURIComponent(only[2])))}]</em>`));
      }
      continue;
    }
    buffer.push(wikifyLinks(line));
  }
  flush();
  return blocks.length ? blocks : [makeBlock()];
}

const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* [Título](Outra%20pagina%20abc123.md) → [[Título]] (wiki-link do NEXUS) */
function wikifyLinks(line) {
  return line.replace(/\[([^\]]+)\]\(([^)]+\.md)\)/gi, (_, label) => `[[${label}]]`);
}

/* ─────────── 3 · CSV do Notion → database ─────────── */
export function notionCsvToDatabase(name, csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return null;
  const header = rows[0].map((hname, i) => String(hname || `Coluna ${i + 1}`).trim());
  const body = rows.slice(1);

  const db = makeDatabase({ name, icon: "▦" });
  db.properties = [{ id: "title", name: header[0] || "Nome", type: "title" }];
  db.views = [{ id: uid("v"), name: "Tabela", type: "table", filters: [], sorts: [], groupBy: null }];

  const extra = header.slice(1).map((hname, idx) => {
    const col = body.map((r) => r[idx + 1] ?? "");
    const uniq = new Set(col.map((v) => v.trim()).filter(Boolean));
    const multi = col.some((v) => v.includes(",")) && [...uniq].every((v) => v.length < 60);
    let type = guessType(col);
    // o Notion escreve select/multi-select como texto puro: poucos valores curtos
    // e repetidos viram select; nomes/notas longos continuam texto
    const curtos = [...uniq].every((v) => v.length <= 40);
    if (type === "text" && uniq.size && curtos && uniq.size <= Math.max(8, Math.round(body.length * 0.6))) {
      type = multi ? "multiselect" : "select";
    }
    return { id: uid("pr"), name: hname || `Coluna ${idx + 2}`, type, options: [] };
  });

  const COLORS = ["blue", "green", "amber", "red", "purple", "gray"];
  extra.forEach((prop, idx) => {
    if (prop.type !== "select" && prop.type !== "multiselect") return;
    const values = new Set();
    body.forEach((r) => String(r[idx + 1] ?? "").split(prop.type === "multiselect" ? "," : "\u0000")
      .forEach((v) => { const t = v.trim(); if (t) values.add(t); }));
    prop.options = [...values].slice(0, 60).map((n, i) => ({ id: uid("o"), name: n, color: COLORS[i % COLORS.length] }));
  });
  db.properties.push(...extra);

  db.rows = body.map((r) => {
    const row = makeRow(db, { title: String(r[0] ?? "").trim() || "Sem nome" });
    extra.forEach((prop, idx) => {
      const raw = String(r[idx + 1] ?? "").trim();
      if (!raw) return;
      if (prop.type === "select") {
        row.values[prop.id] = prop.options.find((o) => o.name === raw)?.id || null;
      } else if (prop.type === "multiselect") {
        row.values[prop.id] = raw.split(",").map((v) => v.trim()).filter(Boolean)
          .map((v) => prop.options.find((o) => o.name === v)?.id).filter(Boolean);
      } else if (prop.type === "number") {
        row.values[prop.id] = parseFloat(raw.replace(/\./g, "").replace(",", ".")) || 0;
      } else if (prop.type === "checkbox") {
        row.values[prop.id] = /^(sim|yes|true|x)$/i.test(raw);
      } else if (prop.type === "date") {
        row.values[prop.id] = raw.slice(0, 10);
      } else {
        row.values[prop.id] = raw;
      }
    });
    return row;
  });
  return db;
}

/* ─────────── 4 · importar de verdade ─────────── */
export async function importNotion(files, { withRowPages = false, onProgress } = {}) {
  const info = analyzeNotion(files);
  const assetMap = new Map();
  info.images.forEach((f) => { assetMap.set(f.name, f); assetMap.set(f.name.toLowerCase(), f); });

  const budget = { used: 0 };
  const stats = { pages: 0, databases: 0, rows: 0, images: 0, links: 0, skipped: 0 };

  /* databases primeiro (são independentes) */
  for (const csv of info.databases) {
    const name = cleanTitle(csv.name).replace(/_all$/i, "");
    try {
      const db = notionCsvToDatabase(name, bytesToText(csv.bytes));
      if (!db) { stats.skipped++; continue; }
      createDatabase(db);
      stats.databases++;
      stats.rows += db.rows.length;
    } catch { stats.skipped++; }
    onProgress?.(stats);
  }

  /* páginas: cria todas antes de amarrar pai/filho, para a hierarquia fechar */
  const chosen = withRowPages ? [...info.pages, ...info.rowPages] : info.pages;
  const created = new Map();   // chave da pasta/arquivo → id da página
  const pending = [];

  for (const f of chosen) {
    const title = cleanTitle(f.name);
    try {
      const md = bytesToText(f.bytes);
      const blocks = notionMdToBlocks(md, { path: f.name, title, assetMap, budget });
      const page = makePage({ title, blocks });
      pending.push({ file: f, page });
      created.set(keyOf(f.name), page.id);
    } catch { stats.skipped++; }
  }

  /* liga os [[wiki-links]] às páginas de verdade: só assim valem backlinks e
     grafo. Como todas já têm id nesta altura, resolve antes de gravar. */
  const byTitle = new Map();
  for (const { page } of pending) {
    const k = String(page.title || "").trim().toLowerCase();
    if (k && !byTitle.has(k)) byTitle.set(k, page.id);
  }
  const linkify = (html) => String(html).replace(/\[\[([^\]]+)\]\]/g, (full, label) => {
    const id = byTitle.get(label.trim().toLowerCase());
    if (!id) return full;                       // apontava para fora do export: fica como texto
    stats.links++;
    return `<span class="wiki-link" data-page-id="${id}">${escapeText(label.trim())}</span>`;
  });
  const walkBlocks = (blocks) => (blocks || []).forEach((b) => {
    if (b.content && b.content.includes("[[")) b.content = linkify(b.content);
    if (b.children?.length) walkBlocks(b.children);
  });
  pending.forEach(({ page }) => walkBlocks(page.blocks));

  for (const { file, page } of pending) {
    const dir = dirName(file.name);
    const parentId = dir ? created.get(keyOf(dir)) : null;
    if (parentId && parentId !== page.id) page.parentId = parentId;
    createPage(page);
    stats.pages++;
    onProgress?.(stats);
  }

  stats.images = Math.round(budget.used / 1024);
  return { stats, info };
}
