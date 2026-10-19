// ═══════════════ NEXUS · Equipe ═══════════════
// Painel para acompanhar o trabalho do time. Cada pessoa publica um relatório
// (tarefas, prazos, horas, números da semana) cifrado com a senha da equipe;
// aqui eles viram painel, lista consolidada e fechamento da semana.

import { createPage, getSetting, setSetting } from "../core/store.js";
import { markdownToBlocks } from "../core/markdown.js";
import { navigate } from "../core/router.js";
import { bus } from "../core/bus.js";
import { h, fmtRelative, fmtDate, todayKey, download, escapeHtml } from "../core/utils.js";
import { toast, showModal, showMenu, confirmDialog, promptDialog, focusSoon } from "../core/ui.js";
import { fmtDur } from "../core/timetrack.js";
import * as team from "../core/team.js";
import * as ai from "../core/ai.js";

const CHIP = {
  slate: "215 28% 50%", blue: "214 84% 56%", green: "148 55% 46%",
  amber: "36 90% 52%", red: "4 74% 57%", purple: "268 60% 58%", teal: "176 62% 44%",
};
const COLORS = Object.keys(CHIP);
const col = (c) => `hsl(${CHIP[c] || CHIP.slate})`;
const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
const STALE_DAYS = 3;

const TABS = [
  ["painel", "▦", "Painel"],
  ["tarefas", "✓", "Tarefas"],
  ["semana", "🗓", "Semana"],
  ["espaco", "⚙", "Espaço"],
];

let state = null;

export default {
  async mount(container, params) {
    const asked = params?.id;
    state = {
      container,
      tab: TABS.some((t) => t[0] === asked) ? asked : getSetting("teamTab", "painel"),
      filter: "todos",
      busy: false,
      offs: [],
    };
    state.offs.push(bus.on("team:changed", () => { if (state) render(); }));
    render();
    // ao abrir, tenta atualizar em segundo plano (sem travar a tela)
    if (team.teamReady() && team.teamOnline()) refresh({ silent: true });
  },
  unmount() {
    state?.offs.forEach((off) => { try { off?.(); } catch {} });
    state = null;
  },
};

function setTab(tab) {
  state.tab = tab;
  setSetting("teamTab", tab);
  history.replaceState(null, "", "#/team/" + tab);
  render();
}

function render() {
  if (!state) return;
  const { container } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container team-page" });
  const cfg = team.teamConfig();
  // dá para acompanhar o time só com relatórios importados por arquivo,
  // sem entrar em espaço nenhum
  const active = team.teamReady() || Object.keys(team.storedReports()).length > 0;

  wrap.appendChild(h("div", { class: "team-head" },
    h("div", {},
      h("h1", { class: "home-greeting" }, "Equipe"),
      h("p", { class: "team-sub" }, team.teamReady()
        ? `Espaço “${cfg.name || cfg.id}” · você é ${cfg.memberName}`
        : "Acompanhe o trabalho do time sem abrir mão do local-first")),
    team.teamReady()
      ? h("div", { class: "team-head-actions" },
          h("button", { class: "btn ghost sm", onclick: () => refresh(), ...(state.busy ? { disabled: true } : {}) },
            state.busy ? "Atualizando…" : "↻ Atualizar"),
          h("button", { class: "btn primary sm", onclick: () => publishFlow(), ...(state.busy ? { disabled: true } : {}) }, "↑ Publicar o meu"))
      : null));

  if (!active) {
    wrap.appendChild(onboarding());
    container.appendChild(wrap);
    return;
  }

  const tabBar = h("div", { class: "prod-tabs team-tabs" });
  TABS.forEach(([id, icon, label]) => tabBar.appendChild(h("button", {
    class: "prod-tab" + (state.tab === id ? " active" : ""),
    dataset: { teamTab: id },
    onclick: () => setTab(id),
  }, `${icon} ${label}`)));
  wrap.appendChild(tabBar);

  const body = h("div", { class: "prod-body team-body anim-fade" });
  wrap.appendChild(body);
  container.appendChild(wrap);

  if (state.tab === "painel") renderPanel(body);
  else if (state.tab === "tarefas") renderTasks(body);
  else if (state.tab === "semana") renderWeek(body);
  else renderSpace(body);
}

