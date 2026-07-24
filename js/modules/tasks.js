// ═══════════════ NEXUS · Tarefas & Projetos (visão agregada) ═══════════════
// Junta prazos das databases (propriedade Data) + checklists das páginas.

import { listPages, listDatabases, getDatabase, touchDatabase, touchPageBlocks, getPage } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, todayKey, stripHtml, fmtDate } from "../core/utils.js";

const DONE_RE = /conclu|feito|done|finaliz|entregue/i;

export default {
  async mount(container) { render(container); },
  unmount() {},
};

function collectTasks() {
  const tasks = [];

  // 1) linhas de database com propriedade de data
  listDatabases().forEach((db) => {
    const dateProp = db.properties.find((p) => p.type === "date");
    const checkProp = db.properties.find((p) => p.type === "checkbox");
    const statusProp = db.properties.find((p) => p.type === "select" && (p.options || []).some((o) => DONE_RE.test(o.name)));
    if (!dateProp && !checkProp && !statusProp) return;
    db.rows.forEach((r) => {
      const date = dateProp ? r.values[dateProp.id] || null : null;
      let done = false;
      if (checkProp) done = !!r.values[checkProp.id];
      else if (statusProp) { const o = statusProp.options.find((o) => o.id === r.values[statusProp.id]); done = o && DONE_RE.test(o.name); }
      tasks.push({
        source: "row", dbId: db.id, rowId: r.id,
        title: r.values.title || "Sem nome", date, done,
        origin: db.name, icon: db.icon || "▦",
      });
    });
  });

  // 2) checklists (blocos todo) das páginas
  listPages().forEach((p) => {
    const walk = (blocks) => blocks.forEach((b) => {
      if (b.type === "todo") {
        const text = stripHtml(b.content || "").trim();
        if (text) tasks.push({ source: "block", pageId: p.id, blockId: b.id, title: text, date: null, done: !!b.props?.checked, origin: p.title || "Sem título", icon: p.icon || "▢" });
      }
      if (b.children?.length) walk(b.children);
    });
    walk(p.blocks || []);
  });

  return tasks;
}

function toggleTask(t) {
  if (t.source === "block") {
    const p = getPage(t.pageId);
    const find = (blocks) => { for (const b of blocks) { if (b.id === t.blockId) return b; if (b.children?.length) { const f = find(b.children); if (f) return f; } } return null; };
    const b = p && find(p.blocks);
    if (b) { b.props = { ...b.props, checked: !b.props?.checked }; touchPageBlocks(p.id); }
  } else {
    const db = getDatabase(t.dbId);
    const row = db?.rows.find((r) => r.id === t.rowId);
    if (!row) return;
    const checkProp = db.properties.find((p) => p.type === "checkbox");
    const statusProp = db.properties.find((p) => p.type === "select" && (p.options || []).some((o) => DONE_RE.test(o.name)));
    if (checkProp) row.values[checkProp.id] = !row.values[checkProp.id];
    else if (statusProp) {
      const doneOpt = statusProp.options.find((o) => DONE_RE.test(o.name));
      const todoOpt = statusProp.options.find((o) => !DONE_RE.test(o.name));
      const cur = statusProp.options.find((o) => o.id === row.values[statusProp.id]);
      row.values[statusProp.id] = (cur && DONE_RE.test(cur.name)) ? (todoOpt?.id || null) : doneOpt.id;
    }
    row.updatedAt = Date.now();
    touchDatabase(db.id);
  }
}

function bucketOf(t) {
  if (!t.date) return "nodate";
  const today = todayKey();
  if (t.date < today) return "overdue";
  if (t.date === today) return "today";
  const d = new Date(today + "T00:00:00");
  const end = new Date(d); end.setDate(d.getDate() + 7);
  if (new Date(t.date + "T00:00:00") <= end) return "week";
  return "later";
}

function render(container) {
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container tasks" });
  wrap.appendChild(h("h1", { class: "home-greeting" }, "Tarefas & Projetos"));

  const all = collectTasks();
  const pending = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done);

  // KPIs
  const overdue = pending.filter((t) => bucketOf(t) === "overdue").length;
  const today = pending.filter((t) => bucketOf(t) === "today").length;
  wrap.appendChild(h("div", { class: "home-stats", style: "margin:8px 0 20px" },
    kpi(pending.length, "pendentes"), kpi(today, "hoje"), kpi(overdue, "atrasadas"), kpi(done.length, "concluídas")));

  if (!all.length) {
    wrap.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "✓"),
      h("div", { class: "es-title" }, "Sem tarefas ainda"),
      h("div", { class: "es-desc" }, "Use checklists nas páginas ou uma database com propriedade de Data e Status — elas aparecem aqui automaticamente.")));
    container.appendChild(wrap);
    return;
  }

  const sections = [
    ["overdue", "⚠ Atrasadas", "danger"],
    ["today", "☀ Hoje", "accent"],
    ["week", "🗓 Esta semana", ""],
    ["later", "📅 Próximas", ""],
    ["nodate", "○ Sem prazo", ""],
  ];
  sections.forEach(([key, label]) => {
    const items = pending.filter((t) => bucketOf(t) === key);
    if (!items.length) return;
    wrap.appendChild(h("div", { class: "task-section-title" + (key === "overdue" ? " overdue" : "") }, label, h("span", { class: "task-count" }, String(items.length))));
    const list = h("div", { class: "task-list" });
    items.sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
    items.forEach((t) => list.appendChild(taskRow(t, container)));
    wrap.appendChild(list);
  });

  if (done.length) {
    const details = h("details", { class: "task-done-wrap" });
    details.appendChild(h("summary", {}, `Concluídas (${done.length})`));
    const list = h("div", { class: "task-list" });
    done.slice(0, 50).forEach((t) => list.appendChild(taskRow(t, container)));
    details.appendChild(list);
    wrap.appendChild(details);
  }

  container.appendChild(wrap);
}

function taskRow(t, container) {
  const check = h("button", {
    class: "todo-check" + (t.done ? " checked" : ""), title: t.done ? "Reabrir" : "Concluir",
    onclick: (e) => { e.stopPropagation(); toggleTask(t); render(container); },
  }, "✓");
  const row = h("div", { class: "task-item" + (t.done ? " done" : "") },
    check,
    h("div", { class: "task-body", onclick: () => t.source === "row" ? navigate("db", t.dbId) : navigate("page", t.pageId) },
      h("div", { class: "task-title" }, t.title),
      h("div", { class: "task-meta" },
        h("span", { class: "task-origin" }, `${t.icon} ${t.origin}`),
        t.date ? h("span", { class: "task-date" + (bucketOf(t) === "overdue" ? " overdue" : "") }, "📅 " + fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" })) : null)));
  return row;
}

function kpi(n, label) {
  return h("div", { class: "home-kpi" }, h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label));
}
