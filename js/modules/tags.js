// ═══════════════ NEXUS · Tags globais + coleções ═══════════════

import { listPages, pageText, getSetting, setSetting } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, fmtRelative, stripHtml, uid } from "../core/utils.js";
import { toast, promptDialog, confirmDialog, showModal } from "../core/ui.js";

let state = null;

export default {
  async mount(container, params) {
    state = { active: params.id || null, container };
    render();
  },
  unmount() { state = null; },
};

function allTags() {
  const counts = new Map();
  listPages().forEach((p) => (p.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function render() {
  const { container, active } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container tags" });
  wrap.appendChild(h("h1", { class: "home-greeting" }, "Tags & Coleções"));

  // nuvem de tags — sem tags, mostra o convite mas as coleções continuam
  // disponíveis (elas não dependem de tag alguma)
  const tags = allTags();
  if (!tags.length) {
    wrap.appendChild(h("div", { class: "empty-state", style: "padding:24px 0" },
      h("div", { class: "es-icon" }, "🏷"),
      h("div", { class: "es-title" }, "Nenhuma tag ainda"),
      h("div", { class: "es-desc" }, "Adicione tags a uma página (no topo do editor) e elas aparecem aqui, com páginas de tag automáticas.")));
  } else {
    const cloud = h("div", { class: "tag-cloud" });
    const max = Math.max(...tags.map((t) => t[1]));
    tags.forEach(([tag, count]) => {
      cloud.appendChild(h("button", {
        class: "tag-chip" + (tag === active ? " active" : ""),
        style: `font-size:${0.8 + (count / max) * 0.5}rem`,
        onclick: () => navigate("tags", tag),
      }, `#${tag}`, h("span", { class: "tag-count" }, String(count))));
    });
    wrap.appendChild(cloud);
  }

  // coleções inteligentes (as fixas + as que o usuário salvou)
  const head = h("div", { style: "display:flex;align-items:center;gap:10px;margin-top:28px" },
    h("h2", { class: "home-section-title", style: "margin:0;flex:1" }, "Coleções inteligentes"),
    h("button", { class: "btn ghost sm", onclick: () => newCollectionModal() }, "＋ Nova coleção"));
  wrap.appendChild(head);

  const collections = h("div", { class: "home-grid" });
  smartCollections().forEach((c) => {
    collections.appendChild(h("button", { class: "card hoverable home-page-card", onclick: c.run },
      h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, c.icon), h("span", { class: "hp-title" }, c.name)),
      h("div", { class: "hp-meta" }, `${c.count()} páginas`)));
  });
  userCollections().forEach((c) => {
    const card = h("button", { class: "card hoverable home-page-card tpl-card", onclick: () => showFiltered(c.name, c.match) },
      h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, c.icon || "🔎"), h("span", { class: "hp-title" }, c.name)),
      h("div", { class: "hp-meta" }, `${listPages().filter(c.match).length} páginas · ${c.desc}`));
    card.appendChild(h("button", {
      class: "icon-btn tpl-del", title: "Excluir coleção",
      onclick: async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ title: "Excluir coleção?", message: `“${c.name}” será removida. As páginas não são afetadas.`, confirmText: "Excluir", danger: true });
        if (!ok) return;
        setSetting("userCollections", (getSetting("userCollections", []) || []).filter((x) => x.id !== c.id));
        toast("Coleção excluída"); render();
      },
    }, "✕"));
    collections.appendChild(card);
  });
  wrap.appendChild(collections);

  // páginas da tag ativa
  if (active) {
    const pages = listPages().filter((p) => (p.tags || []).includes(active));
    wrap.appendChild(h("h2", { class: "home-section-title", style: "margin-top:28px" }, `Páginas com #${active}`));
    const list = h("div", { class: "home-grid" });
    pages.forEach((p) => {
      const preview = stripHtml((p.blocks || []).map((b) => b.content).join(" ")).slice(0, 80);
      list.appendChild(h("button", { class: "card hoverable home-page-card", onclick: () => navigate("page", p.id) },
        h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, p.icon || "▢"), h("span", { class: "hp-title" }, p.title || "Sem título")),
        h("div", { class: "hp-preview" }, preview || "Documento em branco"),
        h("div", { class: "hp-meta" }, "editado " + fmtRelative(p.updatedAt))));
    });
    wrap.appendChild(list);
  }

  container.appendChild(wrap);
}

/* ── Coleções salvas pelo usuário ──
   Guardam critérios simples (texto, tag, favorita, período) e são reavaliadas
   a cada abertura — por isso "inteligentes": acompanham o workspace. */
function userCollections() {
  return (getSetting("userCollections", []) || []).map((c) => {
    const parts = [];
    if (c.text) parts.push(`contém “${c.text}”`);
    if (c.tag) parts.push(`#${c.tag}`);
    if (c.favorite) parts.push("favoritas");
    if (c.days) parts.push(`últimos ${c.days} dias`);
    const cutoff = c.days ? Date.now() - c.days * 86400000 : null;
    return {
      ...c,
      desc: parts.join(" · ") || "todas",
      match: (p) => {
        if (p.type === "daily" && !c.includeDaily) return false;
        if (c.tag && !(p.tags || []).includes(c.tag)) return false;
        if (c.favorite && !p.favorite) return false;
        if (cutoff && p.updatedAt < cutoff) return false;
        if (c.text) {
          const q = c.text.toLowerCase();
          if (!((p.title || "").toLowerCase().includes(q) || pageText(p).toLowerCase().includes(q))) return false;
        }
        return true;
      },
    };
  });
}