/* ═══════════ onboarding ═══════════ */
function onboarding() {
  const box = h("section", { class: "card team-onboard" });
  box.appendChild(h("h2", {}, "Um espaço de equipe, sem abrir o seu workspace"));
  box.appendChild(h("p", { class: "team-lead" },
    "Cada pessoa continua dona do que escreve. O que circula é um ",
    h("strong", {}, "relatório"),
    " — tarefas, prazos, horas e os números da semana —, cifrado neste aparelho com a senha da equipe antes de sair. O conteúdo das páginas nunca é enviado, e páginas privadas ficam de fora."));

  const steps = h("ol", { class: "team-steps" },
    h("li", {}, h("strong", {}, "Alguém cria o espaço"), " — escolhe um identificador (ex.: ", h("code", {}, "time-produto"), ") e uma senha."),
    h("li", {}, h("strong", {}, "Os outros entram"), " com o mesmo identificador e a mesma senha, cada um com o seu nome."),
    h("li", {}, h("strong", {}, "Pronto"), " — os relatórios aparecem no painel. Quem não quiser usar servidor nenhum pode trocar relatórios por arquivo."));
  box.appendChild(steps);

  box.appendChild(h("div", { class: "team-onboard-actions" },
    h("button", { class: "btn primary", onclick: () => joinModal({ creating: true }) }, "Criar espaço da equipe"),
    h("button", { class: "btn", onclick: () => joinModal({ creating: false }) }, "Entrar num espaço"),
    h("button", { class: "btn ghost", onclick: () => importFlow() }, "⬆ Importar relatório (arquivo)")));

  if (!team.teamOnline()) {
    box.appendChild(h("p", { class: "settings-hint", style: "margin-top:14px" },
      "O espaço online usa o mesmo projeto Supabase da sincronização — configure em Configurações → Conta & Sincronização. Sem isso, dá para trocar relatórios por arquivo normalmente."));
  }
  return box;
}

function joinModal({ creating }) {
  const cfg = team.teamConfig();
  const fId = h("input", { class: "input", value: cfg.id || "", placeholder: "time-produto", spellcheck: "false" });
  const fName = h("input", { class: "input", value: cfg.name || "", placeholder: "Time de Produto" });
  const fPass = h("input", { class: "input", type: "password", placeholder: "senha combinada com a equipe", spellcheck: "false" });
  const fMember = h("input", { class: "input", value: cfg.memberName || "", placeholder: "Seu nome" });
  let color = cfg.color || "blue";
  const sw = h("div", { class: "tb-colors" });
  COLORS.forEach((c) => {
    const b = h("button", { class: "tb-sw" + (c === color ? " on" : ""), style: `background:${col(c)}`, dataset: { color: c } });
    b.onclick = () => { color = c; sw.querySelectorAll(".tb-sw").forEach((x) => x.classList.toggle("on", x.dataset.color === c)); };
    sw.appendChild(b);
  });

  const field = (label, control, hint) =>
    h("label", { class: "fg-field" }, h("span", { class: "fg-label" }, label), control,
      hint ? h("span", { class: "fg-hint" }, hint) : null);

  const ok = h("button", { class: "btn primary" }, creating ? "Criar espaço" : "Entrar");
  const cancel = h("button", { class: "btn ghost" }, "Cancelar");
  const m = showModal({
    title: creating ? "Criar espaço da equipe" : "Entrar num espaço",
    width: 560,
    body: h("div", { class: "form-grid" },
      field("Identificador do espaço", fId, "Todo mundo usa o mesmo. Letras, números e hífen."),
      creating ? field("Nome do time", fName) : null,
      field("Senha da equipe", fPass, "É ela que cifra os relatórios. Fica só neste aparelho — nem a sincronização a leva."),
      h("div", { class: "fg-row" }, field("Seu nome no time", fMember), field("Sua cor", sw))),
    footer: [cancel, ok],
  });
  cancel.onclick = () => m.close();
  ok.onclick = async () => {
    try {
      team.joinTeam({ id: fId.value, pass: fPass.value, memberName: fMember.value, color, teamName: fName.value });
    } catch (e) { toast(String(e.message || e), { type: "danger" }); return; }
    m.close();
    toast(creating ? "Espaço criado — compartilhe o identificador e a senha" : "Você entrou no espaço ✓");
    render();
    if (team.teamOnline()) await refresh({ alsoPublish: true });
  };
  focusSoon(fId);
}

