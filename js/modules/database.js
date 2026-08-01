// ═══════════════ NEXUS · Databases: Tabela + Kanban ═══════════════

import {
  getDatabase, updateDatabase, touchDatabase, deleteDatabase, makeRow, listDatabases,
  getSetting, setSetting, snapshotDatabase, listDbVersions, restoreDbVersion,
} from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, uid, escapeHtml, fmtDate, flip, download, debounce, todayKey, isMac, fmtRelative } from "../core/utils.js";
import { showMenu, closeMenus, toast, confirmDialog, promptDialog, emojiPicker, showModal } from "../core/ui.js";

const PROP_TYPES = [
  { type: "text", icon: "Aa", name: "Texto" },
  { type: "number", icon: "#", name: "Número" },
  { type: "select", icon: "◉", name: "Select" },
  { type: "multiselect", icon: "≡", name: "Multi-select" },
  { type: "date", icon: "📅", name: "Data" },
  { type: "checkbox", icon: "☑", name: "Checkbox" },
  { type: "url", icon: "🔗", name: "URL" },
  { type: "file", icon: "📎", name: "Arquivo / Imagem" },
  { type: "formula", icon: "∑", name: "Fórmula" },
  { type: "relation", icon: "⇄", name: "Relação" },
  { type: "rollup", icon: "Σ", name: "Rollup" },
  { type: "created", icon: "🕐", name: "Criado em" },
  { type: "updated", icon: "✎", name: "Editado em" },
];
/* propriedades calculadas — não têm valor em row.values e não são editáveis */
const AUTO_PROPS = new Set(["created", "updated"]);
const COMPUTED_PROPS = new Set(["formula", "rollup", "created", "updated"]);
/* tipos cujo valor não é escalar → fora de filtros avançados e de automações */
const NON_FILTERABLE = new Set(["relation", "file"]);
const autoValue = (row, prop) => prop.type === "created" ? row.createdAt : row.updatedAt;
const TYPE_ICON = Object.fromEntries(PROP_TYPES.map((t) => [t.type, t.icon]));
TYPE_ICON.title = "T";
const CHIP_COLORS = ["gray", "blue", "green", "amber", "red", "purple"];
const chipClass = (c) => `chip c-${CHIP_COLORS.includes(c) ? c : "gray"}`;

let state = null; // { db, container, viewId, quickFilter }

export default {
  async mount(container, params) {
    const db = getDatabase(params.id);
    if (!db) {
      container.innerHTML = `<div class="empty-state"><div class="es-icon">▦</div>
        <div class="es-title">Database não encontrada</div></div>`;
      return;
    }
    const savedView = getSetting("dbView:" + db.id);
    state = {
      db, container,
      viewId: db.views.find((v) => v.id === savedView)?.id || db.views[0]?.id,
      quickFilter: "",
      expanded: new Set(),
      undo: [], redo: [], cleanups: [],
    };
    state._committed = snapshotState();
    render();
    setupTopbar(db);

    snapshotDatabase(db.id);
    const snapTimer = setInterval(() => snapshotDatabase(db.id), 180000);
    state.cleanups.push(() => clearInterval(snapTimer));

    // Desfazer / Refazer na database (Ctrl+Z · Ctrl+Y · Ctrl+Shift+Z)
    const onHistKey = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || !state) return;
      if (document.activeElement?.isContentEditable || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undoDb(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redoDb(); }
    };
    addEventListener("keydown", onHistKey, true);
    state.cleanups.push(() => removeEventListener("keydown", onHistKey, true));
  },
  unmount() {
    closeMenus();
    state?._virtCleanup?.();
    state?.cleanups?.forEach((fn) => fn());
    document.getElementById("topbar-actions").innerHTML = "";
    state = null;
  },
};

/* ═══════════ Desfazer / Refazer da database ═══════════
   Guarda propriedades + linhas (o que o usuário percebe como "o conteúdo").
   Views e nome ficam de fora de propósito: mudar de aba não é uma edição. */
const snapshotState = () => JSON.stringify({ p: state.db.properties, r: state.db.rows });

function recordDbHistory() {
  if (!state || state._restoring) return;
  const cur = snapshotState();
  if (cur === state._committed) return;
  state.undo.push(state._committed);
  if (state.undo.length > 100) state.undo.shift();
  state.redo.length = 0;
  state._committed = cur;
}

function applySnapshot(snap) {
  state._restoring = true;
  const { p, r } = JSON.parse(snap);
  state.db.properties = p;
  state.db.rows = r;
  state._committed = snap;
  touchDatabase(state.db.id);
  render();
  state._restoring = false;
}

function undoDb() {
  if (!state?.undo.length) { toast("Nada para desfazer", { duration: 1000 }); return; }
  state.redo.push(snapshotState());
  applySnapshot(state.undo.pop());
  toast("Desfeito", { duration: 1000 });
}

function redoDb() {
  if (!state?.redo.length) return;
  state.undo.push(snapshotState());
  applySnapshot(state.redo.pop());
  toast("Refeito", { duration: 1000 });
}

const commit = () => { recordDbHistory(); touchDatabase(state.db.id); };
const currentView = () => state.db.views.find((v) => v.id === state.viewId) || state.db.views[0];

function setupTopbar(db) {
  const actions = document.getElementById("topbar-actions");
  actions.innerHTML = "";
  const more = h("button", { class: "icon-btn", title: "Mais opções", "aria-label": "Opções" }, "⋯");
  more.onclick = (e) => showMenu(e.currentTarget, [
    { icon: "✎", title: "Renomear", action: async () => {
      const name = await promptDialog({ title: "Renomear database", value: db.name });
      if (name != null) { updateDatabase(db.id, { name }); render(); }
    } },
    { icon: "⬇", title: "Exportar CSV", action: () => exportCsv(db) },
    { icon: "⬆", title: "Importar CSV", action: () => importCsvFlow() },
    { icon: "⚡", title: "Automações" + ((db.automations?.length) ? ` · ${db.automations.length}` : ""), action: () => automationsModal() },
    { sep: true },
    { icon: "↺", title: "Desfazer", kbd: "⌘Z", action: () => undoDb() },
    { icon: "↻", title: "Histórico de versões", action: () => showDbHistory() },
    { sep: true },
    { icon: "🗑", title: "Excluir database", danger: true, action: async () => {
      const ok = await confirmDialog({ title: "Excluir database?", message: "Ela irá para a lixeira e poderá ser restaurada.", confirmText: "Excluir", danger: true });
      if (ok) { await deleteDatabase(db.id); toast("Database movida para a lixeira"); navigate("home"); }
    } },
  ], { align: "right" });
  actions.appendChild(more);
}

function exportCsv(db) {
  const props = db.properties;
  const header = props.map((p) => `"${p.name.replace(/"/g, '""')}"`).join(",");
  const lines = db.rows.map((r) => props.map((p) => {
    let v = r.values[p.id];
    if (AUTO_PROPS.has(p.type)) v = new Date(autoValue(r, p)).toLocaleString("pt-BR");
    if (p.type === "file") v = v?.name || ""; // o binário não vai para o CSV
    if (p.type === "select") v = p.options?.find((o) => o.id === v)?.name || "";
    if (p.type === "multiselect") v = (v || []).map((id) => p.options?.find((o) => o.id === id)?.name).filter(Boolean).join("; ");
    if (p.type === "checkbox") v = v ? "sim" : "não";
    return `"${String(v ?? "").replace(/"/g, '""')}"`;
  }).join(","));
  download(`${db.name || "database"}.csv`, [header, ...lines].join("\n"), "text/csv");
  toast("CSV exportado");
}

/* ═══════════ Importar CSV ═══════════
   Parser que respeita aspas, vírgulas e quebras de linha dentro do campo —
   um CSV exportado de planilha entra sem precisar de limpeza manual. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // aspas escapadas
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* adivinha o tipo da coluna pelos valores (data → número → checkbox → texto) */
function guessType(values) {
  const vals = values.filter((v) => v.trim() !== "");
  if (!vals.length) return "text";
  if (vals.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) return "date";
  if (vals.every((v) => /^-?[\d.,]+$/.test(v.trim()) && !isNaN(parseFloat(v.replace(",", "."))))) return "number";
  if (vals.every((v) => /^(sim|não|nao|true|false|x|)$/i.test(v.trim()))) return "checkbox";
  return "text";
}

function importCsvFlow() {
  const input = h("input", { type: "file", accept: ".csv,text/csv", style: "display:none" });
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.remove();
    if (!f) return;
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { toast("CSV vazio ou sem linhas de dados", { type: "warn" }); return; }
    csvPreviewModal(rows);
  });
  document.body.appendChild(input);
  input.click();
}

function csvPreviewModal(rows) {
  const db = state.db;
  const header = rows[0].map((c) => c.trim());
  const body = rows.slice(1);

  // mapeia cada coluna do CSV para uma propriedade existente (por nome) ou nova
  const plan = header.map((name, i) => {
    const existing = db.properties.find((p) => p.name.toLowerCase() === name.toLowerCase() && !COMPUTED_PROPS.has(p.type));
    return { name, index: i, propId: existing?.id || null, type: existing?.type || guessType(body.map((r) => r[i] ?? "")) };
  });

  const table = h("table", { class: "dbv-table", style: "margin-bottom:10px" });
  const trh = h("tr", {});
  plan.forEach((c) => trh.appendChild(h("th", {}, c.name + (c.propId ? "" : ` (nova · ${TYPE_LABEL[c.type] || c.type})`))));
  table.appendChild(h("thead", {}, trh));
  const tb = h("tbody", {});
  body.slice(0, 5).forEach((r) => {
    const tr = h("tr", {});
    plan.forEach((c) => tr.appendChild(h("td", {}, (r[c.index] ?? "").slice(0, 30))));
    tb.appendChild(tr);
  });
  table.appendChild(tb);

  const doImport = h("button", { class: "btn primary" }, `Importar ${body.length} ${body.length === 1 ? "linha" : "linhas"}`);
  const m = showModal({
    title: "Importar CSV",
    body: h("div", {},
      h("p", { class: "settings-hint", style: "margin-bottom:10px" },
        "Colunas com o mesmo nome são reaproveitadas; as demais são criadas. Prévia das primeiras linhas:"),
      h("div", { style: "overflow-x:auto" }, table)),
    footer: [h("button", { class: "btn ghost", onclick: () => m.close() }, "Cancelar"), doImport],
    width: 640,
  });

  doImport.onclick = () => {
    // cria as colunas que faltam
    plan.forEach((c) => {
      if (c.propId) return;
      const p = { id: uid("pr"), name: c.name || "Coluna", type: c.type };
      if (c.type === "select") p.options = [];
      db.properties.push(p);
      c.propId = p.id;
    });
    // a 1ª coluna do CSV alimenta o título, se a database ainda não tiver mapeamento
    const titleProp = db.properties.find((p) => p.type === "title");
    body.forEach((r) => {
      const values = {};
      plan.forEach((c) => {
        const raw = (r[c.index] ?? "").trim();
        if (raw === "") return;
        if (c.type === "number") values[c.propId] = parseFloat(raw.replace(",", ".")) || 0;
        else if (c.type === "checkbox") values[c.propId] = /^(sim|true|x)$/i.test(raw);
        else values[c.propId] = raw;
      });
      if (titleProp && !values[titleProp.id]) values[titleProp.id] = (r[0] ?? "").trim();
      db.rows.push(makeRow(db, values));
    });
    commit(); m.close(); render();
    toast(`${body.length} ${body.length === 1 ? "linha importada" : "linhas importadas"} ✓`);
  };
}

const TYPE_LABEL = Object.fromEntries(PROP_TYPES.map((t) => [t.type, t.name]));

/* ═══════════ Histórico de versões da database ═══════════ */
async function showDbHistory() {
  const db = state.db;
  await snapshotDatabase(db.id);
  const versions = await listDbVersions(db.id);
  const list = h("div", { style: "display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto" });
  if (!versions.length) list.appendChild(h("div", { class: "settings-hint" }, "Nenhuma versão salva ainda."));
  versions.forEach((v) => {
    list.appendChild(h("div", { class: "auto-card" },
      h("div", { class: "auto-body" },
        h("div", { class: "auto-name" }, fmtRelative(v.ts)),
        h("div", { class: "auto-desc" }, `${v.rows.length} ${v.rows.length === 1 ? "linha" : "linhas"} · ${v.properties.length} propriedades`)),
      h("button", { class: "btn ghost sm", onclick: async () => {
        const ok = await confirmDialog({
          title: "Restaurar esta versão?",
          message: "As linhas e propriedades atuais serão substituídas. O estado de agora vira uma versão, então dá para voltar.",
          confirmText: "Restaurar",
        });
        if (!ok) return;
        await restoreDbVersion(db.id, v.id);
        state.db = getDatabase(db.id);
        state._committed = snapshotState();
        m.close(); render(); toast("Versão restaurada ✓");
      } }, "Restaurar")));
  });
  const m = showModal({ title: "↻ Histórico da database", body: list, width: 500 });
}

