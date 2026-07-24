// ═══════════════ NEXUS · Databases: Tabela + Kanban ═══════════════

import {
  getDatabase, updateDatabase, touchDatabase, deleteDatabase, makeRow,
  getSetting, setSetting,
} from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, uid, escapeHtml, fmtDate, flip, download, debounce, todayKey } from "../core/utils.js";
import { showMenu, closeMenus, toast, confirmDialog, promptDialog, emojiPicker } from "../core/ui.js";

const PROP_TYPES = [
  { type: "text", icon: "Aa", name: "Texto" },
  { type: "number", icon: "#", name: "Número" },
  { type: "select", icon: "◉", name: "Select" },
  { type: "multiselect", icon: "≡", name: "Multi-select" },
  { type: "date", icon: "📅", name: "Data" },
  { type: "checkbox", icon: "☑", name: "Checkbox" },
  { type: "url", icon: "🔗", name: "URL" },
  { type: "formula", icon: "∑", name: "Fórmula" },
];
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
    };
    render();
    setupTopbar(db);
  },
  unmount() {
    closeMenus();
    document.getElementById("topbar-actions").innerHTML = "";
    state = null;
  },
};

const commit = () => touchDatabase(state.db.id);
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
    if (p.type === "select") v = p.options?.find((o) => o.id === v)?.name || "";
    if (p.type === "multiselect") v = (v || []).map((id) => p.options?.find((o) => o.id === id)?.name).filter(Boolean).join("; ");
    if (p.type === "checkbox") v = v ? "sim" : "não";
    return `"${String(v ?? "").replace(/"/g, '""')}"`;
  }).join(","));
  download(`${db.name || "database"}.csv`, [header, ...lines].join("\n"), "text/csv");
  toast("CSV exportado");
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

const VIEW_ICON = { table: "▤", kanban: "▥", gallery: "▦", list: "☰", calendar: "📅" };
const VIEW_NAME = { table: "Tabela", kanban: "Kanban", gallery: "Galeria", list: "Lista", calendar: "Calendário" };

function addView(type) {
  const { db } = state;
  const groupBy = type === "kanban" ? db.properties.find((p) => p.type === "select")?.id || null : null;
  const dateProp = type === "calendar" ? db.properties.find((p) => p.type === "date")?.id || null : null;
  const v = { id: uid("v"), name: VIEW_NAME[type] || "View", type, filters: [], sorts: [], groupBy, dateProp };
  db.views.push(v);
  state.viewId = v.id;
  commit(); render();
}

/* ── Filtro simples (uma condição sobre select/checkbox) ── */
function activeFilterLabel() {
  const f = currentView().filters?.[0];
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
  items.push({ icon: "✕", title: "Limpar filtro", action: () => { view.filters = []; commit(); render(); } });
  showMenu(e.currentTarget, items);
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
  if (quickFilter.trim()) {
    const q = quickFilter.toLowerCase();
    rows = rows.filter((r) => db.properties.some((p) => {
      let v = r.values[p.id];
      if (p.type === "select") v = p.options?.find((o) => o.id === v)?.name;
      if (p.type === "multiselect") v = (v || []).map((id) => p.options?.find((o) => o.id === id)?.name).join(" ");
      return String(v ?? "").toLowerCase().includes(q);
    }));
  }
  const sort = view.sorts?.[0];
  if (sort) {
    const p = db.properties.find((x) => x.id === sort.propId);
    if (p) {
      const val = (r) => {
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
  const view = currentView();
  const vp = state.viewportEl;
  vp.innerHTML = "";
  const el = h("div", { class: "db-view-anim" });
  if (view.type === "kanban") renderKanban(el);
  else if (view.type === "gallery") renderGallery(el);
  else if (view.type === "list") renderList(el);
  else if (view.type === "calendar") renderCalendar(el);
  else renderTable(el);
  vp.appendChild(el);
}

/* rótulo curto de uma propriedade para cards (chip/data/texto) */
function propBadge(row, p) {
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
  for (const k in row.values) { const v = row.values[k]; if (typeof v === "string" && v.startsWith("data:image")) return v; }
  return null;
}

/* ═══════════ LISTA ═══════════ */
function renderList(root) {
  const { db } = state;
  const rows = visibleRows();
  if (!rows.length) return emptyView(root, "☰", "Sem itens para exibir.");
  const list = h("div", { class: "db-list card" });
  rows.forEach((row) => {
    const meta = h("div", { class: "dl-meta" });
    db.properties.forEach((p) => { if (p.id !== "title") { const b = propBadge(row, p); if (b) meta.appendChild(b); } });
    const item = h("div", { class: "db-list-item", dataset: { rowId: row.id } },
      h("span", { class: "dl-title" }, row.values.title || "Sem nome"),
      meta,
      h("button", { class: "icon-btn row-menu-btn", "aria-label": "Opções", onclick: (e) => rowMenu(e, row) }, "⋯"));
    item.addEventListener("dblclick", () => editTitle(row));
    list.appendChild(item);
  });
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
  return h("button", { class: "db-newrow", style: "border:1px solid var(--border);border-radius:var(--r-md);margin-top:10px", onclick: () => addRow() },
    h("span", {}, "＋"), h("span", {}, "Novo registro"));
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
  const buildRow = (row) => {
    const tr = h("tr", { dataset: { rowId: row.id } });
    db.properties.forEach((p, pi) => {
      const td = h("td", {});
      td.appendChild(renderCell(row, p, pi === 0));
      tr.appendChild(td);
    });
    tr.appendChild(h("td", { style: "min-width:40px;text-align:center" },
      h("button", {
        class: "icon-btn row-menu-btn", "aria-label": "Opções da linha",
        onclick: (e) => rowMenu(e, row),
      }, "⋯")));
    return tr;
  };

  const tbody = h("tbody", {});
  const groupProp = view.groupBy ? db.properties.find((p) => p.id === view.groupBy) : null;
  if (groupProp) {
    for (const g of groupRows(rows, groupProp)) {
      const headTr = h("tr", { class: "db-group-row" });
      headTr.appendChild(h("td", { colspan: colCount },
        h("div", { class: "db-group-head" },
          g.option ? h("span", { class: chipClass(g.option.color) }, g.option.name) : h("span", { class: "chip" }, "Sem valor"),
          h("span", { class: "db-group-count" }, String(g.rows.length)))));
      tbody.appendChild(headTr);
      g.rows.forEach((row) => tbody.appendChild(buildRow(row)));
    }
  } else {
    rows.forEach((row) => tbody.appendChild(buildRow(row)));
  }

  root.appendChild(h("div", { class: "db-table-wrap" },
    h("table", { class: "db-table" }, h("thead", {}, thead), tbody),
    h("button", { class: "db-newrow", onclick: () => addRow() }, h("span", {}, "＋"), h("span", {}, "Nova linha"))
  ));

  if (!rows.length) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "▦"),
      h("div", { class: "es-desc" }, state.quickFilter || view.filters?.length
        ? "Nada corresponde ao filtro atual."
        : "Sem linhas ainda — clique em “Nova linha”.")));
  }
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
  commit(); renderView();
  return row;
}

