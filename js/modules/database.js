// ═══════════════ NEXUS · Databases: Tabela + Kanban ═══════════════

import {
  getDatabase, updateDatabase, touchDatabase, deleteDatabase, makeRow,
  getSetting, setSetting,
} from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, uid, escapeHtml, fmtDate, flip, download, debounce } from "../core/utils.js";
import { showMenu, closeMenus, toast, confirmDialog, promptDialog, emojiPicker } from "../core/ui.js";

const PROP_TYPES = [
  { type: "text", icon: "Aa", name: "Texto" },
  { type: "number", icon: "#", name: "Número" },
  { type: "select", icon: "◉", name: "Select" },
  { type: "multiselect", icon: "≡", name: "Multi-select" },
  { type: "date", icon: "📅", name: "Data" },
  { type: "checkbox", icon: "☑", name: "Checkbox" },
  { type: "url", icon: "🔗", name: "URL" },
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
    }, h("span", {}, v.type === "kanban" ? "▥" : "▤"), h("span", {}, v.name)));
  });
  tabs.appendChild(h("button", {
    class: "db-tab", title: "Nova view",
    onclick: (e) => showMenu(e.currentTarget, [
      { icon: "▤", title: "Tabela", action: () => addView("table") },
      { icon: "▥", title: "Kanban", action: () => addView("kanban") },
    ]),
  }, "＋"));

  const quick = h("input", { class: "db-quicksearch", placeholder: "Filtrar…", value: state.quickFilter });
  quick.addEventListener("input", debounce(() => { state.quickFilter = quick.value; renderView(); }, 150));

  const filterBtn = h("button", { class: "btn ghost sm", onclick: (e) => filterMenu(e) },
    "⛃ Filtrar" + (activeFilterLabel() ? ` · ${activeFilterLabel()}` : ""));

  wrap.appendChild(h("div", { class: "db-toolbar" }, tabs,
    h("div", { class: "db-toolbar-right" }, filterBtn, quick)));

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

function addView(type) {
  const { db } = state;
  const groupBy = type === "kanban" ? db.properties.find((p) => p.type === "select")?.id || null : null;
  const v = { id: uid("v"), name: type === "kanban" ? "Kanban" : "Tabela", type, filters: [], sorts: [], groupBy };
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
  else renderTable(el);
  vp.appendChild(el);
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

  const tbody = h("tbody", {});
  rows.forEach((row) => {
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
    tbody.appendChild(tr);
  });

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
  const set = (val) => { row.values[prop.id] = val; row.updatedAt = Date.now(); commit(); };

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
    default:
      return h("div", { class: cls }, h("span", { class: "cell-empty" }, "—"));
  }
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