/* ═══════════ Render raiz ═══════════ */
function render() {
  const { db, container } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "db-container" });

  // cabeçalho
  const nameEl = h("h1", { class: "db-name", contenteditable: "true", spellcheck: "false" });
  nameEl.textContent = db.name;
  nameEl.addEventListener("input", debounce(() => updateDatabase(db.id, { name: nameEl.textContent.trim() }, { silent: true }), 400));
  nameEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); } });
  const iconBtn = h("button", {
    class: "db-icon-btn",
    onclick: (e) => emojiPicker(e.currentTarget, (emoji) => { updateDatabase(db.id, { icon: emoji || "▦" }); iconBtn.textContent = emoji || "▦"; }),
  }, db.icon || "▦");
  wrap.appendChild(h("div", { class: "db-head" }, iconBtn, nameEl));

  // descrição opcional (como no Notion) — abaixo do título
  const descEl = h("div", {
    class: "db-desc", contenteditable: "true", spellcheck: "false",
    "data-placeholder": "Adicionar descrição…",
  });
  descEl.textContent = db.description || "";
  descEl.addEventListener("input", debounce(() => {
    if (!descEl.textContent.trim()) descEl.innerHTML = ""; // limpa <br> residual → mostra placeholder
    updateDatabase(db.id, { description: descEl.textContent.trim() }, { silent: true });
  }, 400));
  descEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); descEl.blur(); } });
  wrap.appendChild(descEl);

  // toolbar de views
  const tabs = h("div", { class: "db-tabs" });
  db.views.forEach((v) => {
    tabs.appendChild(h("button", {
      class: "db-tab" + (v.id === state.viewId ? " active" : ""),
      onclick: () => { state.viewId = v.id; setSetting("dbView:" + db.id, v.id); render(); },
      oncontextmenu: (e) => { e.preventDefault(); viewMenu(e, v); },
    }, h("span", {}, VIEW_ICON[v.type] || "▤"), h("span", {}, v.name)));
  });
  tabs.appendChild(h("button", {
    class: "db-tab", title: "Nova view",
    onclick: (e) => showMenu(e.currentTarget, [
      { icon: "▤", title: "Tabela", action: () => addView("table") },
      { icon: "▥", title: "Kanban", action: () => addView("kanban") },
      { icon: "▦", title: "Galeria", action: () => addView("gallery") },
      { icon: "☰", title: "Lista", action: () => addView("list") },
      { icon: "📅", title: "Calendário", action: () => addView("calendar") },
      { icon: "📊", title: "Timeline / Gantt", action: () => addView("timeline") },
    ]),
  }, "＋"));

  const quick = h("input", { class: "db-quicksearch", placeholder: "Filtrar…", value: state.quickFilter });
  quick.addEventListener("input", debounce(() => { state.quickFilter = quick.value; renderView(); }, 150));

  const filterBtn = h("button", { class: "btn ghost sm", onclick: (e) => filterMenu(e) },
    "⛃ Filtrar" + (activeFilterLabel() ? ` · ${activeFilterLabel()}` : ""));

  const rightSide = h("div", { class: "db-toolbar-right" }, filterBtn);
  if (currentView().type === "table") {
    const gp = currentView().groupBy ? db.properties.find((p) => p.id === currentView().groupBy) : null;
    rightSide.appendChild(h("button", { class: "btn ghost sm", onclick: (e) => groupMenu(e) },
      "⊞ Agrupar" + (gp ? ` · ${gp.name}` : "")));
  }
  rightSide.appendChild(quick);
  wrap.appendChild(h("div", { class: "db-toolbar" }, tabs, rightSide));

  const viewport = h("div", { class: "db-viewport" });
  state.viewportEl = viewport;
  wrap.appendChild(viewport);
  container.appendChild(wrap);
  renderView();
}

function viewMenu(e, view) {
  showMenu(new DOMRect(e.clientX, e.clientY, 0, 0), [
    { icon: "✎", title: "Renomear view", action: async () => {
      const name = await promptDialog({ title: "Renomear view", value: view.name });
      if (name != null) { view.name = name; commit(); render(); }
    } },
    { icon: "🗑", title: "Excluir view", danger: true, action: () => {
      if (state.db.views.length <= 1) { toast("A database precisa de ao menos uma view", { type: "warn" }); return; }
      state.db.views = state.db.views.filter((v) => v.id !== view.id);
      state.viewId = state.db.views[0].id;
      commit(); render();
    } },
  ]);
}

const VIEW_ICON = { table: "▤", kanban: "▥", gallery: "▦", list: "☰", calendar: "📅", timeline: "📊" };
const VIEW_NAME = { table: "Tabela", kanban: "Kanban", gallery: "Galeria", list: "Lista", calendar: "Calendário", timeline: "Timeline" };

function addView(type) {
  const { db } = state;
  const groupBy = type === "kanban" ? db.properties.find((p) => p.type === "select")?.id || null : null;
  const dateProps = db.properties.filter((p) => p.type === "date");
  const dateProp = type === "calendar" ? dateProps[0]?.id || null : null;
  const v = { id: uid("v"), name: VIEW_NAME[type] || "View", type, filters: [], sorts: [], groupBy, dateProp };
  if (type === "timeline") {
    v.startProp = dateProps[0]?.id || null;
    v.endProp = dateProps[1]?.id || null;
    v.depProp = null;
  }
  db.views.push(v);
  state.viewId = v.id;
  commit(); render();
}

/* ── Filtro simples (uma condição sobre select/checkbox) ── */
function activeFilterLabel() {
  const view = currentView();
  const nAdv = view.filterGroup?.conditions?.length || 0;
  if (nAdv) return `${nAdv} ${nAdv === 1 ? "condição" : "condições"}`;
  const f = view.filters?.[0];
  if (!f) return "";
  const p = state.db.properties.find((x) => x.id === f.propId);
  if (!p) return "";
  if (p.type === "checkbox") return p.name;
  const o = p.options?.find((o) => o.id === f.value);
  return o ? `${p.name}: ${o.name}` : p.name;
}

function filterMenu(e) {
  const view = currentView();
  const items = [{ label: "Filtrar por" }];
  state.db.properties.filter((p) => ["select", "checkbox"].includes(p.type)).forEach((p) => {
    if (p.type === "select") {
      (p.options || []).forEach((o) => items.push({
        icon: "◉", title: `${p.name}: ${o.name}`,
        action: () => { view.filters = [{ propId: p.id, op: "eq", value: o.id }]; commit(); render(); },
      }));
    } else {
      items.push({ icon: "☑", title: `${p.name} marcado`,
        action: () => { view.filters = [{ propId: p.id, op: "eq", value: true }]; commit(); render(); } });
    }
  });
  items.push({ sep: true });
  items.push({ icon: "⛃", title: "Filtros avançados (E / OU)…", action: () => advancedFilterModal() });
  items.push({ icon: "✕", title: "Limpar filtros", action: () => { view.filters = []; view.filterGroup = null; commit(); render(); } });
  showMenu(e.currentTarget, items);
}

/* ── Filtros avançados: múltiplas condições combinadas por E/OU ── */
const OPERATORS = {
  text: [["contains", "contém"], ["notcontains", "não contém"], ["eq", "é igual a"], ["empty", "vazio"], ["notempty", "não vazio"]],
  number: [["eq", "="], ["gt", ">"], ["lt", "<"], ["neq", "≠"], ["empty", "vazio"]],
  select: [["is", "é"], ["isnot", "não é"], ["empty", "vazio"]],
  multiselect: [["is", "contém"], ["isnot", "não contém"]],
  checkbox: [["checked", "marcado"], ["unchecked", "não marcado"]],
  date: [["on", "em"], ["before", "antes de"], ["after", "depois de"], ["empty", "vazio"]],
};
const opsFor = (type) => OPERATORS[type] || (["url", "title"].includes(type) ? OPERATORS.text : OPERATORS.text);

function matchCondition(row, cond, db) {
  const p = db.properties.find((x) => x.id === cond.propId);
  if (!p) return true;
  const v = row.values[cond.propId];
  const op = cond.operator;
  const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
  if (op === "empty") return empty;
  if (op === "notempty") return !empty;
  const str = (x) => String(x ?? "").toLowerCase();
  switch (p.type) {
    case "select": return op === "isnot" ? v !== cond.value : v === cond.value;
    case "multiselect": { const has = (v || []).includes(cond.value); return op === "isnot" ? !has : has; }
    case "checkbox": return op === "unchecked" ? !v : !!v;
    case "number": { const a = Number(v), b = Number(cond.value); if (op === "gt") return a > b; if (op === "lt") return a < b; if (op === "neq") return a !== b; return a === b; }
    case "date": { const a = v || "", b = cond.value || ""; if (op === "before") return a && a < b; if (op === "after") return a && a > b; return a === b; }
    default:
      if (op === "eq") return str(v) === str(cond.value);
      if (op === "notcontains") return !str(v).includes(str(cond.value));
      return str(v).includes(str(cond.value));
  }
}

function advancedFilterModal() {
  const view = currentView();
  const fg = view.filterGroup || (view.filterGroup = { op: "and", conditions: [] });
  const filterable = state.db.properties.filter((p) => !COMPUTED_PROPS.has(p.type) && !NON_FILTERABLE.has(p.type));

  const list = h("div", { class: "filter-conditions" });
  const paint = () => {
    list.innerHTML = "";
    fg.conditions.forEach((c, i) => list.appendChild(conditionRow(c, i, filterable, paint)));
    if (!fg.conditions.length) list.appendChild(h("div", { style: "color:var(--text-faint);font-size:var(--fs-sm);padding:8px 0" }, "Sem condições. Adicione uma abaixo."));
  };

  const opToggle = h("div", { class: "segmented", style: "width:fit-content" },
    ...[["and", "Todas (E)"], ["or", "Qualquer (OU)"]].map(([v, l]) =>
      h("button", { class: "seg-btn" + (fg.op === v ? " on" : ""), onclick: (e) => { fg.op = v; e.currentTarget.parentElement.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); } }, l)));

  const addBtn = h("button", { class: "btn ghost sm", onclick: () => { fg.conditions.push({ propId: filterable[0].id, operator: opsFor(filterable[0].type)[0][0], value: "" }); paint(); } }, "＋ condição");
  const apply = h("button", { class: "btn primary" }, "Aplicar");
  paint();

  const m = showModal({
    title: "Filtros avançados",
    body: h("div", { style: "display:flex;flex-direction:column;gap:12px" },
      h("div", { style: "display:flex;align-items:center;gap:10px" }, h("span", { style: "font-size:var(--fs-sm);color:var(--text-2)" }, "Combinar:"), opToggle),
      list, addBtn),
    footer: [h("button", { class: "btn ghost", onclick: () => { view.filterGroup = null; commit(); render(); m.close(); } }, "Limpar"), apply],
    width: 560,
  });
  apply.onclick = () => { fg.conditions = fg.conditions.filter((c) => c.propId); commit(); render(); m.close(); };
}

function conditionRow(cond, idx, props, repaint) {
  const propSel = h("select", { class: "input", style: "width:auto" });
  props.forEach((p) => propSel.appendChild(h("option", { value: p.id, selected: p.id === cond.propId || null }, p.name)));
  const opSel = h("select", { class: "input", style: "width:auto" });
  const valHolder = h("span", { style: "flex:1;min-width:80px" });
  const curProp = () => props.find((p) => p.id === propSel.value) || props[0];

  const fillOps = () => {
    opSel.innerHTML = "";
    opsFor(curProp().type).forEach(([v, l]) => opSel.appendChild(h("option", { value: v, selected: v === cond.operator || null }, l)));
  };
  const fillVal = () => {
    valHolder.innerHTML = "";
    const p = curProp();
    if (["empty", "notempty", "checked", "unchecked"].includes(opSel.value)) return;
    if (p.type === "select" || p.type === "multiselect") {
      const s = h("select", { class: "input", onchange: () => cond.value = s.value });
      (p.options || []).forEach((o) => s.appendChild(h("option", { value: o.id, selected: o.id === cond.value || null }, o.name)));
      cond.value = cond.value || (p.options?.[0]?.id ?? ""); valHolder.appendChild(s);
    } else if (p.type === "date") {
      valHolder.appendChild(h("input", { class: "input", type: "date", value: cond.value || "", onchange: (e) => cond.value = e.target.value }));
    } else if (p.type !== "checkbox") {
      valHolder.appendChild(h("input", { class: "input", type: p.type === "number" ? "number" : "text", value: cond.value || "", placeholder: "valor", oninput: (e) => cond.value = e.target.value }));
    }
  };
  propSel.onchange = () => { cond.propId = propSel.value; cond.operator = opsFor(curProp().type)[0][0]; cond.value = ""; fillOps(); fillVal(); };
  opSel.onchange = () => { cond.operator = opSel.value; fillVal(); };
  fillOps(); fillVal();

  return h("div", { class: "filter-cond-row" }, propSel, opSel, valHolder,
    h("button", { class: "icon-btn", "aria-label": "Remover", onclick: () => { currentView().filterGroup.conditions.splice(idx, 1); repaint(); } }, "✕"));
}