function newCollectionModal() {
  const name = h("input", { class: "input", placeholder: "Ex.: Ideias recentes" });
  const text = h("input", { class: "input", placeholder: "palavra no título ou no conteúdo (opcional)" });
  const tagSel = h("select", { class: "input" }, h("option", { value: "" }, "— qualquer tag —"));
  allTags().forEach(([t]) => tagSel.appendChild(h("option", { value: t }, "#" + t)));
  const fav = h("input", { type: "checkbox" });
  const daysSel = h("select", { class: "input" });
  [["", "qualquer data"], ["7", "últimos 7 dias"], ["30", "últimos 30 dias"], ["90", "últimos 90 dias"]]
    .forEach(([v, l]) => daysSel.appendChild(h("option", { value: v }, l)));

  const preview = h("div", { class: "settings-hint" });
  const build = () => ({
    text: text.value.trim(), tag: tagSel.value, favorite: fav.checked,
    days: daysSel.value ? Number(daysSel.value) : 0,
  });
  const refresh = () => {
    const c = build();
    const cutoff = c.days ? Date.now() - c.days * 86400000 : null;
    const n = listPages().filter((p) => {
      if (p.type === "daily") return false;
      if (c.tag && !(p.tags || []).includes(c.tag)) return false;
      if (c.favorite && !p.favorite) return false;
      if (cutoff && p.updatedAt < cutoff) return false;
      if (c.text) {
        const q = c.text.toLowerCase();
        if (!((p.title || "").toLowerCase().includes(q) || pageText(p).toLowerCase().includes(q))) return false;
      }
      return true;
    }).length;
    preview.textContent = `${n} ${n === 1 ? "página corresponde" : "páginas correspondem"} agora`;
  };
  [text, tagSel, fav, daysSel].forEach((el) => el.addEventListener("input", refresh));
  refresh();

  const save = h("button", { class: "btn primary" }, "Salvar coleção");
  const row = (label, control) => h("div", { class: "settings-row" }, h("span", { class: "settings-label" }, label), control);
  const m = showModal({
    title: "＋ Nova coleção",
    body: h("div", {},
      row("Nome", name), row("Contém o texto", text), row("Tag", tagSel),
      row("Só favoritas", fav), row("Editadas em", daysSel),
      h("div", { style: "margin-top:8px" }, preview)),
    footer: [h("button", { class: "btn ghost", onclick: () => m.close() }, "Cancelar"), save],
    width: 520,
  });
  save.onclick = () => {
    const nm = name.value.trim();
    if (!nm) { toast("Dê um nome à coleção", { type: "warn" }); return; }
    const list = getSetting("userCollections", []) || [];
    list.push({ id: uid("uc"), name: nm, icon: "🔎", ...build() });
    setSetting("userCollections", list);
    m.close(); toast("Coleção salva ✓"); render();
  };
}

function smartCollections() {
  const weekAgo = Date.now() - 7 * 86400000;
  return [
    { icon: "🕒", name: "Modificadas esta semana", count: () => listPages().filter((p) => p.updatedAt >= weekAgo).length,
      run: () => showFiltered("Modificadas esta semana", (p) => p.updatedAt >= weekAgo) },
    { icon: "★", name: "Favoritas", count: () => listPages().filter((p) => p.favorite).length,
      run: () => showFiltered("Favoritas", (p) => p.favorite) },
    { icon: "📄", name: "Sem tags", count: () => listPages().filter((p) => !(p.tags || []).length && p.type !== "daily").length,
      run: () => showFiltered("Sem tags", (p) => !(p.tags || []).length && p.type !== "daily") },
    { icon: "✎", name: "Rascunhos curtos", count: () => listPages().filter((p) => pageText(p).length < 120).length,
      run: () => showFiltered("Rascunhos curtos", (p) => pageText(p).length < 120) },
  ];
}

function showFiltered(title, fn) {
  const { container } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container tags" });
  wrap.appendChild(h("button", { class: "btn ghost sm", style: "margin-bottom:12px", onclick: () => { state.active = null; render(); } }, "‹ Voltar"));
  wrap.appendChild(h("h1", { class: "home-greeting" }, title));
  const pages = listPages().filter(fn);
  const list = h("div", { class: "home-grid", style: "margin-top:16px" });
  if (!pages.length) list.appendChild(h("div", { class: "es-desc" }, "Nenhuma página nesta coleção."));
  pages.forEach((p) => {
    list.appendChild(h("button", { class: "card hoverable home-page-card", onclick: () => navigate("page", p.id) },
      h("div", { class: "hp-head" }, h("span", { class: "hp-icon" }, p.icon || "▢"), h("span", { class: "hp-title" }, p.title || "Sem título")),
      h("div", { class: "hp-meta" }, "editado " + fmtRelative(p.updatedAt))));
  });
  wrap.appendChild(list);
  container.appendChild(wrap);
}