function rowMenu(e, row) {
  e.stopPropagation();
  showMenu(e.currentTarget, [
    { icon: "⧉", title: "Duplicar", action: () => {
      const copy = makeRow(state.db, structuredClone(row.values));
      state.db.rows.splice(state.db.rows.indexOf(row) + 1, 0, copy);
      commit(); renderView();
    } },
    { icon: "🗑", title: "Excluir linha", danger: true, action: () => {
      state.db.rows = state.db.rows.filter((r) => r.id !== row.id);
      commit(); renderView();
    } },
  ]);
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
      },
    })),
  ]);
}

/* ── Células por tipo ── */
function renderCell(row, prop, isFirst) {
  const v = row.values[prop.id];
  const cls = "db-cell" + (prop.type === "title" || isFirst ? " cell-title" : "") + (prop.type === "number" ? " cell-number" : "");
  const hasFormula = state.db.properties.some((p) => p.type === "formula");
  const set = (val) => {
    row.values[prop.id] = val; row.updatedAt = Date.now(); commit();
    // fórmulas dependem de outras células → re-renderiza para recalcular
    if (hasFormula && prop.type !== "formula") renderView();
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
    case "formula": {
      const val = evalFormula(prop, row, state.db);
      const cell = h("div", { class: cls + " cell-formula", title: "Fórmula (somente leitura) — edite no menu da coluna" });
      cell.appendChild(val === "" ? h("span", { class: "cell-empty" }, "—") : h("span", {}, val));
      return cell;
    }
    default:
      return h("div", { class: cls }, h("span", { class: "cell-empty" }, "—"));
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
  // whitelist de caracteres e identificadores
  if (!/^[\s0-9.+\-*/%(),<>=!?:"'\]\[a-zA-Z_]*$/.test(expr)) return "⚠";
  const idents = expr.match(/[a-zA-Z_]\w*/g) || [];
  const allowed = new Set(["iff", "round", "abs", "min", "max", "floor", "ceil", "true", "false"]);
  if (idents.some((id) => !allowed.has(id))) return "⚠";
  try {
    const fn = new Function("iff", "round", "abs", "min", "max", "floor", "ceil",
      `"use strict"; return (${expr});`);
    const res = fn((c, a, b) => (c ? a : b), Math.round, Math.abs, Math.min, Math.max, Math.floor, Math.ceil);
    if (typeof res === "number") return Number.isFinite(res) ? (Number.isInteger(res) ? String(res) : res.toFixed(2)) : "⚠";
    return String(res);
  } catch { return "⚠"; }
}

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
      flip(board, () => {
        row.values[groupProp.id] = newVal;
        row.updatedAt = Date.now();
        commit();
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

  const card = h("div", {
    class: "kanban-card", draggable: "true", dataset: { flipId: row.id, rowId: row.id },
  },
    h("div", { class: "kc-title" }, title),
    meta
  );
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/nexus-row", row.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("dblclick", async () => {
    const name = await promptDialog({ title: "Editar cartão", value: row.values.title || "" });
    if (name != null) { row.values.title = name; row.updatedAt = Date.now(); commit(); renderView(); }
  });
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMenu(new DOMRect(e.clientX, e.clientY, 0, 0), [
      { icon: "🗑", title: "Excluir cartão", danger: true, action: () => {
        state.db.rows = state.db.rows.filter((r) => r.id !== row.id);
        commit(); renderView();
      } },
    ]);
  });
  return card;
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
        state.db.rows.push(makeRow(state.db, values));
        commit(); renderView();
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