/* ── Linhas visíveis (filtro + busca + ordenação) ── */
function visibleRows() {
  const { db, quickFilter } = state;
  const view = currentView();
  let rows = [...db.rows];

  for (const f of view.filters || []) {
    const p = db.properties.find((x) => x.id === f.propId);
    if (!p) continue;
    rows = rows.filter((r) => {
      const v = r.values[f.propId];
      if (p.type === "multiselect") return (v || []).includes(f.value);
      return v === f.value;
    });
  }
  // filtros avançados E/OU
  const fg = view.filterGroup;
  if (fg && fg.conditions?.length) {
    rows = rows.filter((r) => {
      const results = fg.conditions.map((c) => matchCondition(r, c, db));
      return fg.op === "or" ? results.some(Boolean) : results.every(Boolean);
    });
  }
  if (quickFilter.trim()) {
    const q = quickFilter.toLowerCase();
    rows = rows.filter((r) => db.properties.some((p) => {
      let v = r.values[p.id];
      if (p.type === "select") v = p.options?.find((o) => o.id === v)?.name;
      if (p.type === "multiselect") v = (v || []).map((id) => p.options?.find((o) => o.id === id)?.name).join(" ");
      if (p.type === "file") v = v?.name; // busca pelo nome do arquivo, não pelo binário
      return String(v ?? "").toLowerCase().includes(q);
    }));
  }
  const sort = view.sorts?.[0];
  if (sort) {
    const p = db.properties.find((x) => x.id === sort.propId);
    if (p) {
      const val = (r) => {
        if (AUTO_PROPS.has(p.type)) return autoValue(r, p);
        let v = r.values[p.id];
        if (p.type === "select") return p.options?.findIndex((o) => o.id === v) ?? -1;
        if (p.type === "number") return Number(v ?? -Infinity);
        if (p.type === "checkbox") return v ? 1 : 0;
        return String(v ?? "").toLowerCase();
      };
      rows.sort((a, b) => {
        const x = val(a), y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "desc" ? -1 : 1);
      });
    }
  }
  return rows;
}

function renderView() {
  state._virtCleanup?.();
  const view = currentView();
  const vp = state.viewportEl;
  vp.innerHTML = "";
  const el = h("div", { class: "db-view-anim" });
  if (view.type === "kanban") renderKanban(el);
  else if (view.type === "gallery") renderGallery(el);
  else if (view.type === "list") renderList(el);
  else if (view.type === "calendar") renderCalendar(el);
  else if (view.type === "timeline") renderTimeline(el);
  else renderTable(el);
  vp.appendChild(el);
}

/* rótulo curto de uma propriedade para cards (chip/data/texto) */
function propBadge(row, p) {
  if (AUTO_PROPS.has(p.type)) return h("span", { class: "chip" }, (p.type === "created" ? "🕐 " : "✎ ") + fmtDate(autoValue(row, p), { day: "numeric", month: "short" }));
  const v = row.values[p.id];
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (p.type === "select") {
    const o = p.options?.find((o) => o.id === v);
    return o ? h("span", { class: chipClass(o.color) }, o.name) : null;
  }
  if (p.type === "multiselect") {
    const wrap = h("span", { style: "display:inline-flex;gap:4px;flex-wrap:wrap" });
    v.slice(0, 4).forEach((id) => { const o = p.options?.find((o) => o.id === id); if (o) wrap.appendChild(h("span", { class: chipClass(o.color) }, o.name)); });
    return wrap;
  }
  if (p.type === "date") return h("span", { class: "chip" }, "📅 " + fmtDate(v + "T12:00:00", { day: "numeric", month: "short" }));
  if (p.type === "checkbox") return v ? h("span", { class: "chip c-green" }, "✓ " + p.name) : null;
  if (p.type === "url") return h("a", { href: /^https?:/i.test(v) ? v : "https://" + v, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, String(v));
  if (p.type === "number") return h("span", { class: "chip" }, Number(v).toLocaleString("pt-BR"));
  if (p.type === "file") {
    if (!v?.src) return null;
    return (v.type || "").startsWith("image/")
      ? h("img", { class: "file-thumb sm", src: v.src, alt: v.name || "" })
      : h("span", { class: "chip" }, "📎 " + (v.name || "arquivo").slice(0, 18));
  }
  if (p.type === "relation") { const t = getDatabase(p.targetDbId); const n = (v || []).length; return n ? h("span", { class: "chip c-blue" }, `⇄ ${n}`) : null; }
  if (p.type === "rollup") { const rv = evalRollup(p, row, state.db); return rv && rv !== "—" ? h("span", { class: "chip" }, "Σ " + rv) : null; }
  return h("span", { style: "color:var(--text-3);font-size:var(--fs-xs)" }, String(v));
}

/* ═══════════ GALERIA ═══════════ */
function renderGallery(root) {
  const { db } = state;
  const rows = visibleRows();
  if (!rows.length) return emptyView(root, "▦", "Sem itens para exibir.");
  const grid = h("div", { class: "db-gallery" });
  rows.forEach((row) => {
    const card = h("div", { class: "gallery-card card hoverable", dataset: { rowId: row.id } });
    const cover = firstImage(row);
    if (cover) card.appendChild(h("div", { class: "gc-cover" }, h("img", { src: cover, alt: "" })));
    else card.appendChild(h("div", { class: "gc-cover gc-empty" }, h("span", {}, db.icon || "▦")));
    const meta = h("div", { class: "gc-meta" });
    db.properties.forEach((p) => { if (p.id !== "title") { const b = propBadge(row, p); if (b) meta.appendChild(b); } });
    card.append(
      h("div", { class: "gc-body" }, h("div", { class: "gc-title" }, row.values.title || "Sem nome"), meta));
    card.addEventListener("dblclick", () => editTitle(row));
    card.addEventListener("contextmenu", (e) => { e.preventDefault(); rowMenu({ currentTarget: card, stopPropagation() {}, clientX: e.clientX, clientY: e.clientY }, row); });
    grid.appendChild(card);
  });
  root.appendChild(grid);
  root.appendChild(newRowBtn());
}
function firstImage(row) {
  for (const k in row.values) {
    const v = row.values[k];
    if (typeof v === "string" && v.startsWith("data:image")) return v;
    // propriedade "Arquivo / Imagem": usa a imagem como capa do cartão
    if (v && typeof v === "object" && typeof v.src === "string" && (v.type || "").startsWith("image/")) return v.src;
  }
  return null;
}

/* Upload local de arquivo para uma célula (fica em IndexedDB como data URL) */
const FILE_LIMIT = 5 * 1024 * 1024; // 5MB — acima disso o workspace incha demais
function pickFileFor(row, prop, set, paint) {
  const input = h("input", { type: "file", style: "display:none" });
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    input.remove();
    if (!f) return;
    if (f.size > FILE_LIMIT) {
      toast(`Arquivo grande demais (máx. ${FILE_LIMIT / 1048576}MB para guardar localmente)`, { type: "warn" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { set({ name: f.name, type: f.type, size: f.size, src: reader.result }); paint(); };
    reader.onerror = () => toast("Falha ao ler o arquivo", { type: "danger" });
    reader.readAsDataURL(f);
  });
  document.body.appendChild(input);
  input.click();
}

/* ═══════════ LISTA ═══════════ */
function renderList(root) {
  const { db } = state;
  const rows = visibleRows();
  if (!rows.length) return emptyView(root, "☰", "Sem itens para exibir.");

  // sub-itens aninham sob os pais, com indentação e caret (como na tabela)
  const kidsMap = new Map();
  rows.forEach((r) => {
    if (!r.parentId) return;
    if (!kidsMap.has(r.parentId)) kidsMap.set(r.parentId, []);
    kidsMap.get(r.parentId).push(r);
  });
  const childrenOf = (id) => kidsMap.get(id) || [];

  const list = h("div", { class: "db-list card" });
  const addItem = (row, depth) => {
    const meta = h("div", { class: "dl-meta" });
    db.properties.forEach((p) => { if (p.id !== "title") { const b = propBadge(row, p); if (b) meta.appendChild(b); } });
    const kids = childrenOf(row.id);
    const open = state.expanded.has(row.id);
    const caret = h("button", {
      class: "row-expand" + (kids.length ? "" : " empty"),
      title: kids.length ? (open ? "Recolher" : `Expandir (${kids.length})`) : "",
      onclick: (e) => {
        e.stopPropagation();
        if (!kids.length) return;
        open ? state.expanded.delete(row.id) : state.expanded.add(row.id);
        renderView();
      },
    }, kids.length ? (open ? "▾" : "▸") : "");
    const item = h("div", {
      class: "db-list-item", dataset: { rowId: row.id },
      style: depth ? `padding-left:${12 + depth * 18}px` : "",
    },
      caret,
      h("span", { class: "dl-title" }, row.values.title || "Sem nome"),
      meta,
      h("button", { class: "icon-btn row-menu-btn", "aria-label": "Opções", onclick: (e) => rowMenu(e, row) }, "⋯"));
    item.addEventListener("dblclick", () => editTitle(row));
    list.appendChild(item);
    if (open) kids.forEach((c) => addItem(c, depth + 1));
  };
  rows.filter((r) => !r.parentId).forEach((row) => addItem(row, 0));

  root.appendChild(list);
  root.appendChild(newRowBtn());
}

/* ═══════════ CALENDÁRIO ═══════════ */
let calMonth = null;
function renderCalendar(root) {
  const { db } = state;
  const view = currentView();
  let dateProp = db.properties.find((p) => p.id === view.dateProp && p.type === "date");
  if (!dateProp) { dateProp = db.properties.find((p) => p.type === "date"); if (dateProp) { view.dateProp = dateProp.id; commit(); } }
  if (!dateProp) return emptyView(root, "📅", "O calendário precisa de uma propriedade do tipo Data.");

  if (!calMonth) calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const rows = visibleRows();
  const byDate = new Map();
  rows.forEach((r) => { const d = r.values[dateProp.id]; if (d) { if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(r); } });

  const monthLabel = calMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const head = h("div", { class: "cal-head" },
    h("button", { class: "icon-btn", "aria-label": "Mês anterior", onclick: () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderView(); } }, "‹"),
    h("span", { class: "cal-month" }, monthLabel[0].toUpperCase() + monthLabel.slice(1)),
    h("button", { class: "icon-btn", "aria-label": "Próximo mês", onclick: () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderView(); } }, "›"),
    h("button", { class: "btn ghost sm", style: "margin-left:8px", onclick: () => { calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderView(); } }, "Hoje"));

  const grid = h("div", { class: "cal-grid" });
  ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach((d) => grid.appendChild(h("div", { class: "cal-dow" }, d)));
  const pad = calMonth.getDay();
  for (let i = 0; i < pad; i++) grid.appendChild(h("div", { class: "cal-cell empty" }));
  const days = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const todayK = todayKey();
  for (let day = 1; day <= days; day++) {
    const key = todayKey(new Date(calMonth.getFullYear(), calMonth.getMonth(), day));
    const cell = h("div", { class: "cal-cell" + (key === todayK ? " today" : "") });
    cell.appendChild(h("div", { class: "cal-daynum" }, String(day)));
    (byDate.get(key) || []).slice(0, 4).forEach((r) => {
      const o = colorForRow(r);
      cell.appendChild(h("button", {
        class: "cal-event " + (o ? chipClass(o) : ""), title: r.values.title || "",
        onclick: () => editTitle(r),
      }, r.values.title || "Sem nome"));
    });
    const extra = (byDate.get(key) || []).length - 4;
    if (extra > 0) cell.appendChild(h("div", { class: "cal-more" }, `+${extra}`));
    // clique no dia cria registro com essa data
    cell.addEventListener("dblclick", (e) => {
      if (e.target !== cell && !e.target.classList.contains("cal-daynum")) return;
      const row = makeRow(db, { title: "Novo evento", [dateProp.id]: key });
      db.rows.push(row); commit(); renderView();
    });
    grid.appendChild(cell);
  }
  root.append(head, grid);
}
function colorForRow(row) {
  const sel = state.db.properties.find((p) => p.type === "select" && row.values[p.id]);
  if (!sel) return null;
  return sel.options?.find((o) => o.id === row.values[sel.id])?.color || null;
}

function emptyView(root, icon, msg) {
  root.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon" }, icon), h("div", { class: "es-desc" }, msg)));
}
function newRowBtn() {
  return h("button", { class: "db-newrow", style: "border:1px solid var(--border);border-radius:var(--r-md);margin-top:10px", onclick: (e) => newRowClick(e) },
    h("span", {}, "＋"), h("span", {}, "Novo registro"));
}

/* "Novo": direto quando não há templates; senão, menu Em branco / templates */
function newRowClick(e) {
  const tpls = state.db.templates || [];
  if (!tpls.length) { addRow(); return; }
  showMenu(e.currentTarget, [
    { icon: "○", title: "Em branco", action: () => addRow() },
    { label: "A partir de template" },
    ...tpls.map((t) => ({ icon: "▤", title: t.name, action: () => addRow(structuredClone(t.values)) })),
    { sep: true },
    { icon: "⚙", title: "Gerenciar templates…", action: () => manageTemplates() },
  ]);
}

function manageTemplates() {
  const db = state.db;
  const list = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const paint = () => {
    list.innerHTML = "";
    if (!db.templates?.length) list.appendChild(h("div", { style: "color:var(--text-faint);font-size:var(--fs-sm)" }, "Nenhum template. Salve uma linha como template pelo menu ⋯ da linha."));
    (db.templates || []).forEach((t) => list.appendChild(h("div", { class: "auto-card" },
      h("span", { style: "flex:none" }, "▤"),
      h("div", { class: "auto-body" }, h("div", { class: "auto-name" }, t.name)),
      h("button", { class: "icon-btn", title: "Excluir template", onclick: () => {
        db.templates = db.templates.filter((x) => x.id !== t.id);
        commit(); paint();
      } }, "🗑"))));
  };
  paint();
  showModal({ title: "Templates da database", body: list, width: 480 });
}
async function editTitle(row) {
  const name = await promptDialog({ title: "Editar registro", value: row.values.title || "" });
  if (name != null) { row.values.title = name; row.updatedAt = Date.now(); commit(); renderView(); }
}