/* ═══════════ rede ═══════════ */
async function refresh({ silent = false, alsoPublish = false } = {}) {
  if (!team.teamOnline()) { if (!silent) toast("Configure a sincronização para usar o espaço online", { type: "warn" }); return; }
  state.busy = true;
  if (!silent) render();
  try {
    if (alsoPublish) await team.publishReport();
    const r = await team.pullReports();
    if (!silent) toast(r.novos ? `${r.novos} relatório(s) atualizados` : "Nada novo por enquanto", { type: "ok" });
  } catch (e) {
    if (!silent) toast(String(e.message || e), { type: "danger", duration: 6000 });
  } finally {
    state.busy = false;
    if (state) render();
  }
}

async function publishFlow() {
  const note = await promptDialog({
    title: "Publicar o meu relatório",
    label: "Quer deixar um recado para o time? (opcional)",
    placeholder: "Ex.: terça e quarta focado na migração",
    confirmText: "Publicar",
  });
  if (note == null) return;
  state.busy = true; render();
  try {
    await team.publishReport({ note });
    toast("Relatório publicado ✓");
  } catch (e) {
    toast(String(e.message || e), { type: "danger", duration: 6000 });
  } finally {
    state.busy = false;
    if (state) render();
  }
}

/* ═══════════ 1 · PAINEL ═══════════ */
function renderPanel(root) {
  const reports = team.allReports();
  const total = reports.reduce((a, r) => ({
    pending: a.pending + (r.counts?.pending || 0),
    overdue: a.overdue + (r.counts?.overdue || 0),
    doneWeek: a.doneWeek + (r.counts?.doneWeek || 0),
    trackedSec: a.trackedSec + (r.counts?.trackedSec || 0),
  }), { pending: 0, overdue: 0, doneWeek: 0, trackedSec: 0 });

  root.appendChild(h("div", { class: "home-stats", style: "margin:4px 0 18px" },
    kpi(String(reports.length), reports.length === 1 ? "pessoa" : "pessoas"),
    kpi(String(total.doneWeek), "entregues na semana"),
    kpi(String(total.overdue), "atrasadas"),
    kpi(fmtDur(total.trackedSec), "registradas")));

  if (reports.length === 1) {
    root.appendChild(h("div", { class: "team-alone" },
      "Só você por aqui ainda. Compartilhe o identificador ", h("code", {}, team.teamConfig().id),
      " e a senha com o time — cada pessoa entra pelo próprio NEXUS."));
  }

  const grid = h("div", { class: "team-grid" });
  reports.forEach((r) => grid.appendChild(memberCard(r)));
  root.appendChild(grid);
}