/* ═══════════ TABELA ═══════════ */
function renderTable(root) {
  const { db } = state;
  const view = currentView();
  const rows = visibleRows();

  const thead = h("tr", {});
  db.properties.forEach((p) => {
    const sort = view.sorts?.[0]?.propId === p.id ? view.sorts[0].dir : null;
    const th = h("th", {},
      h("div", {
        class: "db-th",
        onclick: () => {
          view.sorts = [{ propId: p.id, dir: sort === "asc" ? "desc" : "asc" }];
          commit(); renderView();
        },
        oncontextmenu: (e) => { e.preventDefault(); columnMenu(e, p); },
      },
        h("span", { class: "th-type" }, TYPE_ICON[p.type] || "Aa"),
        h("span", {}, p.name),
        sort ? h("span", { class: "th-sort" }, sort === "asc" ? "▲" : "▼") : null,
        h("button", {
          class: "icon-btn", style: "width:20px;height:20px;margin-left:2px", "aria-label": "Opções da coluna",
          onclick: (e) => { e.stopPropagation(); columnMenu(e, p); },
        }, "▾")
      ));
    thead.appendChild(th);
  });
  thead.appendChild(h("th", { class: "th-add" },
    h("button", { class: "th-add-btn", title: "Nova propriedade", onclick: (e) => addColumnMenu(e) }, "＋")));

  const colCount = db.properties.length + 1;
  // mapa pai → filhos calculado uma vez (evita varrer todas as linhas por linha)
  const kidsMap = new Map();
  rows.forEach((r) => {
    if (!r.parentId) return;
    if (!kidsMap.has(r.parentId)) kidsMap.set(r.parentId, []);
    kidsMap.get(r.parentId).push(r);
  });
  const childrenOf = (id) => kidsMap.get(id) || [];
  const buildRow = (row, depth = 0) => {
    const tr = h("tr", { dataset: { rowId: row.id } });
    db.properties.forEach((p, pi) => {
      const td = h("td", {});
      const cell = renderCell(row, p, pi === 0);
      if (pi === 0) {
        const kids = childrenOf(row.id);
        const open = state.expanded.has(row.id);
        const caret = h("button", {
          class: "row-expand" + (kids.length ? "" : " empty"),
          title: kids.length ? (open ? "Recolher" : `Expandir (${kids.length})`) : "",
          onclick: (e) => {
            e.stopPropagation();
            if (!kids.length) return;
            open ? state.expanded.delete(row.id) : state.expanded.add(row.id);
            renderView();
          },
        }, kids.length ? (open ? "▾" : "▸") : "");
        cell.style.paddingLeft = (6 + depth * 18) + "px";
        cell.insertBefore(caret, cell.firstChild);
      }
      td.appendChild(cell);
      tr.appendChild(td);
    });
    tr.appendChild(h("td", { style: "min-width:40px;text-align:center" },
      h("button", {
        class: "icon-btn row-menu-btn", "aria-label": "Opções da linha",
        onclick: (e) => rowMenu(e, row),
      }, "⋯")));
    return tr;
  };
  // achata a árvore visível (respeitando sub-itens expandidos) numa lista plana
  const flat = [];
  const pushTree = (row, depth) => {
    flat.push({ row, depth });
    if (state.expanded.has(row.id)) childrenOf(row.id).forEach((c) => pushTree(c, depth + 1));
  };
  const topRows = rows.filter((r) => !r.parentId); // sub-itens aninham sob os pais
  const groupProp = view.groupBy ? db.properties.find((p) => p.id === view.groupBy) : null;

  const tbody = h("tbody", {});
  const VIRT_MIN = 150;
  if (groupProp) {
    const appendTree = (row, depth) => {
      tbody.appendChild(buildRow(row, depth));
      if (state.expanded.has(row.id)) childrenOf(row.id).forEach((c) => appendTree(c, depth + 1));
    };
    for (const g of groupRows(topRows, groupProp)) {
      const headTr = h("tr", { class: "db-group-row" });
      headTr.appendChild(h("td", { colspan: colCount },
        h("div", { class: "db-group-head" },
          g.option ? h("span", { class: chipClass(g.option.color) }, g.option.name) : h("span", { class: "chip" }, "Sem valor"),
          h("span", { class: "db-group-count" }, String(g.rows.length)))));
      tbody.appendChild(headTr);
      g.rows.forEach((row) => appendTree(row, 0));
    }
  } else {
    topRows.forEach((row) => pushTree(row, 0));
    if (flat.length <= VIRT_MIN) {
      flat.forEach(({ row, depth }) => tbody.appendChild(buildRow(row, depth)));
    } else {
      // tabelas grandes: só as linhas visíveis existem no DOM
      setupVirtualTable(tbody, flat, buildRow, colCount);
    }
  }

  root.appendChild(h("div", { class: "db-table-wrap" },
    h("table", { class: "db-table" }, h("thead", {}, thead), tbody),
    h("button", { class: "db-newrow", onclick: (e) => newRowClick(e) }, h("span", {}, "＋"), h("span", {}, "Nova linha"))
  ));

  if (!rows.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "▦"),
      h("div", { class: "es-desc" }, state.quickFilter || view.filters?.length
        ? "Nada corresponde ao filtro atual."
        : "Sem linhas ainda — clique em “Nova linha”.")));
  }
}

/* ── Virtualização: renderiza só a janela visível (~40 linhas) + espaçadores.
   Uma tabela de 100.000 linhas rola a 60fps porque o DOM nunca passa de
   algumas dezenas de <tr>. A rolagem é a do próprio #view. ── */
function setupVirtualTable(tbody, flat, buildRow, colCount) {
  state._virtCleanup?.();
  const scroller = state.container.closest("#view") || document.getElementById("view") || document.scrollingElement;
  let rowH = 37; // calibrado com a primeira linha real após o paint
  const BUF = 12;
  const spacer = () => h("tr", { class: "virt-spacer" }, h("td", { colspan: colCount, style: "padding:0;border:0;height:0" }));
  const top = spacer(), bottom = spacer();
  tbody.append(top, bottom);
  let start = -1, count = -1;

  const update = () => {
    if (!state) return;
    const total = flat.length;
    const cnt = Math.min(total, Math.ceil((scroller.clientHeight || innerHeight) / rowH) + BUF * 2);
    // o topo do tbody já inclui o espaçador ⇒ a linha virtual i começa em tbodyTop + i*rowH
    const scTop = scroller.getBoundingClientRect().top;
    const tbodyTop = tbody.getBoundingClientRect().top;
    let s = Math.max(0, Math.floor((scTop - tbodyTop) / rowH) - BUF);
    s = Math.min(s, Math.max(0, total - cnt));
    if (s === start && cnt === count) return;
    start = s; count = cnt;
    tbody.querySelectorAll("tr:not(.virt-spacer)").forEach((tr) => tr.remove());
    const frag = document.createDocumentFragment();
    flat.slice(s, s + cnt).forEach(({ row, depth }) => frag.appendChild(buildRow(row, depth)));
    tbody.insertBefore(frag, bottom);
    top.firstChild.style.height = s * rowH + "px";
    bottom.firstChild.style.height = Math.max(0, total - s - cnt) * rowH + "px";
    const first = tbody.querySelector("tr:not(.virt-spacer)");
    if (first) {
      const hh = first.getBoundingClientRect().height;
      if (hh > 10 && Math.abs(hh - rowH) > 1) rowH = hh;
    }
  };

  const onScroll = () => update();
  scroller.addEventListener("scroll", onScroll, { passive: true });
  state._virtCleanup = () => { scroller.removeEventListener("scroll", onScroll); if (state) state._virtCleanup = null; };
  requestAnimationFrame(update);
}

/* agrupa linhas por uma propriedade select (ou checkbox) */
function groupRows(rows, prop) {
  const groups = [];
  const index = new Map();
  const ensure = (key, option) => {
    if (!index.has(key)) { const g = { key, option, rows: [] }; index.set(key, g); groups.push(g); }
    return index.get(key);
  };
  if (prop.type === "select") {
    (prop.options || []).forEach((o) => ensure(o.id, o));
    ensure("__none", null);
    rows.forEach((r) => {
      const v = r.values[prop.id];
      const o = prop.options?.find((o) => o.id === v);
      ensure(o ? o.id : "__none", o || null).rows.push(r);
    });
  } else if (prop.type === "checkbox") {
    const yes = ensure("yes", { name: "Marcado", color: "green" });
    const no = ensure("no", { name: "Não marcado", color: "gray" });
    rows.forEach((r) => (r.values[prop.id] ? yes : no).rows.push(r));
  } else {
    rows.forEach((r) => ensure(String(r.values[prop.id] ?? "__none"), { name: String(r.values[prop.id] ?? "Sem valor"), color: "gray" }).rows.push(r));
  }
  return groups.filter((g) => g.rows.length);
}

function groupMenu(e) {
  const view = currentView();
  const items = [{ label: "Agrupar por" }];
  state.db.properties.filter((p) => ["select", "checkbox"].includes(p.type)).forEach((p) => {
    items.push({ icon: view.groupBy === p.id ? "✓" : "▤", title: p.name,
      action: () => { view.groupBy = view.groupBy === p.id ? null : p.id; commit(); renderView(); } });
  });
  items.push({ sep: true });
  items.push({ icon: "✕", title: "Não agrupar", action: () => { view.groupBy = null; commit(); renderView(); } });
  showMenu(e.currentTarget, items);
}

function addRow(values = {}) {
  const row = makeRow(state.db, values);
  state.db.rows.push(row);
  commit();
  runAutomations(row, { kind: "rowCreated" });
  renderView();
  return row;
}

function rowMenu(e, row) {
  e.stopPropagation();
  showMenu(e.currentTarget, [
    { icon: "↳", title: "Adicionar sub-item", action: () => {
      const child = makeRow(state.db, {});
      child.parentId = row.id;
      state.db.rows.splice(state.db.rows.indexOf(row) + 1, 0, child);
      state.expanded.add(row.id);
      commit();
      runAutomations(child, { kind: "rowCreated" });
      renderView();
    } },
    { icon: "⧉", title: "Duplicar", action: () => {
      const copy = makeRow(state.db, structuredClone(row.values));
      copy.parentId = row.parentId;
      state.db.rows.splice(state.db.rows.indexOf(row) + 1, 0, copy);
      commit(); renderView();
    } },
    { icon: "▤", title: "Salvar como template", action: async () => {
      const name = await promptDialog({ title: "Nome do template", value: row.values.title || "Template" });
      if (name == null) return;
      state.db.templates = state.db.templates || [];
      state.db.templates.push({ id: uid("tp"), name: name || "Template", values: structuredClone(row.values) });
      commit(); toast("Template salvo — use no botão “Nova linha”");
    } },
    { icon: "🗑", title: "Excluir linha" + (descendantsOf(row.id).length ? " e sub-itens" : ""), danger: true, action: () => {
      const kill = new Set([row.id, ...descendantsOf(row.id)]);
      // limpa os dois lados das relações bidirecionais antes de remover
      state.db.properties.filter((p) => p.type === "relation" && p.inversePropId).forEach((p) => {
        state.db.rows.filter((r) => kill.has(r.id)).forEach((r) => syncInverseRelation(p, r, r.values[p.id] || [], []));
      });
      state.db.rows = state.db.rows.filter((r) => !kill.has(r.id));
      commit(); renderView();
    } },
  ]);
}

/* ids de todos os descendentes (sub-itens em qualquer profundidade) */
function descendantsOf(rowId) {
  const out = [];
  const stack = [rowId];
  while (stack.length) {
    const id = stack.pop();
    state.db.rows.forEach((r) => { if (r.parentId === id) { out.push(r.id); stack.push(r.id); } });
  }
  return out;
}

function columnMenu(e, prop) {
  const items = [
    { icon: "✎", title: "Renomear", action: async () => {
      const name = await promptDialog({ title: "Renomear propriedade", value: prop.name });
      if (name != null) { prop.name = name; commit(); renderView(); }
    } },
  ];
  if (prop.type === "select" || prop.type === "multiselect") {
    items.push({ icon: "◉", title: "Editar opções", action: () => editOptions(prop) });
  }
  if (prop.type === "formula") {
    items.push({ icon: "∑", title: "Editar fórmula", action: async () => {
      const f = await promptDialog({ title: "Fórmula", label: "Use {Nome da propriedade}. Funções: round, abs, min, max, if.", value: prop.formula || "" });
      if (f != null) { prop.formula = f; commit(); renderView(); }
    } });
  }
  if (prop.type === "relation") items.push({ icon: "⇄", title: "Configurar relação", action: () => configureRelation(prop) });
  if (prop.type === "rollup") items.push({ icon: "Σ", title: "Configurar rollup", action: () => configureRollup(prop) });
  if (prop.id !== "title") {
    items.push({ sep: true });
    items.push({ icon: "🗑", title: "Excluir propriedade", danger: true, action: () => {
      state.db.properties = state.db.properties.filter((p) => p.id !== prop.id);
      state.db.rows.forEach((r) => delete r.values[prop.id]);
      state.db.views.forEach((v) => { if (v.groupBy === prop.id) v.groupBy = null; });
      commit(); renderView();
    } });
  }
  showMenu(e.currentTarget instanceof Element ? e.currentTarget : new DOMRect(e.clientX, e.clientY, 0, 0), items);
}

async function editOptions(prop) {
  const raw = await promptDialog({
    title: `Opções de “${prop.name}”`,
    label: "Uma opção por linha (as existentes são mantidas; novas são adicionadas):",
    value: (prop.options || []).map((o) => o.name).join(", "),
  });
  if (raw == null) return;
  const names = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  names.forEach((name, i) => {
    if (!(prop.options || []).some((o) => o.name === name)) {
      prop.options = prop.options || [];
      prop.options.push({ id: uid("o"), name, color: CHIP_COLORS[(prop.options.length) % CHIP_COLORS.length] });
    }
  });
  commit(); renderView();
}

function addColumnMenu(e) {
  showMenu(e.currentTarget, [
    { label: "Tipo da propriedade" },
    ...PROP_TYPES.map((t) => ({
      icon: t.icon, title: t.name,
      action: async () => {
        const name = await promptDialog({ title: `Nova propriedade (${t.name})`, value: t.name });
        if (name == null) return;
        const p = { id: uid("pr"), name, type: t.type };
        if (t.type === "select" || t.type === "multiselect") p.options = [];
        if (t.type === "formula") {
          const f = await promptDialog({ title: "Fórmula", label: "Use {Nome da propriedade}. Ex.: {Preço} * {Qtd}", placeholder: "{A} + {B}" });
          p.formula = f || "";
        }
        state.db.properties.push(p);
        commit(); renderView();
        if (t.type === "relation") configureRelation(p);
        if (t.type === "rollup") configureRollup(p);
      },
    })),
  ]);
}

/* ── Configuração de Relação ── */
function configureRelation(prop) {
  const body = h("div", {});
  const dbs = listDatabases();
  if (!dbs.length) { toast("Nenhuma database para relacionar", { type: "warn" }); return; }

  const twoWay = h("input", { type: "checkbox" });
  twoWay.checked = !!prop.inversePropId;
  body.appendChild(h("label", { class: "gcp-check", style: "margin-bottom:10px" }, twoWay,
    h("span", {}, "Mostrar dos dois lados (a outra database ganha a relação inversa)")));

  dbs.forEach((d) => body.appendChild(h("button", {
    class: "btn " + (prop.targetDbId === d.id ? "primary" : "ghost"),
    style: "width:100%;justify-content:flex-start;margin-bottom:6px",
    onclick: () => {
      prop.targetDbId = d.id;
      if (twoWay.checked) ensureInverseProp(prop, d);
      else if (prop.inversePropId) removeInverseProp(prop);
      commit(); m.close(); renderView();
      toast(twoWay.checked ? "Relação bidirecional configurada" : "Relação configurada");
    },
  }, `${d.icon || "▦"} ${d.name}`)));
  const m = showModal({ title: `Relacionar “${prop.name}” com…`, body, width: 460 });
}

/* ── Relações bidirecionais ──
   A relação inversa é uma propriedade "relation" na database alvo apontando de
   volta; os dois lados são espelhados sempre que uma célula muda. */
function ensureInverseProp(prop, targetDb) {
  const existing = targetDb.properties.find((p) => p.id === prop.inversePropId);
  if (existing) { existing.targetDbId = state.db.id; existing.inversePropId = prop.id; return existing; }
  const inv = {
    id: uid("pr"), type: "relation", name: state.db.name || "Relacionados",
    targetDbId: state.db.id, inversePropId: prop.id,
  };
  targetDb.properties.push(inv);
  prop.inversePropId = inv.id;
  touchDatabase(targetDb.id);
  return inv;
}

function removeInverseProp(prop) {
  const target = prop.targetDbId ? getDatabase(prop.targetDbId) : null;
  if (target && prop.inversePropId) {
    target.properties = target.properties.filter((p) => p.id !== prop.inversePropId);
    target.rows.forEach((r) => { delete r.values[prop.inversePropId]; });
    touchDatabase(target.id);
  }
  delete prop.inversePropId;
}

/* Espelha na database alvo a mudança feita em uma célula de relação */
function syncInverseRelation(prop, row, beforeIds, afterIds) {
  if (!prop.inversePropId || !prop.targetDbId) return;
  const target = getDatabase(prop.targetDbId);
  if (!target) return;
  const before = new Set(beforeIds || []);
  const after = new Set(afterIds || []);
  let changed = false;
  target.rows.forEach((tr) => {
    const has = after.has(tr.id);
    const had = before.has(tr.id);
    if (has === had) return;
    const cur = new Set(tr.values[prop.inversePropId] || []);
    has ? cur.add(row.id) : cur.delete(row.id);
    tr.values[prop.inversePropId] = [...cur];
    tr.updatedAt = Date.now();
    changed = true;
  });
  if (changed) touchDatabase(target.id);
}

/* ── Configuração de Rollup ── */
function configureRollup(prop) {
  const relProps = state.db.properties.filter((p) => p.type === "relation" && p.targetDbId);
  if (!relProps.length) { toast("Crie uma propriedade de Relação (configurada) primeiro", { type: "warn" }); return; }

  const relSel = h("select", { class: "input" });
  relProps.forEach((p) => relSel.appendChild(h("option", { value: p.id, selected: p.id === prop.relationPropId || null }, p.name)));
  const tgtSel = h("select", { class: "input" });
  const aggSel = h("select", { class: "input" });
  [["count", "Contagem"], ["sum", "Soma"], ["avg", "Média"], ["min", "Mínimo"], ["max", "Máximo"], ["show", "Mostrar valores"]]
    .forEach(([v, l]) => aggSel.appendChild(h("option", { value: v, selected: v === prop.agg || null }, l)));

  const fillTargets = () => {
    tgtSel.innerHTML = "";
    const rp = relProps.find((p) => p.id === relSel.value);
    const target = rp && getDatabase(rp.targetDbId);
    (target?.properties || []).forEach((p) => tgtSel.appendChild(h("option", { value: p.id, selected: p.id === prop.targetPropId || null }, p.name)));
  };
  relSel.onchange = fillTargets;
  fillTargets();

  const save = h("button", { class: "btn primary" }, "Salvar");
  const m = showModal({
    title: `Rollup “${prop.name}”`,
    body: h("div", { style: "display:flex;flex-direction:column;gap:10px" },
      label("Pela relação"), relSel,
      label("Propriedade a agregar"), tgtSel,
      label("Cálculo"), aggSel),
    footer: [save], width: 440,
  });
  save.onclick = () => {
    prop.relationPropId = relSel.value; prop.targetPropId = tgtSel.value; prop.agg = aggSel.value;
    commit(); m.close(); renderView(); toast("Rollup configurado");
  };
}
function label(t) { return h("div", { style: "font-size:var(--fs-xs);color:var(--text-3);font-weight:600" }, t); }

/* ── Células por tipo ── */
function renderCell(row, prop, isFirst) {
  const v = row.values[prop.id];
  const cls = "db-cell" + (prop.type === "title" || isFirst ? " cell-title" : "") + (prop.type === "number" ? " cell-number" : "");
  const hasFormula = state.db.properties.some((p) => p.type === "formula");
  const set = (val) => {
    const old = row.values[prop.id];
    row.values[prop.id] = val; row.updatedAt = Date.now(); commit();
    const autoChanged = runAutomations(row, { kind: "propChanged", propId: prop.id, oldValue: old, newValue: val });
    // fórmulas dependem de outras células → re-renderiza para recalcular
    if (autoChanged || (hasFormula && prop.type !== "formula")) renderView();
  };

  switch (prop.type) {
    case "title":
    case "text":
      return textCell(cls, v, set, prop.type === "title" ? "Sem nome" : "");
    case "number": {
      return textCell(cls, v != null ? String(v) : "", (val) => {
        const n = parseFloat(String(val).replace(",", "."));
        set(isNaN(n) ? null : n);
      }, "", (shown) => shown === "" ? "" : Number(shown).toLocaleString("pt-BR"));
    }
    case "checkbox": {
      const check = h("div", { class: "todo-check" + (v ? " checked" : "") }, "✓");
      const cell = h("div", { class: cls, style: "justify-content:center", onclick: () => {
        set(!row.values[prop.id]);
        check.classList.toggle("checked", row.values[prop.id]);
      } }, check);
      return cell;
    }
    case "date": {
      const cell = h("div", { class: cls });
      const paint = () => {
        cell.innerHTML = "";
        const val = row.values[prop.id];
        cell.appendChild(val
          ? h("span", { class: "chip" }, "📅 " + fmtDate(val + "T12:00:00", { day: "numeric", month: "short" }))
          : h("span", { class: "cell-empty" }, "—"));
      };
      cell.onclick = () => {
        cell.innerHTML = "";
        const input = h("input", { type: "date", value: row.values[prop.id] || "" });
        input.onchange = () => { set(input.value || null); paint(); };
        input.onblur = () => setTimeout(paint, 150);
        cell.appendChild(input);
        input.focus();
        input.showPicker?.();
      };
      paint();
      return cell;
    }
    case "select": {
      const cell = h("div", { class: cls });
      const paint = () => {
        cell.innerHTML = "";
        const o = prop.options?.find((o) => o.id === row.values[prop.id]);
        cell.appendChild(o ? h("span", { class: chipClass(o.color) }, o.name) : h("span", { class: "cell-empty" }, "—"));
      };
      cell.onclick = (e) => selectMenu(e, cell, prop, row.values[prop.id], (optId) => { set(optId); paint(); });
      paint();
      return cell;
    }
    case "multiselect": {
      const cell = h("div", { class: cls, style: "flex-wrap:wrap" });
      const paint = () => {
        cell.innerHTML = "";
        const ids = row.values[prop.id] || [];
        const opts = ids.map((id) => prop.options?.find((o) => o.id === id)).filter(Boolean);
        if (!opts.length) cell.appendChild(h("span", { class: "cell-empty" }, "—"));
        opts.forEach((o) => cell.appendChild(h("span", { class: chipClass(o.color) }, o.name)));
      };
      cell.onclick = (e) => multiSelectMenu(e, cell, prop, row, paint);
      paint();
      return cell;
    }
    case "url": {
      const cell = h("div", { class: cls });
      const paint = () => {
        cell.innerHTML = "";
        const val = row.values[prop.id];
        if (val) cell.appendChild(h("a", { href: /^https?:/i.test(val) ? val : "https://" + val, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, val));
        else cell.appendChild(h("span", { class: "cell-empty" }, "—"));
      };
      cell.onclick = () => {
        cell.innerHTML = "";
        const input = h("input", { value: row.values[prop.id] || "", placeholder: "https://…" });
        const done = () => { set(input.value.trim() || null); paint(); };
        input.onblur = done;
        input.onkeydown = (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = row.values[prop.id] || ""; input.blur(); } };
        cell.appendChild(input);
        input.focus();
      };
      paint();
      return cell;
    }
    case "file": {
      const cell = h("div", { class: cls + " cell-file" });
      const paint = () => {
        cell.innerHTML = "";
        const f = row.values[prop.id];
        if (!f) { cell.appendChild(h("span", { class: "cell-empty" }, "＋ arquivo")); return; }
        const isImg = (f.type || "").startsWith("image/");
        cell.appendChild(isImg
          ? h("img", { class: "file-thumb", src: f.src, alt: f.name || "", title: f.name || "" })
          : h("span", { class: "file-chip", title: f.name || "" }, "📎 " + (f.name || "arquivo").slice(0, 22)));
        cell.appendChild(h("button", {
          class: "file-x", title: "Remover arquivo",
          onclick: (e) => { e.stopPropagation(); set(null); paint(); },
        }, "✕"));
      };
      cell.onclick = () => pickFileFor(row, prop, set, paint);
      paint();
      return cell;
    }
    case "formula": {
      const val = evalFormula(prop, row, state.db);
      const cell = h("div", { class: cls + " cell-formula", title: "Fórmula (somente leitura) — edite no menu da coluna" });
      cell.appendChild(val === "" ? h("span", { class: "cell-empty" }, "—") : h("span", {}, val));
      return cell;
    }
    case "relation": {
      const cell = h("div", { class: cls, style: "flex-wrap:wrap" });
      const target = prop.targetDbId ? getDatabase(prop.targetDbId) : null;
      const paint = () => {
        cell.innerHTML = "";
        if (!target) { cell.appendChild(h("span", { class: "cell-empty" }, "config →")); return; }
        const ids = row.values[prop.id] || [];
        if (!ids.length) cell.appendChild(h("span", { class: "cell-empty" }, "—"));
        ids.forEach((rid) => {
          const r = target.rows.find((x) => x.id === rid);
          if (r) cell.appendChild(h("span", { class: "chip c-blue rel-chip" }, r.values.title || "Sem nome"));
        });
      };
      cell.onclick = (e) => {
        if (!prop.targetDbId) { columnMenu(e, prop); return; }
        relationMenu(cell, prop, row, paint);
      };
      paint();
      return cell;
    }
    case "rollup": {
      const cell = h("div", { class: cls + " cell-formula", title: "Rollup (somente leitura)" });
      const val = evalRollup(prop, row, state.db);
      cell.appendChild(val === "" ? h("span", { class: "cell-empty" }, "—") : h("span", {}, val));
      return cell;
    }
    case "created":
    case "updated": {
      const ts = autoValue(row, prop);
      const cell = h("div", { class: cls + " cell-formula", title: prop.type === "created" ? "Data de criação (automática)" : "Última edição (automática)" });
      cell.appendChild(h("span", {}, fmtDate(ts, { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })));
      return cell;
    }
    default:
      return h("div", { class: cls }, h("span", { class: "cell-empty" }, "—"));
  }
}