function memberCard(r) {
  const c = r.counts || {};
  const stale = !r.me && (Date.now() - (r.at || 0)) > STALE_DAYS * 86400000;
  const planned = c.plannedMin || 0;

  const card = h("article", { class: "team-card" + (r.me ? " me" : ""), style: `--c:${col(r.member?.color)}`, dataset: { member: r.member?.id || "" } },
    h("div", { class: "tc-head" },
      h("span", { class: "tc-avatar" }, initials(r.member?.name)),
      h("div", { class: "tc-id" },
        h("div", { class: "tc-name" }, r.member?.name || "Sem nome", r.me ? h("span", { class: "tc-me" }, "você") : null),
        h("div", { class: "tc-when" }, r.me ? "agora" : fmtRelative(r.at || 0))),
      r.me ? null : h("button", { class: "icon-btn", title: "Opções", onclick: (e) => memberMenu(e.currentTarget, r) }, "⋯")),

    h("div", { class: "tc-kpis" },
      miniKpi(c.pending || 0, "pendentes"),
      miniKpi(c.overdue || 0, "atrasadas", (c.overdue || 0) > 0 ? "danger" : ""),
      miniKpi(c.doneWeek || 0, "entregues", (c.doneWeek || 0) > 0 ? "ok" : ""),
      miniKpi(fmtDur(c.trackedSec || 0), "horas")),

    planned || c.blocksTotal
      ? h("div", { class: "tc-plan" },
          h("div", { class: "tc-plan-bar" },
            h("div", { class: "tc-plan-fill", style: `width:${Math.min(100, Math.round(((c.blocksDone || 0) / Math.max(1, c.blocksTotal || 0)) * 100))}%` })),
          h("div", { class: "tc-plan-label" }, `plano da semana: ${c.blocksDone || 0}/${c.blocksTotal || 0} blocos · ${fmtDur(planned * 60)}`))
      : null,

    r.note ? h("div", { class: "tc-note" }, "“" + r.note + "”") : null,

    h("div", { class: "tc-flags" },
      (c.overdue || 0) > 0 ? h("span", { class: "tc-flag danger" }, `⚠ ${c.overdue} atrasada${c.overdue > 1 ? "s" : ""}`) : null,
      stale ? h("span", { class: "tc-flag warn" }, "sem publicar há " + Math.floor((Date.now() - r.at) / 86400000) + " dias") : null,
      r.titlesHidden ? h("span", { class: "tc-flag" }, "títulos ocultos") : null,
      (c.pending || 0) === 0 && (c.doneWeek || 0) > 0 ? h("span", { class: "tc-flag ok" }, "fila limpa ✓") : null));

  const late = (r.tasks || []).filter((t) => t.late).slice(0, 3);
  if (late.length) {
    const list = h("div", { class: "tc-tasks" });
    late.forEach((t) => list.appendChild(h("div", { class: "tc-task late" },
      h("span", { class: "tct-dot" }),
      h("span", { class: "tct-title" }, t.title),
      h("span", { class: "tct-date" }, t.date ? fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" }) : ""))));
    card.appendChild(list);
  }
  return card;
}

function memberMenu(anchor, r) {
  showMenu(anchor, [
    { icon: "✓", title: "Ver as tarefas desta pessoa", action: () => { state.filter = r.member.id; setTab("tarefas"); } },
    { sep: true },
    { icon: "🗑", title: "Remover do painel", danger: true, desc: "Volta se a pessoa publicar de novo", action: () => {
      team.forgetMember(r.member.id);
      toast("Removido do painel");
    } },
  ]);
}

const kpi = (n, label) => h("div", { class: "home-kpi" }, h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, label));
const miniKpi = (n, label, tone = "") => h("div", { class: "tc-kpi " + tone },
  h("div", { class: "tck-num" }, String(n)), h("div", { class: "tck-label" }, label));

/* ═══════════ 2 · TAREFAS CONSOLIDADAS ═══════════ */
function renderTasks(root) {
  const reports = team.allReports();
  const today = todayKey();

  const bar = h("div", { class: "time-bar" },
    h("div", { class: "tb-title" }, "Tarefas de todo mundo"),
    h("div", { class: "tb-actions" },
      h("button", { class: "btn ghost sm" + (state.filter === "todos" ? " active" : ""), onclick: () => { state.filter = "todos"; render(); } }, "Todos"),
      ...reports.map((r) => h("button", {
        class: "btn ghost sm" + (state.filter === r.member.id ? " active" : ""),
        onclick: () => { state.filter = r.member.id; render(); },
      }, r.member.name || "?"))));
  root.appendChild(bar);

  const rows = [];
  reports.forEach((r) => {
    if (state.filter !== "todos" && state.filter !== r.member.id) return;
    (r.tasks || []).forEach((t) => rows.push({ ...t, member: r.member, me: !!r.me }));
  });

  const buckets = [
    ["atrasadas", "⚠ Atrasadas", rows.filter((t) => !t.done && t.date && t.date < today)],
    ["hoje", "☀ Para hoje", rows.filter((t) => !t.done && t.date === today)],
    ["semana", "🗓 Resto da semana", rows.filter((t) => !t.done && t.date && t.date > today)],
    ["semprazo", "○ Sem prazo", rows.filter((t) => !t.done && !t.date)],
    ["feitas", "✓ Entregues nesta semana", rows.filter((t) => t.done)],
  ];

  let any = false;
  buckets.forEach(([key, label, list]) => {
    if (!list.length) return;
    any = true;
    root.appendChild(h("div", { class: "task-section-title" + (key === "atrasadas" ? " overdue" : "") },
      label, h("span", { class: "task-count" }, String(list.length))));
    const box = h("div", { class: "team-task-list" });
    list.sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
    list.forEach((t) => box.appendChild(h("div", { class: "team-task" + (t.done ? " done" : "") },
      h("span", { class: "tt-avatar", style: `--c:${col(t.member?.color)}`, title: t.member?.name }, initials(t.member?.name)),
      h("span", { class: "tt-title" }, t.title),
      t.origin ? h("span", { class: "tt-origin" }, t.origin) : null,
      t.date ? h("span", { class: "tt-date" + (!t.done && t.date < today ? " overdue" : "") },
        fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" })) : null)));
    root.appendChild(box);
  });

  if (!any) {
    root.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "✓"),
      h("div", { class: "es-title" }, "Nenhuma tarefa nos relatórios"),
      h("div", { class: "es-desc" }, "Os relatórios trazem as tarefas com prazo na semana, as atrasadas e as concluídas. Peça para o time publicar — ou publique o seu.")));
  }
}

/* ═══════════ 3 · SEMANA ═══════════ */
function weekSummary() {
  const reports = team.allReports();
  const { from, to } = team.weekRange();
  const today = todayKey();
  const perMember = reports.map((r) => ({
    name: r.member?.name || "Sem nome",
    color: r.member?.color,
    me: !!r.me,
    at: r.at,
    done: (r.tasks || []).filter((t) => t.done),
    // a lista de tarefas é limitada; o total vem dos contadores
    doneCount: r.counts?.doneWeek ?? (r.tasks || []).filter((t) => t.done).length,
    late: (r.tasks || []).filter((t) => !t.done && t.date && t.date < today),
    next: (r.tasks || []).filter((t) => !t.done && t.date && t.date >= today),
    tracked: r.counts?.trackedSec || 0,
    planned: (r.counts?.plannedMin || 0) * 60,
    blocks: [r.counts?.blocksDone || 0, r.counts?.blocksTotal || 0],
    note: r.note || "",
  }));
  return { from, to, perMember };
}

function renderWeek(root) {
  const { from, to, perMember } = weekSummary();

  root.appendChild(h("div", { class: "time-bar" },
    h("div", { class: "tb-title" },
      `Semana de ${fmtDate(from + "T12:00:00", { day: "numeric", month: "short" })} a ${fmtDate(to + "T12:00:00", { day: "numeric", month: "short" })}`),
    h("div", { class: "tb-actions" },
      ai.aiReady() ? h("button", { class: "btn ghost", onclick: () => aiSummary() }, "✳ Resumir com a IA") : null,
      h("button", { class: "btn primary", onclick: () => saveWeekPage() }, "📄 Salvar como página"))));

  if (!perMember.length) {
    root.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon" }, "🗓"),
      h("div", { class: "es-title" }, "Sem relatórios nesta semana")));
    return;
  }

  const grid = h("div", { class: "rev-grid" });
  perMember.forEach((m) => {
    const card = h("section", { class: "rev-card team-week-card", style: `--c:${col(m.color)}` });
    card.appendChild(h("div", { class: "rev-head" },
      h("h3", {}, `${m.name}${m.me ? " (você)" : ""}`),
      h("span", { class: "rev-count" }, String(m.doneCount))));

    const line = (icon, label, value) => h("div", { class: "rev-item" },
      h("span", { class: "ri-icon" }, icon), h("span", { class: "ri-title" }, label), h("span", { class: "ri-meta" }, value));

    const list = h("div", { class: "rev-list" });
    list.appendChild(line("⏱", "Tempo registrado", fmtDur(m.tracked)));
    list.appendChild(line("🗓", "Plano cumprido", `${m.blocks[0]}/${m.blocks[1]} blocos`));
    list.appendChild(line("⚠", "Atrasadas", String(m.late.length)));
    card.appendChild(list);

    if (m.done.length) {
      card.appendChild(h("div", { class: "team-week-sub" }, "Entregou"));
      const dl = h("div", { class: "rev-list" });
      m.done.slice(0, 6).forEach((t) => dl.appendChild(line("✓", t.title, t.date ? fmtDate(t.date + "T12:00:00", { day: "numeric", month: "short" }) : "")));
      card.appendChild(dl);
    }
    if (m.note) card.appendChild(h("div", { class: "tc-note" }, "“" + m.note + "”"));
    grid.appendChild(card);
  });
  root.appendChild(grid);
}

function weekMarkdown() {
  const { from, to, perMember } = weekSummary();
  const L = [];
  L.push(`# Semana da equipe · ${from} a ${to}`);
  const totals = perMember.reduce((a, m) => ({ done: a.done + m.doneCount, late: a.late + m.late.length, tracked: a.tracked + m.tracked }), { done: 0, late: 0, tracked: 0 });
  L.push(`**${perMember.length} pessoas** · ${totals.done} entregas · ${totals.late} atrasadas · ${fmtDur(totals.tracked)} registradas`);
  perMember.forEach((m) => {
    L.push(`## ${m.name}${m.me ? " (você)" : ""}`);
    L.push(`- Tempo registrado: ${fmtDur(m.tracked)} · plano: ${m.blocks[0]}/${m.blocks[1]} blocos`);
    if (m.note) L.push(`- Recado: ${m.note}`);
    if (m.done.length) { L.push("### Entregou"); m.done.forEach((t) => L.push(`- ${t.title}${t.date ? ` (${t.date})` : ""}`)); }
    if (m.late.length) { L.push("### Atrasado"); m.late.forEach((t) => L.push(`- ${t.title}${t.date ? ` (venceu ${t.date})` : ""}`)); }
    if (m.next.length) { L.push("### A seguir"); m.next.slice(0, 8).forEach((t) => L.push(`- ${t.title}${t.date ? ` (${t.date})` : ""}`)); }
  });
  return L.join("\n");
}

function saveWeekPage() {
  const { from, to } = team.weekRange();
  const p = createPage({
    title: `Semana da equipe · ${fmtDate(from + "T12:00:00", { day: "numeric", month: "short" })} – ${fmtDate(to + "T12:00:00", { day: "numeric", month: "short", year: "numeric" })}`,
    icon: "👥",
    blocks: markdownToBlocks(weekMarkdown()),
  });
  toast("Semana da equipe salva como página 📄");
  navigate("page", p.id);
}

async function aiSummary() {
  const out = h("div", { class: "ai-body ai-modal-body" }, h("span", { class: "ai-cursor" }));
  const ctrl = new AbortController();
  const m = showModal({ title: "✳ Resumo da semana da equipe", body: out, width: 620, onClose: () => { try { ctrl.abort(); } catch {} } });
  const { renderMd } = await import("./assistant.js");
  let text = "";
  try {
    text = await ai.chat([{
      role: "user",
      content: "Com base neste relatório consolidado da equipe, escreva um resumo curto para a reunião semanal: o que avançou, onde está o risco e qual a prioridade da próxima semana. Seja específico e direto.\n\n" + ai.clipContext(weekMarkdown()),
    }], {
      system: ai.SYSTEM_PT,
      signal: ctrl.signal,
      onToken: (t) => { text += t; out.innerHTML = renderMd(text) + '<span class="ai-cursor"></span>'; },
    });
    out.innerHTML = renderMd(text);
  } catch (e) {
    if (e?.name !== "AbortError") out.innerHTML = `<p class="ai-err">⚠ ${escapeHtml(String(e.message || e))}</p>`;
  }
}

/* ═══════════ 4 · ESPAÇO ═══════════ */
function renderSpace(root) {
  const cfg = team.teamConfig();
  if (!team.teamReady()) {
    root.appendChild(h("section", { class: "card team-onboard" },
      h("h2", {}, "Você ainda não está num espaço"),
      h("p", { class: "team-lead" }, "O painel está mostrando relatórios importados por arquivo. Para receber as atualizações sozinho, entre num espaço da equipe."),
      h("div", { class: "team-onboard-actions" },
        h("button", { class: "btn primary", onclick: () => joinModal({ creating: true }) }, "Criar espaço"),
        h("button", { class: "btn", onclick: () => joinModal({ creating: false }) }, "Entrar num espaço"),
        h("button", { class: "btn ghost", onclick: () => importFlow() }, "⬆ Importar outro relatório"))));
    return;
  }
  const sec = (title) => {
    const s = h("section", { class: "settings-section card" }, h("h2", { class: "settings-title" }, title));
    root.appendChild(s);
    return s;
  };
  const row = (label, control) => h("div", { class: "settings-row" }, h("span", { class: "settings-label" }, label), control);

  /* identidade */
  const s1 = sec("Você no time");
  const nameInput = h("input", { class: "input", value: cfg.memberName });
  nameInput.addEventListener("change", () => { team.setTeamConfig({ memberName: nameInput.value.trim() || "Eu" }); });
  s1.appendChild(row("Seu nome", nameInput));
  const sw = h("div", { class: "tb-colors" });
  COLORS.forEach((c) => {
    const b = h("button", { class: "tb-sw" + (c === cfg.color ? " on" : ""), style: `background:${col(c)}`, dataset: { color: c } });
    b.onclick = () => { team.setTeamConfig({ color: c }); render(); };
    sw.appendChild(b);
  });
  s1.appendChild(row("Sua cor", sw));

  /* espaço */
  const s2 = sec("Espaço " + (cfg.name || cfg.id));
  s2.appendChild(row("Identificador", h("code", { class: "team-code" }, cfg.id)));
  s2.appendChild(row("Última publicação", h("span", { class: "settings-hint" }, cfg.lastPublish ? fmtRelative(cfg.lastPublish) : "nunca")));
  s2.appendChild(row("Última atualização", h("span", { class: "settings-hint" }, cfg.lastPull ? fmtRelative(cfg.lastPull) : "nunca")));

  const auto = h("button", { class: "switch" + (cfg.autoPublish ? " on" : ""), role: "switch", "aria-checked": String(!!cfg.autoPublish) });
  auto.onclick = async () => {
    team.setTeamConfig({ autoPublish: !cfg.autoPublish });
    team.startAutoTeam();
    render();
  };
  s2.appendChild(row("Publicar automaticamente", auto));
  s2.appendChild(h("p", { class: "settings-hint", style: "margin:-2px 0 12px" },
    "Quando ligado, o NEXUS republica o seu relatório no máximo a cada 5 minutos — e só se algo mudou."));

  /* privacidade */
  const s3 = sec("O que você compartilha");
  const titles = h("button", { class: "switch" + (cfg.shareTitles ? " on" : ""), role: "switch", "aria-checked": String(!!cfg.shareTitles) });
  titles.onclick = () => { team.setTeamConfig({ shareTitles: !cfg.shareTitles }); render(); };
  s3.appendChild(row("Incluir títulos das tarefas", titles));
  s3.appendChild(h("p", { class: "settings-hint", style: "margin:-2px 0 12px" },
    cfg.shareTitles
      ? "Os títulos das tarefas aparecem para o time. O conteúdo das páginas, não — e páginas privadas ficam fora de qualquer jeito."
      : "Só os números saem daqui: quantidade de pendentes, atrasadas, entregues e horas. Os títulos viram “(título oculto)”."));
  s3.appendChild(row("Ver o que seria enviado", h("button", { class: "btn ghost", onclick: () => previewReport() }, "👁 Pré-visualizar")));

  /* troca por arquivo */
  const s4 = sec("Sem servidor: troca por arquivo");
  const fileInput = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const r = team.importReport(await f.text());
      toast(`Relatório de ${r.member.name} importado ✓`);
      render();
    } catch (e) { toast(String(e.message || e), { type: "danger" }); }
  });
  s4.appendChild(row("Relatório", h("div", { class: "btn-row" },
    h("button", { class: "btn", onclick: () => {
      download(`nexus-relatorio-${(cfg.memberName || "eu").toLowerCase().replace(/\s+/g, "-")}-${todayKey()}.json`,
        team.exportReport(), "application/json");
      toast("Relatório exportado");
    } }, "⬇ Exportar o meu"),
    h("button", { class: "btn", onclick: () => fileInput.click() }, "⬆ Importar de alguém"),
    fileInput)));

  /* infraestrutura */
  const s5 = sec("Servidor");
  s5.appendChild(h("p", { class: "settings-hint" },
    team.teamOnline()
      ? "Usa o mesmo projeto Supabase da sincronização. Rode o SQL abaixo uma vez no projeto para criar a tabela dos relatórios."
      : "Configure a URL e a chave do Supabase em Configurações → Conta & Sincronização para habilitar o espaço online."));
  const sql = h("pre", { class: "ai-code team-sql" }, h("code", {}, team.SETUP_SQL));
  s5.appendChild(sql);
  s5.appendChild(row("SQL", h("button", { class: "btn ghost", onclick: () => { navigator.clipboard?.writeText(team.SETUP_SQL); toast("SQL copiado"); } }, "⧉ Copiar SQL")));

  /* sair */
  const s6 = sec("Sair do espaço");
  s6.appendChild(row("Encerrar", h("button", { class: "btn danger", onclick: async () => {
    const ok = await confirmDialog({
      title: "Sair do espaço da equipe?",
      message: "A senha da equipe é apagada deste aparelho e os relatórios recebidos somem do painel. O seu workspace não é afetado.",
      confirmText: "Sair", danger: true,
    });
    if (!ok) return;
    team.leaveTeam();
    team.stopAutoTeam();
    toast("Você saiu do espaço");
    render();
  } }, "Sair do espaço")));
}

function previewReport() {
  const r = team.buildReport();
  const pretty = JSON.stringify(r, null, 2);
  showModal({
    title: "O que sai deste aparelho",
    width: 640,
    body: h("div", {},
      h("p", { class: "settings-hint", style: "margin-bottom:10px" },
        "Exatamente isto, cifrado com a senha da equipe antes de sair. Nenhum conteúdo de página, nenhuma página privada."),
      h("pre", { class: "ai-code", style: "max-height:46vh" }, h("code", {}, pretty))),
  });
}

function importFlow() {
  const input = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    try {
      const r = team.importReport(await f.text());
      toast(`Relatório de ${r.member.name} importado ✓`);
      render();
    } catch (e) { toast(String(e.message || e), { type: "danger" }); }
  });
  input.click();
}