/* ── Relação: escolher linhas de outra database ── */
function relationMenu(anchor, prop, row, repaint) {
  const target = getDatabase(prop.targetDbId);
  if (!target) return;
  const ids = () => row.values[prop.id] || [];
  const items = target.rows.slice(0, 60).map((r) => ({
    icon: ids().includes(r.id) ? "✓" : " ",
    title: r.values.title || "Sem nome",
    action: () => {
      const before = ids();
      const cur = new Set(before);
      cur.has(r.id) ? cur.delete(r.id) : cur.add(r.id);
      row.values[prop.id] = [...cur];
      row.updatedAt = Date.now();
      syncInverseRelation(prop, row, before, row.values[prop.id]);
      commit(); repaint();
    },
  }));
  showMenu(anchor, [{ label: `Relacionar com ${target.name}` }, ...(items.length ? items : [{ title: "A outra database está vazia" }])]);
}

/* ── Rollup: agrega uma propriedade das linhas relacionadas ── */
function evalRollup(prop, row, db) {
  const relProp = db.properties.find((p) => p.id === prop.relationPropId && p.type === "relation");
  if (!relProp || !relProp.targetDbId) return "";
  const target = getDatabase(relProp.targetDbId);
  if (!target) return "";
  const ids = row.values[relProp.id] || [];
  const rows = ids.map((id) => target.rows.find((r) => r.id === id)).filter(Boolean);
  const tProp = target.properties.find((p) => p.id === prop.targetPropId);
  if (!tProp && prop.agg !== "count") return String(rows.length);
  const vals = rows.map((r) => {
    let v = r.values[tProp?.id];
    if (tProp?.type === "select") return tProp.options?.find((o) => o.id === v)?.name ?? "";
    if (tProp?.type === "checkbox") return v ? 1 : 0;
    if (tProp?.type === "formula") return parseFloat(evalFormula(tProp, r, target)) || 0;
    return v;
  });
  const nums = vals.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
  switch (prop.agg) {
    case "count": return String(rows.length);
    case "sum": return String(nums.reduce((a, b) => a + b, 0));
    case "avg": return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "0";
    case "min": return nums.length ? String(Math.min(...nums)) : "—";
    case "max": return nums.length ? String(Math.max(...nums)) : "—";
    default: return vals.filter((v) => v != null && v !== "").join(", ") || "—";
  }
}

/* avaliador de fórmula seguro: substitui {Prop} e avalia aritmética/funções */
function evalFormula(prop, row, db) {
  let expr = (prop.formula || "").trim();
  if (!expr) return "";
  expr = expr.replace(/\{([^}]+)\}/g, (_, name) => {
    const p = db.properties.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!p || p.id === prop.id) return "0";
    let v = row.values[p.id];
    if (p.type === "select") v = p.options?.find((o) => o.id === v)?.name ?? "";
    if (p.type === "checkbox") return v ? "1" : "0";
    if (p.type === "number") return String(Number(v) || 0);
    if (p.type === "formula") return "0";
    return JSON.stringify(String(v ?? ""));
  });
  expr = expr.replace(/\bif\s*\(/gi, "iff(");
  // Valida só o CÓDIGO: o texto entre aspas é dado do usuário (pode ter
  // acento, vírgula, qualquer coisa) e não deve passar pela whitelist.
  const masked = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  if (!/^[\s0-9.+\-*/%(),<>=!?:"'\]\[a-zA-Z_]*$/.test(masked)) return "⚠";
  const idents = masked.match(/[a-zA-Z_]\w*/g) || [];
  // literais são permitidos, mas não podem virar nome de parâmetro (reservados)
  if (idents.some((id) => !FORMULA_FNS.has(id) && !FORMULA_LITERALS.has(id))) return "⚠";
  try {
    const names = [...FORMULA_FNS.keys()];
    const fn = new Function(...names, `"use strict"; return (${expr});`);
    const res = fn(...names.map((n) => FORMULA_FNS.get(n)));
    if (typeof res === "number") return Number.isFinite(res) ? (Number.isInteger(res) ? String(res) : res.toFixed(2)) : "⚠";
    if (typeof res === "boolean") return res ? "sim" : "não";
    return String(res);
  } catch { return "⚠"; }
}

/* Funções disponíveis nas fórmulas — números, datas e texto.
   Datas trafegam como "YYYY-MM-DD" (o mesmo formato das células). */
const dParse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "").trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const dFmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

const FORMULA_FNS = new Map(Object.entries({
  // lógica e números
  iff: (c, a, b) => (c ? a : b),
  round: Math.round, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
  raiz: Math.sqrt,
  // datas
  hoje: () => todayKey(),
  dias: (a, b) => {           // dias de `a` até `b` (padrão: até hoje)
    const d1 = dParse(a), d2 = b === undefined ? new Date() : dParse(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2.setHours(0, 0, 0, 0) - d1.setHours(0, 0, 0, 0)) / 86400000);
  },
  somarDias: (a, n) => { const d = dParse(a); if (!d) return ""; d.setDate(d.getDate() + (Number(n) || 0)); return dFmt(d); },
  ano: (a) => dParse(a)?.getFullYear() ?? 0,
  mes: (a) => (dParse(a) ? dParse(a).getMonth() + 1 : 0),
  dia: (a) => dParse(a)?.getDate() ?? 0,
  // texto
  concat: (...xs) => xs.map((x) => String(x ?? "")).join(""),
  maiusc: (s) => String(s ?? "").toUpperCase(),
  minusc: (s) => String(s ?? "").toLowerCase(),
  tamanho: (s) => String(s ?? "").length,
  contem: (s, t) => String(s ?? "").toLowerCase().includes(String(t ?? "").toLowerCase()),
  substituir: (s, de, para) => String(s ?? "").split(String(de ?? "")).join(String(para ?? "")),
  vazio: (s) => String(s ?? "").trim() === "",
}));
const FORMULA_LITERALS = new Set(["true", "false", "null", "undefined"]);

function textCell(cls, value, set, placeholder = "", fmt = (s) => s) {
  const cell = h("div", { class: cls });
  const paint = () => {
    cell.innerHTML = "";
    const shown = value != null && value !== "" ? fmt(String(value)) : "";
    cell.appendChild(shown
      ? h("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, shown)
      : h("span", { class: "cell-empty" }, placeholder || "—"));
  };
  cell.onclick = () => {
    if (cell.querySelector("input")) return;
    cell.innerHTML = "";
    const input = h("input", { value: value != null ? String(value) : "" });
    const done = () => { value = input.value; set(input.value); paint(); };
    input.onblur = done;
    input.onkeydown = (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = value ?? ""; input.blur(); } };
    cell.appendChild(input);
    input.focus(); input.select();
  };
  paint();
  return cell;
}

function selectMenu(e, anchor, prop, currentId, onPick) {
  const items = (prop.options || []).map((o) => ({
    icon: o.id === currentId ? "✓" : " ",
    title: o.name,
    action: () => onPick(o.id === currentId ? null : o.id),
  }));
  items.push({ sep: true });
  items.push({ icon: "＋", title: "Nova opção…", action: async () => {
    const name = await promptDialog({ title: "Nova opção" });
    if (!name) return;
    const o = { id: uid("o"), name, color: CHIP_COLORS[(prop.options?.length || 0) % CHIP_COLORS.length] };
    prop.options = prop.options || [];
    prop.options.push(o);
    onPick(o.id);
  } });
  showMenu(anchor, items);
}

function multiSelectMenu(e, anchor, prop, row, repaint) {
  const ids = () => row.values[prop.id] || [];
  const items = (prop.options || []).map((o) => ({
    icon: ids().includes(o.id) ? "✓" : " ",
    title: o.name,
    action: () => {
      const cur = new Set(ids());
      cur.has(o.id) ? cur.delete(o.id) : cur.add(o.id);
      row.values[prop.id] = [...cur];
      commit(); repaint();
    },
  }));
  items.push({ sep: true });
  items.push({ icon: "＋", title: "Nova opção…", action: async () => {
    const name = await promptDialog({ title: "Nova opção" });
    if (!name) return;
    const o = { id: uid("o"), name, color: CHIP_COLORS[(prop.options?.length || 0) % CHIP_COLORS.length] };
    prop.options = prop.options || [];
    prop.options.push(o);
    row.values[prop.id] = [...ids(), o.id];
    commit(); repaint();
  } });
  showMenu(anchor, items);
}

/* ═══════════ KANBAN ═══════════ */
function renderKanban(root) {
  const { db } = state;
  const view = currentView();
  let groupProp = db.properties.find((p) => p.id === view.groupBy && p.type === "select");
  if (!groupProp) {
    groupProp = db.properties.find((p) => p.type === "select");
    if (groupProp) { view.groupBy = groupProp.id; commit(); }
  }
  if (!groupProp) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "▥"),
      h("div", { class: "es-title" }, "O Kanban precisa de uma propriedade Select"),
      h("div", { class: "es-desc" }, "Adicione uma propriedade do tipo Select na view de tabela para agrupar cartões.")));
    return;
  }

  const rows = visibleRows();
  const board = h("div", { class: "kanban" });
  const groups = [...(groupProp.options || []), { id: null, name: "Sem status", color: "gray" }];

  groups.forEach((opt) => {
    const colRows = rows.filter((r) => (r.values[groupProp.id] ?? null) === opt.id);
    const cards = h("div", { class: "kanban-cards", dataset: { optId: opt.id ?? "" } });

    colRows.forEach((row) => cards.appendChild(kanbanCard(row, groupProp)));

    const col = h("div", { class: "kanban-col", dataset: { optId: opt.id ?? "" } },
      h("div", { class: "kanban-col-head" },
        h("span", { class: chipClass(opt.color) }, opt.name),
        h("span", { class: "kanban-count" }, String(colRows.length))),
      cards,
      kanbanAddButton(opt, groupProp)
    );

    // drop target
    col.addEventListener("dragover", (e) => {
      if (![...e.dataTransfer.types].includes("text/nexus-row")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drop-target");
    });
    col.addEventListener("dragleave", (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove("drop-target");
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      const rowId = e.dataTransfer.getData("text/nexus-row");
      const row = db.rows.find((r) => r.id === rowId);
      if (!row) return;
      const newVal = opt.id;
      if ((row.values[groupProp.id] ?? null) === newVal) return;
      const oldVal = row.values[groupProp.id] ?? null;
      flip(board, () => {
        row.values[groupProp.id] = newVal;
        row.updatedAt = Date.now();
        commit();
        runAutomations(row, { kind: "propChanged", propId: groupProp.id, oldValue: oldVal, newValue: newVal });
        renderView();
      });
    });

    board.appendChild(col);
  });

  root.appendChild(board);
  if (!rows.length) {
    root.appendChild(h("div", { class: "empty-state", style: "padding-top:0" },
      h("div", { class: "es-desc" }, "Sem cartões — adicione pelo “＋ Novo” em qualquer coluna.")));
  }
}

function kanbanCard(row, groupProp) {
  const { db } = state;
  const title = row.values.title || "Sem nome";
  const meta = h("div", { class: "kc-meta" });
  db.properties.forEach((p) => {
    if (p.id === "title" || p.id === groupProp.id) return;
    const v = row.values[p.id];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    if (p.type === "select") {
      const o = p.options?.find((o) => o.id === v);
      if (o) meta.appendChild(h("span", { class: chipClass(o.color) }, o.name));
    } else if (p.type === "multiselect") {
      v.slice(0, 3).forEach((id) => {
        const o = p.options?.find((o) => o.id === id);
        if (o) meta.appendChild(h("span", { class: chipClass(o.color) }, o.name));
      });
    } else if (p.type === "date") {
      meta.appendChild(h("span", { class: "chip" }, "📅 " + fmtDate(v + "T12:00:00", { day: "numeric", month: "short" })));
    } else if (p.type === "checkbox" && v) {
      meta.appendChild(h("span", { class: "chip c-green" }, "✓ " + p.name));
    }
  });

  // botão de menu sempre visível — no toque é a forma de mover/editar (o arraste HTML5 não funciona no mobile)
  const menuBtn = h("button", { class: "icon-btn kc-menu", "aria-label": "Opções do cartão",
    onclick: (e) => { e.stopPropagation(); kanbanCardMenu(e, row, groupProp); } }, "⋯");

  const card = h("div", {
    class: "kanban-card", draggable: "true", dataset: { flipId: row.id, rowId: row.id },
  },
    h("div", { class: "kc-head" }, h("div", { class: "kc-title" }, title), menuBtn),
    meta
  );
  // sub-itens: contador de concluídos (usa a 1ª propriedade checkbox, se houver)
  const kids = db.rows.filter((r) => r.parentId === row.id);
  if (kids.length) {
    const check = db.properties.find((p) => p.type === "checkbox");
    const done = check ? kids.filter((k) => k.values[check.id]).length : 0;
    card.appendChild(h("div", { class: "kc-subitems", title: `${kids.length} sub-${kids.length === 1 ? "item" : "itens"}` },
      "↳ " + (check ? `${done}/${kids.length}` : `${kids.length}`) + " sub-" + (kids.length === 1 ? "item" : "itens")));
  }
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/nexus-row", row.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("dblclick", () => editTitle(row));
  card.addEventListener("contextmenu", (e) => { e.preventDefault(); kanbanCardMenu(e, row, groupProp); });
  return card;
}

/* Menu do cartão do kanban — inclui "Mover para" (alternativa ao arraste, funciona no toque) */
function kanbanCardMenu(e, row, groupProp) {
  const cur = row.values[groupProp.id] ?? null;
  const groups = [...(groupProp.options || []), { id: null, name: "Sem status", color: "gray" }];
  const move = (optId) => {
    if ((row.values[groupProp.id] ?? null) === optId) return;
    const oldVal = row.values[groupProp.id] ?? null;
    row.values[groupProp.id] = optId; row.updatedAt = Date.now();
    commit();
    runAutomations(row, { kind: "propChanged", propId: groupProp.id, oldValue: oldVal, newValue: optId });
    renderView();
  };
  const anchor = e.currentTarget?.getBoundingClientRect ? e.currentTarget : new DOMRect(e.clientX, e.clientY, 0, 0);
  showMenu(anchor, [
    { icon: "✎", title: "Editar cartão", action: () => editTitle(row) },
    { label: "Mover para" },
    ...groups.filter((g) => g.id !== cur).map((g) => ({
      icon: "→", title: g.name, action: () => move(g.id),
    })),
    { sep: true },
    { icon: "🗑", title: "Excluir cartão", danger: true, action: () => {
      state.db.rows = state.db.rows.filter((r) => r.id !== row.id);
      commit(); renderView();
    } },
  ], { align: "right" });
}

function kanbanAddButton(opt, groupProp) {
  const holder = h("div", {});
  const btn = h("button", { class: "kanban-add" }, h("span", {}, "＋"), h("span", {}, "Novo"));
  btn.onclick = () => {
    const input = h("input", { class: "kanban-add-input", placeholder: "Nome do cartão…" });
    holder.replaceChildren(input);
    input.focus();
    const done = (save) => {
      const name = input.value.trim();
      if (save && name) {
        const values = { title: name };
        if (opt.id) values[groupProp.id] = opt.id;
        const nrow = makeRow(state.db, values);
        state.db.rows.push(nrow);
        commit();
        runAutomations(nrow, { kind: "rowCreated" });
        renderView();
        return;
      }
      holder.replaceChildren(btn);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    };
    input.onblur = () => done(!!input.value.trim());
  };
  holder.appendChild(btn);
  return holder;
}

/* ═══════════════════════════════════════════════════════════
   TIMELINE / GANTT
   ═══════════════════════════════════════════════════════════ */
const DAY_MS = 86400000;
const G_DAY_W = 30, G_LABEL_W = 190, G_ROW_H = 38, G_HEAD_H = 46;
const BAR_BG = { gray: "#64748b", blue: "#3b82f6", green: "#16a34a", amber: "#d97706", red: "#dc2626", purple: "#7c3aed" };

function dayToDate(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function diffDays(a, b) { return Math.round((dayToDate(b) - dayToDate(a)) / DAY_MS); }
function addDaysKey(key, n) { const dt = dayToDate(key); dt.setDate(dt.getDate() + n); return todayKey(dt); }

function renderTimeline(root) {
  const { db } = state;
  const view = currentView();
  const dateProps = db.properties.filter((p) => p.type === "date");
  if (!dateProps.length) return emptyView(root, "📊", "A timeline precisa de ao menos uma propriedade do tipo Data.");

  // Resolve propriedades de início / fim / dependência (com defaults tolerantes)
  let startProp = db.properties.find((p) => p.id === view.startProp && p.type === "date") || dateProps[0];
  view.startProp = startProp.id;
  let endProp = view.endProp === null ? null
    : (db.properties.find((p) => p.id === view.endProp && p.type === "date") || dateProps[1] || null);
  view.endProp = endProp ? endProp.id : null;
  const selfRels = db.properties.filter((p) => p.type === "relation" && p.targetDbId === db.id);
  let depProp = db.properties.find((p) => p.id === view.depProp && p.type === "relation" && p.targetDbId === db.id) || null;
  view.depProp = depProp ? depProp.id : null;

  // Barra de configuração da view
  const cfg = h("div", { class: "gantt-config" });
  const mkSel = (label, propId, opts) => {
    const sel = h("select", { class: "input sm" });
    opts.forEach(([v, l]) => sel.appendChild(h("option", { value: v, selected: v === (propId ?? "") || null }, l)));
    return h("label", { class: "gantt-cfg-item" }, h("span", {}, label), sel);
  };
  const startSel = mkSel("Início", startProp.id, dateProps.map((p) => [p.id, p.name]));
  startSel.querySelector("select").onchange = (e) => { view.startProp = e.target.value; commit(); renderView(); };
  const endSel = mkSel("Fim", endProp?.id ?? "", [["", "— nenhum —"], ...dateProps.map((p) => [p.id, p.name])]);
  endSel.querySelector("select").onchange = (e) => { view.endProp = e.target.value || null; if (!e.target.value) view.endProp = null; else view.endProp = e.target.value; commit(); renderView(); };
  cfg.append(startSel, endSel);
  const depOpts = [["", "— nenhuma —"], ...selfRels.map((p) => [p.id, p.name]), ["__new", "＋ criar relação de dependência"]];
  const depSel = mkSel("Dependência", depProp?.id ?? "", depOpts);
  depSel.querySelector("select").onchange = (e) => {
    if (e.target.value === "__new") {
      const np = { id: uid("pr"), name: "Depende de", type: "relation", targetDbId: db.id };
      db.properties.push(np); view.depProp = np.id; commit(); renderView();
      toast("Relação de dependência criada — preencha na tabela");
      return;
    }
    view.depProp = e.target.value || null; commit(); renderView();
  };
  cfg.append(depSel);
  root.appendChild(cfg);

  // Linhas visíveis com data de início
  const rows = visibleRows().filter((r) => r.values[startProp.id]);
  if (!rows.length) { root.appendChild(h("div", { class: "empty-state", style: "padding-top:8px" }, h("div", { class: "es-desc" }, "Nenhum registro com data de início. Defina a data “" + startProp.name + "” para vê-los aqui."))); return; }
  rows.sort((a, b) => (a.values[startProp.id] < b.values[startProp.id] ? -1 : 1));

  const endOf = (r) => (endProp && r.values[endProp.id]) || r.values[startProp.id];
  let min = null, max = null;
  rows.forEach((r) => { const s = r.values[startProp.id], e = endOf(r); if (!min || s < min) min = s; if (!max || e > max) max = e; });
  const rangeStart = addDaysKey(min, -2);
  const rangeEnd = addDaysKey(max, 4);
  const totalDays = diffDays(rangeStart, rangeEnd) + 1;
  const gridW = totalDays * G_DAY_W;
  const idxOf = new Map(rows.map((r, i) => [r.id, i]));
  const today = todayKey();

  const scroll = h("div", { class: "gantt-scroll" });
  const inner = h("div", { class: "gantt-inner", style: `width:${G_LABEL_W + gridW}px` });

  // ── Cabeçalho: banda de meses + números dos dias ──
  const months = h("div", { class: "gantt-months", style: `width:${gridW}px` });
  let i = 0;
  while (i < totalDays) {
    const dk = addDaysKey(rangeStart, i);
    const dt = dayToDate(dk);
    let span = 0;
    while (i + span < totalDays) { const d2 = dayToDate(addDaysKey(rangeStart, i + span)); if (d2.getMonth() !== dt.getMonth() || d2.getFullYear() !== dt.getFullYear()) break; span++; }
    const lbl = dt.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
    months.appendChild(h("div", { class: "gantt-month", style: `width:${span * G_DAY_W}px` }, lbl[0].toUpperCase() + lbl.slice(1)));
    i += span;
  }
  const daysRow = h("div", { class: "gantt-days", style: `width:${gridW}px` });
  for (let d = 0; d < totalDays; d++) {
    const dk = addDaysKey(rangeStart, d);
    const dt = dayToDate(dk);
    const wknd = dt.getDay() === 0 || dt.getDay() === 6;
    daysRow.appendChild(h("div", { class: "gantt-day" + (wknd ? " wknd" : "") + (dk === today ? " today" : "") }, String(dt.getDate())));
  }
  const head = h("div", { class: "gantt-head", style: `height:${G_HEAD_H}px` },
    h("div", { class: "gantt-corner", style: `width:${G_LABEL_W}px` }, `${rows.length} ${rows.length === 1 ? "item" : "itens"}`),
    h("div", { class: "gantt-cols" }, months, daysRow));
  inner.appendChild(head);

  // ── Corpo: uma linha por registro ──
  const body = h("div", { class: "gantt-body" });
  rows.forEach((row) => {
    const s = row.values[startProp.id], e = endOf(row);
    const left = diffDays(rangeStart, s) * G_DAY_W;
    const spanDays = Math.max(0, diffDays(s, e)) + 1;
    const barW = Math.max(G_DAY_W - 4, spanDays * G_DAY_W - 4);
    const color = BAR_BG[colorForRow(row) || "blue"] || BAR_BG.blue;

    const bar = h("div", {
      class: "gantt-bar", title: `${row.values.title || "Sem nome"} · ${fmtDate(s + "T12:00:00")}${endProp ? " → " + fmtDate(e + "T12:00:00") : ""}`,
      style: `left:${left}px;width:${barW}px;background:${color}`,
      dataset: { rowId: row.id },
    }, h("span", { class: "gantt-bar-label" }, row.values.title || "Sem nome"));
    if (endProp) bar.appendChild(h("span", { class: "gantt-handle" }));
    ganttDrag(bar, row, { startProp, endProp, rangeStart });

    const track = h("div", { class: "gantt-track", style: `width:${gridW}px` }, bar);
    // marcador de hoje
    if (today >= rangeStart && today <= rangeEnd) track.appendChild(h("div", { class: "gantt-todayline", style: `left:${diffDays(rangeStart, today) * G_DAY_W}px` }));

    const label = h("div", { class: "gantt-label", style: `width:${G_LABEL_W}px`, title: row.values.title || "" }, row.values.title || "Sem nome");
    label.addEventListener("dblclick", () => editTitle(row));
    body.appendChild(h("div", { class: "gantt-row", style: `height:${G_ROW_H}px` }, label, track));
  });

  // ── Conectores de dependência (SVG) ──
  if (depProp) {
    const paths = [];
    rows.forEach((row) => {
      const preds = row.values[depProp.id] || [];
      const rStartX = diffDays(rangeStart, row.values[startProp.id]) * G_DAY_W;
      const rY = idxOf.get(row.id) * G_ROW_H + G_ROW_H / 2;
      preds.forEach((pid) => {
        if (!idxOf.has(pid)) return;
        const pr = rows[idxOf.get(pid)];
        const pEnd = endOf(pr);
        const pEndX = (diffDays(rangeStart, pEnd) + 1) * G_DAY_W;
        const pY = idxOf.get(pid) * G_ROW_H + G_ROW_H / 2;
        const c = Math.max(18, Math.abs(rStartX - pEndX) / 2);
        paths.push(`<path d="M ${pEndX} ${pY} C ${pEndX + c} ${pY}, ${rStartX - c} ${rY}, ${rStartX - 4} ${rY}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" marker-end="url(#gz-arrow)"/>`);
      });
    });
    if (paths.length) {
      const svg = h("div", { class: "gantt-deps", style: `left:${G_LABEL_W}px;width:${gridW}px;height:${rows.length * G_ROW_H}px` });
      svg.innerHTML = `<svg width="${gridW}" height="${rows.length * G_ROW_H}" style="overflow:visible">
        <defs><marker id="gz-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" fill="var(--text-faint)"/></marker></defs>${paths.join("")}</svg>`;
      body.appendChild(svg);
    }
  }

  inner.appendChild(body);
  scroll.appendChild(inner);
  root.appendChild(scroll);
}

/* Arrastar barra (mover) e redimensionar borda direita (duração) */
function ganttDrag(bar, row, { startProp, endProp, rangeStart }) {
  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const isHandle = e.target.classList.contains("gantt-handle");
    e.preventDefault();
    const startX = e.clientX;
    const origLeft = parseFloat(bar.style.left) || 0;
    const origW = parseFloat(bar.style.width) || G_DAY_W;
    bar.classList.add("dragging");
    document.body.style.cursor = isHandle ? "ew-resize" : "grabbing";

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (isHandle) bar.style.width = Math.max(G_DAY_W - 4, origW + dx) + "px";
      else bar.style.left = origLeft + dx + "px";
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      bar.classList.remove("dragging");
      document.body.style.cursor = "";
      const dxDays = Math.round((ev.clientX - startX) / G_DAY_W);
      if (!dxDays) { renderView(); return; }
      const s0 = row.values[startProp.id];
      if (isHandle && endProp) {
        const e0 = row.values[endProp.id] || s0;
        let ne = addDaysKey(e0, dxDays);
        if (ne < s0) ne = s0;
        row.values[endProp.id] = ne;
      } else {
        const ns = addDaysKey(s0, dxDays);
        row.values[startProp.id] = ns;
        if (endProp && row.values[endProp.id]) row.values[endProp.id] = addDaysKey(row.values[endProp.id], dxDays);
      }
      row.updatedAt = Date.now();
      commit();
      runAutomations(row, { kind: "propChanged", propId: isHandle ? (endProp?.id || startProp.id) : startProp.id, oldValue: s0, newValue: row.values[startProp.id] });
      renderView();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  bar.addEventListener("pointerdown", onDown);
  bar.addEventListener("dblclick", (e) => { e.stopPropagation(); editTitle(row); });
}

/* ═══════════════════════════════════════════════════════════
   AUTOMAÇÕES LOCAIS  (gatilho → ações, tudo no dispositivo)
   ═══════════════════════════════════════════════════════════ */
function runAutomations(row, change) {
  const db = state.db;
  const autos = db.automations || [];
  if (!autos.length) return false;
  let changed = false;
  const notes = [];
  for (const a of autos) {
    if (a.enabled === false) continue;
    const t = a.trigger || {};
    let fires = false;
    if (change.kind === "rowCreated" && t.type === "rowCreated") fires = true;
    else if (change.kind === "propChanged" && t.type === "propChanged" && (!t.propId || t.propId === change.propId)) {
      fires = (t.toValue == null || t.toValue === "") ? true : String(change.newValue) === String(t.toValue);
    }
    if (!fires) continue;
    for (const act of a.actions || []) {
      if (act.type === "notify") { notes.push(act.message || `Automação: ${a.name || "sem nome"}`); continue; }
      if (act.type === "setProp" && act.propId) {
        const tp = db.properties.find((p) => p.id === act.propId);
        if (!tp || COMPUTED_PROPS.has(tp.type)) continue;
        let val = act.value;
        if (val === "@today") val = todayKey();
        else if (val === "@tomorrow") val = todayKey(new Date(Date.now() + DAY_MS));
        else if (tp.type === "number") { const n = parseFloat(String(val).replace(",", ".")); val = isNaN(n) ? null : n; }
        else if (tp.type === "checkbox") val = (val === true || val === "true");
        else if (val === "" && (tp.type === "multiselect" || tp.type === "relation")) val = [];
        if (JSON.stringify(row.values[act.propId]) !== JSON.stringify(val)) { row.values[act.propId] = val; changed = true; }
      }
    }
  }
  if (changed) { row.updatedAt = Date.now(); commit(); }
  notes.forEach((m) => toast(m));
  return changed;
}

function describeAutomation(a) {
  const db = state.db;
  const pn = (id) => db.properties.find((p) => p.id === id)?.name || "?";
  const t = a.trigger || {};
  let trig = t.type === "rowCreated" ? "Ao criar registro" : `Quando “${pn(t.propId)}” mudar`;
  if (t.type === "propChanged" && t.toValue != null && t.toValue !== "") {
    const p = db.properties.find((x) => x.id === t.propId);
    let vl = t.toValue;
    if (p?.type === "select") vl = p.options?.find((o) => o.id === t.toValue)?.name || vl;
    if (p?.type === "checkbox") vl = (t.toValue === true || t.toValue === "true") ? "marcado" : "desmarcado";
    trig += ` p/ “${vl}”`;
  }
  const acts = (a.actions || []).map((ac) => {
    if (ac.type === "notify") return "🔔 notificar";
    const p = db.properties.find((x) => x.id === ac.propId);
    let vl = ac.value;
    if (p?.type === "select") vl = p.options?.find((o) => o.id === ac.value)?.name || "(vazio)";
    else if (p?.type === "checkbox") vl = (ac.value === true || ac.value === "true") ? "marcado" : "desmarcado";
    else if (p?.type === "date") vl = ac.value === "@today" ? "hoje" : ac.value === "@tomorrow" ? "amanhã" : "limpar";
    else if (ac.value === "" || ac.value == null) vl = "(vazio)";
    return `definir “${pn(ac.propId)}” = ${vl}`;
  });
  return `${trig} → ${acts.join(" · ") || "(sem ações)"}`;
}

function automationsModal() {
  const db = state.db;
  db.automations = db.automations || [];
  const list = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const paint = () => {
    list.innerHTML = "";
    if (!db.automations.length) list.appendChild(h("div", { style: "color:var(--text-faint);font-size:var(--fs-sm);padding:6px 0" }, "Nenhuma automação ainda."));
    db.automations.forEach((a) => list.appendChild(automationCard(a, paint, () => m.close())));
  };
  paint();
  const add = h("button", { class: "btn ghost sm", onclick: () => { m.close(); automationEditor(null); } }, "＋ Nova automação");
  const m = showModal({
    title: "⚡ Automações locais",
    body: h("div", { style: "display:flex;flex-direction:column;gap:12px" },
      h("div", { style: "font-size:var(--fs-sm);color:var(--text-2)" }, "Reaja a mudanças nesta database automaticamente — 100% local, sem servidor."),
      list, add),
    width: 620,
  });
}

function automationCard(a, repaint, closeModal) {
  const db = state.db;
  const toggle = h("button", { class: "auto-toggle" + (a.enabled === false ? "" : " on"), title: a.enabled === false ? "Ativar" : "Desativar",
    onclick: () => { a.enabled = a.enabled === false; commit(); repaint(); } }, a.enabled === false ? "○" : "●");
  return h("div", { class: "auto-card" },
    toggle,
    h("div", { class: "auto-body" },
      h("div", { class: "auto-name" }, a.name || "Automação"),
      h("div", { class: "auto-desc" }, describeAutomation(a))),
    h("button", { class: "icon-btn", title: "Editar", onclick: () => { closeModal(); automationEditor(a); } }, "✎"),
    h("button", { class: "icon-btn", title: "Excluir", onclick: () => { db.automations = db.automations.filter((x) => x !== a); commit(); repaint(); } }, "🗑"));
}

/* Controle de valor conforme o tipo da propriedade */
function autoValueControl(prop, current, { includeAny = false } = {}) {
  if (!prop) { const i = h("input", { class: "input", value: current ?? "" }); return { el: i, get: () => i.value }; }
  if (prop.type === "select") {
    const sel = h("select", { class: "input" });
    sel.appendChild(h("option", { value: "", selected: (current === "" || current == null) || null }, includeAny ? "(qualquer)" : "(vazio)"));
    (prop.options || []).forEach((o) => sel.appendChild(h("option", { value: o.id, selected: o.id === current || null }, o.name)));
    return { el: sel, get: () => sel.value };
  }
  if (prop.type === "checkbox") {
    const sel = h("select", { class: "input" });
    if (includeAny) sel.appendChild(h("option", { value: "", selected: (current === "" || current == null) || null }, "(qualquer)"));
    sel.appendChild(h("option", { value: "true", selected: (current === true || current === "true") || null }, "Marcado"));
    sel.appendChild(h("option", { value: "false", selected: (current === false || current === "false") || null }, "Desmarcado"));
    return { el: sel, get: () => sel.value === "" ? "" : (sel.value === "true") };
  }
  if (prop.type === "date" && !includeAny) {
    const sel = h("select", { class: "input" });
    [["@today", "Hoje"], ["@tomorrow", "Amanhã"], ["", "Limpar"]].forEach(([v, l]) => sel.appendChild(h("option", { value: v, selected: v === current || null }, l)));
    return { el: sel, get: () => sel.value };
  }
  const i = h("input", { class: "input", value: current == null ? "" : current, placeholder: includeAny ? "(qualquer valor)" : "" });
  return { el: i, get: () => i.value };
}

function automationEditor(existing) {
  const db = state.db;
  const editable = db.properties.filter((p) => !COMPUTED_PROPS.has(p.type) && !NON_FILTERABLE.has(p.type));
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid("au"), name: "", enabled: true, trigger: { type: "propChanged", propId: editable.find((p) => p.type === "select")?.id || editable[0]?.id, toValue: "" }, actions: [] };

  const nameIn = h("input", { class: "input", value: draft.name || "", placeholder: "Nome da automação" });

  /* ── Gatilho ── */
  const trigWrap = h("div", { class: "auto-field" });
  const paintTrigger = () => {
    trigWrap.innerHTML = "";
    const typeSel = h("select", { class: "input" },
      h("option", { value: "propChanged", selected: draft.trigger.type === "propChanged" || null }, "Quando propriedade mudar"),
      h("option", { value: "rowCreated", selected: draft.trigger.type === "rowCreated" || null }, "Quando criar registro"));
    typeSel.onchange = () => { draft.trigger.type = typeSel.value; paintTrigger(); };
    trigWrap.append(h("div", { class: "auto-label" }, "Gatilho"), typeSel);
    if (draft.trigger.type === "propChanged") {
      const propSel = h("select", { class: "input" });
      editable.forEach((p) => propSel.appendChild(h("option", { value: p.id, selected: p.id === draft.trigger.propId || null }, p.name)));
      const valHolder = h("div", { style: "flex:1" });
      const paintVal = () => {
        const p = editable.find((x) => x.id === propSel.value);
        const ctrl = autoValueControl(p, draft.trigger.toValue, { includeAny: true });
        valHolder.replaceChildren(ctrl.el);
        valHolder._get = ctrl.get;
      };
      propSel.onchange = () => { draft.trigger.propId = propSel.value; draft.trigger.toValue = ""; paintVal(); };
      draft.trigger.propId = draft.trigger.propId || editable[0]?.id;
      paintVal();
      trigWrap.append(h("div", { class: "auto-row" }, propSel, h("span", { class: "auto-arrow" }, "="), valHolder));
      trigWrap._trigGet = () => ({ type: "propChanged", propId: propSel.value, toValue: valHolder._get ? valHolder._get() : "" });
    } else {
      trigWrap._trigGet = () => ({ type: "rowCreated" });
    }
  };
  paintTrigger();

  /* ── Ações ── */
  const actList = h("div", { class: "auto-actions" });
  const paintActions = () => {
    actList.innerHTML = "";
    if (!draft.actions.length) actList.appendChild(h("div", { style: "color:var(--text-faint);font-size:var(--fs-sm)" }, "Sem ações."));
    draft.actions.forEach((ac, idx) => actList.appendChild(actionRow(ac, idx)));
  };
  const actionRow = (ac, idx) => {
    const row = h("div", { class: "auto-row" });
    const typeSel = h("select", { class: "input", style: "width:auto" },
      h("option", { value: "setProp", selected: ac.type === "setProp" || null }, "Definir propriedade"),
      h("option", { value: "notify", selected: ac.type === "notify" || null }, "Notificar"));
    const rest = h("div", { style: "display:flex;gap:6px;flex:1;align-items:center" });
    const paintRest = () => {
      rest.innerHTML = "";
      if (ac.type === "notify") {
        const msg = h("input", { class: "input", value: ac.message || "", placeholder: "Mensagem…" });
        msg.oninput = () => { ac.message = msg.value; };
        rest.appendChild(msg);
      } else {
        const propSel = h("select", { class: "input", style: "width:auto" });
        editable.forEach((p) => propSel.appendChild(h("option", { value: p.id, selected: p.id === ac.propId || null }, p.name)));
        ac.propId = ac.propId || editable[0]?.id;
        const valHolder = h("div", { style: "flex:1" });
        const paintVal = () => {
          const p = editable.find((x) => x.id === propSel.value);
          const ctrl = autoValueControl(p, ac.value, {});
          valHolder.replaceChildren(ctrl.el);
          ac._get = ctrl.get;
        };
        propSel.onchange = () => { ac.propId = propSel.value; ac.value = ""; paintVal(); };
        paintVal();
        rest.append(propSel, h("span", { class: "auto-arrow" }, "="), valHolder);
      }
    };
    typeSel.onchange = () => { ac.type = typeSel.value; paintRest(); };
    paintRest();
    const del = h("button", { class: "icon-btn", title: "Remover ação", onclick: () => { draft.actions.splice(idx, 1); paintActions(); } }, "✕");
    row.append(typeSel, rest, del);
    return row;
  };
  paintActions();
  const addAct = h("button", { class: "btn ghost sm", onclick: () => { draft.actions.push({ type: "setProp", propId: editable[0]?.id, value: "" }); paintActions(); } }, "＋ ação");

  const save = h("button", { class: "btn primary" }, "Salvar");
  const m = showModal({
    title: existing ? "Editar automação" : "Nova automação",
    body: h("div", { style: "display:flex;flex-direction:column;gap:14px" },
      h("div", { class: "auto-field" }, h("div", { class: "auto-label" }, "Nome"), nameIn),
      trigWrap,
      h("div", { class: "auto-field" }, h("div", { class: "auto-label" }, "Ações"), actList, addAct)),
    footer: [h("button", { class: "btn ghost", onclick: () => { m.close(); automationsModal(); } }, "Cancelar"), save],
    width: 620,
  });
  save.onclick = () => {
    // capta valores atuais dos controles antes de fechar
    draft.name = nameIn.value.trim() || "Automação";
    draft.trigger = trigWrap._trigGet ? trigWrap._trigGet() : draft.trigger;
    draft.actions.forEach((ac) => { if (ac.type === "setProp" && ac._get) { ac.value = ac._get(); delete ac._get; } });
    db.automations = db.automations || [];
    if (existing) { const i = db.automations.findIndex((x) => x.id === existing.id); if (i >= 0) db.automations[i] = draft; else db.automations.push(draft); }
    else db.automations.push(draft);
    commit();
    toast(existing ? "Automação atualizada" : "Automação criada");
    m.close(); automationsModal();
  };
}
