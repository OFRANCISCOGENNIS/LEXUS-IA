// ═══════════════ NEXUS · Editor de blocos ═══════════════
// Blocos arrastáveis, slash menu, formatação inline, wiki-links,
// backlinks, versões, modo foco. contenteditable por bloco.

import {
  getPage, updatePage, touchPageBlocks, makeBlock, listPages, createPage,
  snapshotPage, listVersions, restoreVersion, backlinksTo, unlinkedMentions,
  pageWordCount, deletePage, duplicatePage, getSetting, setSetting,
  listDatabases, getDatabase, createDatabase, makeRow, touchDatabase,
  pageDescendants,
} from "../core/store.js";
import { bus } from "../core/bus.js";
import { navigate } from "../core/router.js";
import {
  h, uid, debounce, sanitizeInline, stripHtml, escapeHtml, fuzzyScore, flip,
  positionFloating, fmtRelative, fmtDate, readingTime, clamp, isMac,
} from "../core/utils.js";
import { showMenu, closeMenus, toast, showModal, emojiPicker, confirmDialog, promptDialog } from "../core/ui.js";
import { pageToMarkdown } from "../core/markdown.js";
import { hasPin, isUnlocked, setPin, verifyPin } from "../core/privacy.js";

/* ── Definições de blocos para o slash menu ── */
const BLOCK_DEFS = [
  { type: "p", icon: "¶", title: "Texto", desc: "Parágrafo simples", kw: "texto paragrafo text" },
  { type: "h1", icon: "H1", title: "Título 1", desc: "Título grande de seção", kw: "titulo heading h1" },
  { type: "h2", icon: "H2", title: "Título 2", desc: "Subtítulo de seção", kw: "titulo heading h2" },
  { type: "h3", icon: "H3", title: "Título 3", desc: "Título menor", kw: "titulo heading h3" },
  { type: "h4", icon: "H4", title: "Título 4", desc: "Título pequeno", kw: "titulo heading h4" },
  { type: "bulleted", icon: "•", title: "Lista com marcadores", desc: "Lista simples", kw: "lista bullet marcador" },
  { type: "numbered", icon: "1.", title: "Lista numerada", desc: "Lista ordenada", kw: "lista numerada ordenada" },
  { type: "todo", icon: "☑", title: "Checklist", desc: "Tarefa com checkbox", kw: "todo tarefa check" },
  { type: "toggle", icon: "▸", title: "Toggle", desc: "Conteúdo recolhível", kw: "toggle recolher dropdown" },
  { type: "quote", icon: "❝", title: "Citação", desc: "Destaque uma citação", kw: "citacao quote" },
  { type: "callout", icon: "💡", title: "Callout", desc: "Destaque com ícone e cor", kw: "callout destaque aviso" },
  { type: "code", icon: "⌗", title: "Código", desc: "Bloco de código com highlight", kw: "codigo code snippet" },
  { type: "divider", icon: "—", title: "Divisor", desc: "Linha horizontal", kw: "divisor linha separador" },
  { type: "callout", preset: "accent", icon: "ℹ", title: "Callout · Info", desc: "Destaque informativo (azul)", kw: "callout info aviso azul destaque" },
  { type: "callout", preset: "warn", icon: "⚠", title: "Callout · Atenção", desc: "Aviso de atenção (âmbar)", kw: "callout atencao aviso amarelo ambar" },
  { type: "callout", preset: "ok", icon: "✅", title: "Callout · Sucesso", desc: "Destaque de sucesso (verde)", kw: "callout sucesso verde ok" },
  { type: "callout", preset: "danger", icon: "⛔", title: "Callout · Erro", desc: "Destaque de erro (vermelho)", kw: "callout erro perigo vermelho danger" },
  { type: "table", icon: "▦", title: "Tabela", desc: "Tabela simples editável", kw: "tabela table grade planilha" },
  { type: "progress", icon: "▰", title: "Progresso", desc: "Barra de progresso ajustável", kw: "progresso progress barra percentual meta" },
  { type: "button", icon: "⬢", title: "Botão", desc: "Botão que abre página ou link", kw: "botao button link acao clique" },
  { type: "subpage", icon: "⤷", title: "Sub-página", desc: "Cria uma página filha", kw: "subpagina pagina filha nova aninhada" },
  { type: "video", icon: "🎬", title: "Vídeo", desc: "Vídeo local (upload)", kw: "video filme media clipe" },
  { type: "audio", icon: "🎧", title: "Áudio", desc: "Áudio local (upload)", kw: "audio som media musica" },
  { type: "bookmark", icon: "🔖", title: "Bookmark", desc: "Cartão de link para uma URL", kw: "bookmark link favorito url site" },
  { type: "embed", icon: "▣", title: "Embed", desc: "YouTube, Spotify, Maps, Figma, Loom, CodePen…", kw: "embed incorporar youtube spotify mapa maps figma loom codepen video" },
  { type: "equation", icon: "ƒ", title: "Equação", desc: "Fórmula matemática (LaTeX/KaTeX)", kw: "equacao formula matematica latex katex math" },
  { type: "columns", icon: "◫", title: "Colunas", desc: "Duas colunas lado a lado", kw: "colunas columns lado layout duas" },
  { type: "toc", icon: "☰", title: "Sumário", desc: "Índice automático dos títulos", kw: "sumario toc indice tabela conteudo" },
  { type: "chart", icon: "📊", title: "Gráfico", desc: "Barras a partir de uma database", kw: "grafico chart barra kpi dashboard database" },
  { type: "image", icon: "🖼", title: "Imagem", desc: "Envie ou cole uma imagem", kw: "imagem foto image" },
  { type: "dbview", icon: "▦", title: "Database inline", desc: "Embuta uma database viva na página", kw: "database inline tabela linked view embutir base" },
];

const TEXTUAL = new Set(["p", "h1", "h2", "h3", "h4", "bulleted", "numbered", "todo", "quote", "callout", "toggle"]);

/* ── Estado do editor ── */
let state = null; // { page, container, blocksEl, cleanups: [] }

/* ═══════════ Utilidades de caret ═══════════ */
function caretRange() {
  const sel = getSelection();
  return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
}
function isCaretAtStart(el) {
  const r = caretRange();
  if (!r || !r.collapsed) return false;
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length === 0;
}
function isCaretAtEnd(el) {
  const r = caretRange();
  if (!r || !r.collapsed) return false;
  const post = r.cloneRange();
  post.selectNodeContents(el);
  post.setStart(r.endContainer, r.endOffset);
  return post.toString().length === 0;
}
function placeCaret(el, atStart = false) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(atStart);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function textBeforeCaret(el) {
  const r = caretRange();
  if (!r) return "";
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString();
}
function splitAtCaret(el) {
  const r = caretRange();
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(r.endContainer, r.endOffset);
  const frag = after.extractContents();
  const div = document.createElement("div");
  div.appendChild(frag);
  return div.innerHTML;
}

/* ═══════════ Localização de blocos (inclui filhos de toggles) ═══════════ */
function findBlock(id, blocks = state.page.blocks, parent = null) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.id === id) return { block: b, list: blocks, index: i, parent };
    if (b.children?.length) {
      const found = findBlock(id, b.children, b);
      if (found) return found;
    }
  }
  return null;
}

function commit({ structural = false } = {}) {
  recordHistory();
  touchPageBlocks(state.page.id);
  if (structural) renderBlocks();
}

/* ═══════════ Histórico (Desfazer / Refazer — Ctrl+Z / Ctrl+Y) ═══════════ */
function serializeBlocks() { return JSON.stringify(state.page.blocks); }

// registra o estado anterior sempre que os blocos mudam de fato
function recordHistory() {
  if (!state || state._restoring) return;
  const cur = serializeBlocks();
  if (cur === state._committed) return;
  state.undo.push(state._committed);
  if (state.undo.length > 150) state.undo.shift();
  state.redo.length = 0;
  state._committed = cur;
}

function restoreSnapshot(snap) {
  state._restoring = true;
  state.page.blocks = JSON.parse(snap);
  state._committed = snap;
  touchPageBlocks(state.page.id);
  renderBlocks();
  // devolve o foco ao bloco editado, se ainda existir
  if (state._focusId && findBlock(state._focusId)) focusBlock(state._focusId, false);
  state._restoring = false;
}

function undo() {
  if (!state?.undo.length) return;
  state.redo.push(serializeBlocks());
  restoreSnapshot(state.undo.pop());
  toast("Desfeito", { duration: 1000 });
}

function redo() {
  if (!state?.redo.length) return;
  state.undo.push(serializeBlocks());
  restoreSnapshot(state.redo.pop());
  toast("Refeito", { duration: 1000 });
}

/* ═══════════ Render ═══════════ */
export default {
  async mount(container, params) {
    const page = getPage(params.id);
    if (!page) {
      container.innerHTML = `<div class="empty-state"><div class="es-icon">🗂</div>
        <div class="es-title">Página não encontrada</div>
        <div class="es-desc">Ela pode ter sido movida para a lixeira.</div></div>`;
      return;
    }
    // página privada → exige PIN nesta sessão
    if (page.private && !isUnlocked()) {
      renderLockScreen(container, page);
      return;
    }
    state = { page, container, cleanups: [], focusMode: false, undo: [], redo: [], _focusId: null };
    state._committed = serializeBlocks();
    render(container, page);
    setupTopbar(page);
    snapshotPage(page.id);
    const snapTimer = setInterval(() => snapshotPage(page.id), 180000);
    state.cleanups.push(() => clearInterval(snapTimer));

    // Desfazer / Refazer (Ctrl+Z · Ctrl+Y · Ctrl+Shift+Z) — sobrepõe o undo nativo p/ cobrir mudanças estruturais
    const onHistKey = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || !state) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    addEventListener("keydown", onHistKey, true);
    state.cleanups.push(() => removeEventListener("keydown", onHistKey, true));

    // multi-seleção de blocos: teclas globais + limpeza
    addEventListener("keydown", onSelectionKey);
    state.cleanups.push(() => { removeEventListener("keydown", onSelectionKey); clearBlockSelection(); selBar?.remove(); selBar = null; });
  },
  unmount() {
    hideFmtBar();
    closeMenus();
    document.body.classList.remove("focus-mode");
    document.getElementById("topbar-actions").innerHTML = "";
    state?.cleanups.forEach((fn) => fn());
    state = null;
  },
};

function render(container, page) {
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container" + (page.type === "daily" ? " daily-page" : "") });

  // ── Capa (banner) ──
  if (page.cover) wrap.appendChild(renderCover(page));

  // ── Cabeçalho: ícone + título ──
  const head = h("div", { class: "page-head" });
  const iconBtn = h("button", {
    class: "page-icon-btn" + (page.icon ? "" : " empty"),
    onclick: (e) => emojiPicker(e.currentTarget, (emoji) => {
      updatePage(page.id, { icon: emoji });
      iconBtn.textContent = emoji || "☺ Adicionar ícone";
      iconBtn.classList.toggle("empty", !emoji);
    }),
  }, page.icon || "☺ Adicionar ícone");

  const title = h("h1", {
    class: "page-title",
    contenteditable: page.locked ? "false" : "true",
    "data-placeholder": "Sem título",
    spellcheck: "false",
  });
  title.textContent = page.title;
  const saveTitle = debounce(() => updatePage(page.id, { title: title.textContent.trim() }), 350);
  title.addEventListener("input", saveTitle);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const first = state.blocksEl.querySelector(".block-content");
      if (first) placeCaret(first, true);
    }
  });
  title.addEventListener("paste", interceptPlainPaste);

  const meta = h("div", { class: "page-meta" });
  updateMeta(meta, page);

  // ação para adicionar capa (aparece no hover quando ainda não há capa)
  if (!page.cover && !page.locked) {
    const addCover = h("button", { class: "page-add-cover", onclick: () => pickCover(page) }, "🖼 Adicionar capa");
    head.appendChild(addCover);
  }

  head.append(iconBtn, title, meta);
  if (!page.locked) head.appendChild(renderTags(page));
  wrap.appendChild(head);

  // ── Blocos ──
  const blocksEl = h("div", { class: "blocks" });
  state.blocksEl = blocksEl;
  state.metaEl = meta;
  wrap.appendChild(blocksEl);
  renderBlocks();

  // clique abaixo do último bloco → foca/cria parágrafo final
  wrap.addEventListener("click", (e) => {
    if (e.target !== wrap) return;
    const last = page.blocks[page.blocks.length - 1];
    if (!last || !TEXTUAL.has(last.type) || stripHtml(last.content).trim()) {
      page.blocks.push(makeBlock());
      commit({ structural: true });
    }
    const els = blocksEl.querySelectorAll(":scope > .block .block-content");
    const lastEl = els[els.length - 1];
    if (lastEl) placeCaret(lastEl, false);
  });

  // ── Backlinks ──
  const back = backlinksTo(page.id);
  const mentions = unlinkedMentions(page.id);
  if (back.length || mentions.length) {
    const bl = h("div", { class: "backlinks" });
    if (back.length) {
      bl.appendChild(h("div", { class: "backlinks-title" }, `↩ ${back.length} backlink${back.length > 1 ? "s" : ""}`));
      back.forEach((p) => bl.appendChild(h("button", {
        class: "backlink-item", onclick: () => navigate("page", p.id),
      }, h("span", {}, p.icon || "▢"), h("span", {}, p.title || "Sem título"))));
    }
    if (mentions.length) {
      bl.appendChild(h("div", { class: "backlinks-title", style: "margin-top:12px" }, "Menções não linkadas"));
      mentions.forEach((p) => bl.appendChild(h("button", {
        class: "backlink-item", onclick: () => navigate("page", p.id),
      }, h("span", {}, p.icon || "▢"), h("span", {}, p.title || "Sem título"))));
    }
    wrap.appendChild(bl);
  }

  container.appendChild(wrap);

  // seleção → barra de formatação
  const onSelChange = () => scheduleFmtBar();
  document.addEventListener("selectionchange", onSelChange);
  state.cleanups.push(() => document.removeEventListener("selectionchange", onSelChange));
}

function updateMeta(meta, page) {
  const words = pageWordCount(page);
  meta.innerHTML = "";
  meta.append(
    h("span", {}, `${words} palavras`),
    h("span", {}, `${readingTime(words)} min de leitura`),
    h("span", {}, `editado ${fmtRelative(page.updatedAt)}`),
    page.locked ? h("span", { style: "color:var(--warn)" }, "🔒 bloqueada") : ""
  );
}

function renderBlocks() {
  const { blocksEl, page } = state;
  flip(blocksEl, () => {
    blocksEl.innerHTML = "";
    if (!page.blocks.length) page.blocks.push(makeBlock());
    let num = 0;
    for (const b of page.blocks) {
      num = b.type === "numbered" ? num + 1 : 0;
      blocksEl.appendChild(renderBlock(b, { num }));
    }
  });
  paintSelection();
}

/* ═══════════ Multi-seleção de blocos ═══════════
   Esc seleciona o bloco atual; Shift+↑/↓ estende; Shift+clique seleciona a
   faixa; Delete/Backspace exclui, Ctrl+D duplica, Enter volta a editar. */
const blockSel = { ids: new Set(), anchor: null };
let selBar = null;

function clearBlockSelection() {
  if (!blockSel.ids.size) return;
  blockSel.ids.clear(); blockSel.anchor = null;
  paintSelection();
}

function paintSelection() {
  if (!state?.blocksEl) return;
  state.blocksEl.querySelectorAll(".block.selected").forEach((el) => el.classList.remove("selected"));
  blockSel.ids.forEach((id) => {
    state.blocksEl.querySelector(`[data-block-id="${id}"]`)?.classList.add("selected");
  });
  updateSelBar();
}

function selectOnlyBlock(id) {
  blockSel.ids = new Set([id]); blockSel.anchor = id;
  paintSelection();
}

/* estende da âncora até o alvo — apenas entre irmãos da mesma lista */
function extendSelectionTo(id) {
  const a = findBlock(blockSel.anchor || id), b = findBlock(id);
  if (!a || !b || a.list !== b.list) { selectOnlyBlock(id); return; }
  const [i, j] = a.index <= b.index ? [a.index, b.index] : [b.index, a.index];
  blockSel.ids = new Set(a.list.slice(i, j + 1).map((x) => x.id));
  paintSelection();
}

function selectedBlocksSorted() {
  const f = findBlock(blockSel.anchor);
  if (!f) return [];
  return f.list.map((b, i) => ({ b, i })).filter(({ b }) => blockSel.ids.has(b.id));
}

function deleteSelectedBlocks() {
  const f = findBlock(blockSel.anchor);
  if (!f) return;
  const keep = f.list.filter((b) => !blockSel.ids.has(b.id));
  f.list.length = 0; f.list.push(...keep);
  if (!state.page.blocks.length) state.page.blocks.push(makeBlock());
  clearBlockSelection();
  commit({ structural: true });
  toast("Blocos excluídos", { duration: 1200 });
}

function duplicateSelectedBlocks() {
  const items = selectedBlocksSorted();
  if (!items.length) return;
  const f = findBlock(blockSel.anchor);
  const copies = items.map(({ b }) => {
    const c = structuredClone(b); c.id = uid("b");
    (c.children || []).forEach((k) => (k.id = uid("b")));
    return c;
  });
  const after = Math.max(...items.map(({ i }) => i));
  f.list.splice(after + 1, 0, ...copies);
  blockSel.ids = new Set(copies.map((c) => c.id));
  blockSel.anchor = copies[0].id;
  commit({ structural: true });
}

/* move a seleção como bloco único (↑/↓) ou estende com Shift */
function stepSelection(dir, extend) {
  const f = findBlock(blockSel.anchor);
  if (!f) return;
  if (extend) {
    const idxs = f.list.map((b, i) => (blockSel.ids.has(b.id) ? i : -1)).filter((i) => i >= 0);
    const edge = dir > 0 ? Math.max(...idxs) + 1 : Math.min(...idxs) - 1;
    if (edge < 0 || edge >= f.list.length) return;
    extendSelectionTo(f.list[edge].id);
  } else {
    const target = clamp(f.index + dir, 0, f.list.length - 1);
    selectOnlyBlock(f.list[target].id);
  }
  const el = state.blocksEl.querySelector(`[data-block-id="${blockSel.anchor}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

function updateSelBar() {
  const n = blockSel.ids.size;
  if (!n) { selBar?.remove(); selBar = null; return; }
  if (!selBar) {
    selBar = h("div", { class: "sel-bar" },
      h("span", { class: "sel-count" }),
      h("button", { class: "btn ghost sm", onclick: () => duplicateSelectedBlocks() }, "⧉ Duplicar"),
      h("button", { class: "btn ghost sm sel-danger", onclick: () => deleteSelectedBlocks() }, "🗑 Excluir"),
      h("button", { class: "icon-btn", "aria-label": "Limpar seleção", onclick: () => clearBlockSelection() }, "✕"));
    document.getElementById("overlay-root").appendChild(selBar);
  }
  selBar.querySelector(".sel-count").textContent = `${n} ${n === 1 ? "bloco" : "blocos"}`;
}

function onSelectionKey(e) {
  if (!state || !blockSel.ids.size) return;
  if (document.activeElement?.isContentEditable) return; // digitando → seleção não intercepta
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === "Escape") { e.preventDefault(); clearBlockSelection(); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelectedBlocks(); }
  else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelectedBlocks(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); stepSelection(+1, e.shiftKey); }
  else if (e.key === "ArrowUp") { e.preventDefault(); stepSelection(-1, e.shiftKey); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const id = blockSel.anchor;
    clearBlockSelection();
    focusBlock(id, false);
  }
}

function renderBlock(block, { num = 0, inToggle = false } = {}) {
  const el = h("div", {
    class: "block",
    dataset: { blockId: block.id, type: block.type, flipId: block.id },
  });
  if (block.type === "callout") el.dataset.color = block.props?.color || "";
  if (block.type === "todo" && block.props?.checked) el.classList.add("done");

  // Shift+clique: seleciona a faixa entre a âncora e este bloco
  el.addEventListener("click", (e) => {
    if (!e.shiftKey || inToggle) return;
    e.preventDefault();
    getSelection()?.removeAllRanges();
    blockSel.ids.size ? extendSelectionTo(block.id) : selectOnlyBlock(block.id);
  });

  // handle
  if (!state.page.locked && !inToggle) {
    const handle = h("div", { class: "block-handle" },
      h("button", { class: "handle-btn add", title: "Adicionar bloco abaixo", onclick: () => addBlockAfter(block.id) }, "＋"),
      h("button", { class: "handle-btn", title: "Arrastar ou clicar para opções", draggable: "true", onclick: (e) => blockMenu(e, block) }, "⠿")
    );
    setupDrag(handle.lastChild, el, block);
    el.appendChild(handle);
  }

  // prefixos por tipo
  if (block.type === "bulleted") el.appendChild(h("div", { class: "block-prefix" }, "•"));
  if (block.type === "numbered") el.appendChild(h("div", { class: "block-prefix" }, `${num || 1}.`));
  if (block.type === "todo") {
    const check = h("div", {
      class: "todo-check" + (block.props?.checked ? " checked" : ""),
      onclick: () => {
        block.props = { ...block.props, checked: !block.props?.checked };
        check.classList.toggle("checked", block.props.checked);
        el.classList.toggle("done", block.props.checked);
        commit();
      },
    }, "✓");
    el.appendChild(h("div", { class: "block-prefix" }, check));
  }
  if (block.type === "toggle") {
    const open = block.props?.open !== false;
    const arrow = h("div", {
      class: "toggle-arrow" + (open ? " open" : ""),
      onclick: () => {
        block.props = { ...block.props, open: !(block.props?.open !== false) };
        commit({ structural: true });
      },
    }, "▶");
    el.appendChild(h("div", { class: "block-prefix" }, arrow));
  }
  if (block.type === "callout") {
    el.appendChild(h("i", {
      class: "callout-icon",
      onclick: (e) => emojiPicker(e.currentTarget, (emoji) => {
        block.props = { ...block.props, icon: emoji || "💡" };
        e.target.textContent = block.props.icon;
        commit();
      }),
    }, block.props?.icon || "💡"));
  }

  // conteúdo
  if (block.type === "divider") {
    el.appendChild(h("hr"));
    el.tabIndex = -1;
  } else if (block.type === "toc") {
    el.appendChild(renderToc());
    el.tabIndex = -1;
  } else if (block.type === "chart") {
    el.appendChild(renderChart(block));
    el.tabIndex = -1;
  } else if (block.type === "table") {
    el.appendChild(renderTableBlock(block)); el.tabIndex = -1;
  } else if (block.type === "progress") {
    el.appendChild(renderProgress(block)); el.tabIndex = -1;
  } else if (block.type === "button") {
    el.appendChild(renderButton(block)); el.tabIndex = -1;
  } else if (block.type === "subpage") {
    el.appendChild(renderSubpage(block)); el.tabIndex = -1;
  } else if (block.type === "video" || block.type === "audio") {
    el.appendChild(renderMedia(block)); el.tabIndex = -1;
  } else if (block.type === "bookmark") {
    el.appendChild(renderBookmark(block)); el.tabIndex = -1;
  } else if (block.type === "embed") {
    el.appendChild(renderEmbed(block)); el.tabIndex = -1;
  } else if (block.type === "equation") {
    el.appendChild(renderEquation(block)); el.tabIndex = -1;
  } else if (block.type === "columns") {
    el.appendChild(renderColumns(block)); el.tabIndex = -1;
  } else if (block.type === "dbview") {
    el.appendChild(renderDbView(block)); el.tabIndex = -1;
  } else if (block.type === "image") {
    el.appendChild(renderImage(block));
  } else if (block.type === "code") {
    el.appendChild(renderCode(block));
  } else {
    const content = h("div", {
      class: "block-content",
      contenteditable: state.page.locked ? "false" : "true",
      spellcheck: "false",
      "data-placeholder": placeholderFor(block.type),
      html: sanitizeInline(block.content || ""),
    });
    bindContent(content, block);
    el.appendChild(content);
  }

  // filhos do toggle
  if (block.type === "toggle" && block.props?.open !== false) {
    const kids = h("div", { class: "toggle-children" });
    (block.children || []).forEach((c) => kids.appendChild(renderBlock(c, { inToggle: true })));
    if (!block.children?.length) {
      const empty = h("button", {
        class: "btn ghost sm", style: "margin:2px 0;color:var(--text-faint)",
        onclick: () => {
          block.children = [makeBlock()];
          commit({ structural: true });
          focusBlock(block.children[0].id, true);
        },
      }, "Adicionar conteúdo…");
      kids.appendChild(empty);
    }
    // move o conteúdo editável para uma coluna junto com os filhos
    const contentEl = el.querySelector(":scope > .block-content");
    const col = h("div", { style: "flex:1;min-width:0" });
    if (contentEl) col.appendChild(contentEl);
    col.appendChild(kids);
    el.appendChild(col);
  }

  // marcador de comentários (só quando existirem)
  const marker = commentMarker(block);
  if (marker) el.appendChild(marker);

  return el;
}

/* ═══════════ Comentários em blocos ═══════════
   Anotações presas a um bloco (block.props.comments). Ficam no dispositivo
   como todo o resto; servem para revisar textos, deixar lembretes e marcar
   pendências sem sujar o conteúdo. */
const comments = (block) => block.props?.comments || [];
const openComments = (block) => comments(block).filter((c) => !c.resolved);

function commentMarker(block) {
  const all = comments(block);
  if (!all.length) return null;
  const pend = all.filter((c) => !c.resolved).length;
  return h("button", {
    class: "comment-marker" + (pend ? "" : " resolved"),
    title: pend ? `${pend} comentário${pend > 1 ? "s" : ""} em aberto` : "Comentários resolvidos",
    onclick: (e) => { e.stopPropagation(); commentPopover(e.currentTarget, block); },
  }, "💬", pend ? h("span", { class: "cm-count" }, String(pend)) : null);
}

function commentPopover(anchor, block) {
  closeMenus();
  block.props = block.props || {};
  block.props.comments = block.props.comments || [];

  const panel = h("div", { class: "comment-panel", role: "dialog", "aria-label": "Comentários do bloco" });
  const list = h("div", { class: "comment-list" });
  const input = h("textarea", { class: "textarea comment-input", rows: 2, placeholder: "Escreva um comentário…" });

  const close = () => { panel.remove(); removeEventListener("keydown", onKey, true); removeEventListener("pointerdown", onOutside, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  const onOutside = (e) => { if (!panel.contains(e.target) && e.target !== anchor) close(); };

  const persist = () => {
    // sem comentários → limpa a chave para não inchar o documento
    if (!block.props.comments.length) delete block.props.comments;
    commit({ structural: true });
  };

  const paint = () => {
    list.innerHTML = "";
    const all = comments(block);
    if (!all.length) {
      list.appendChild(h("div", { class: "comment-empty" }, "Nenhum comentário ainda."));
      return;
    }
    all.forEach((c) => {
      const item = h("div", { class: "comment-item" + (c.resolved ? " resolved" : "") },
        h("div", { class: "comment-text" }, c.text),
        h("div", { class: "comment-foot" },
          h("span", { class: "comment-time" }, fmtRelative(c.at)),
          h("button", {
            class: "comment-act", title: c.resolved ? "Reabrir" : "Marcar como resolvido",
            onclick: () => { c.resolved = !c.resolved; persist(); paint(); },
          }, c.resolved ? "↩ reabrir" : "✓ resolver"),
          h("button", {
            class: "comment-act danger", title: "Excluir comentário",
            onclick: () => {
              block.props.comments = block.props.comments.filter((x) => x.id !== c.id);
              persist();
              if (!comments(block).length) { close(); return; }
              paint();
            },
          }, "excluir")));
      list.appendChild(item);
    });
  };

  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    block.props.comments.push({ id: uid("c"), text, at: Date.now(), resolved: false });
    input.value = "";
    persist();
    paint();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // não deixa o editor interpretar as teclas
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  paint();
  panel.append(
    h("div", { class: "comment-head" }, h("span", {}, "💬 Comentários"),
      h("button", { class: "icon-btn", "aria-label": "Fechar", onclick: close }, "✕")),
    list,
    h("div", { class: "comment-compose" }, input,
      h("button", { class: "btn primary sm", onclick: add }, "Comentar")));

  document.getElementById("overlay-root").appendChild(panel);
  positionFloating(panel, anchor.getBoundingClientRect(), { gap: 8, align: "right" });
  addEventListener("keydown", onKey, true);
  setTimeout(() => addEventListener("pointerdown", onOutside, true), 0);
  setTimeout(() => input.focus(), 30);
}

function placeholderFor(type) {
  return {
    p: "Escreva algo ou digite “/” para blocos…",
    h1: "Título 1", h2: "Título 2", h3: "Título 3", h4: "Título 4",
    bulleted: "Item", numbered: "Item", todo: "Tarefa",
    quote: "Citação", callout: "Destaque algo importante", toggle: "Toggle",
  }[type] || "";
}

/* ═══════════ Conteúdo editável ═══════════ */
function bindContent(content, block) {
  const save = debounce(() => {
    block.content = sanitizeInline(content.innerHTML);
    recordHistory();
    touchPageBlocks(state.page.id);
    if (state.metaEl) updateMeta(state.metaEl, state.page);
  }, 400);

  content.addEventListener("focus", () => { if (state) state._focusId = block.id; });
  content.addEventListener("input", () => {
    block.content = content.innerHTML;
    save();
    maybeSlashMenu(content, block);
    maybeWikiLink(content, block);
    maybeMention(content, block);
    maybeMarkdownShortcut(content, block);
  });

  content.addEventListener("keydown", (e) => onBlockKeydown(e, content, block));
  content.addEventListener("paste", (e) => onPaste(e, content, block));
  content.addEventListener("click", (e) => {
    const link = e.target.closest(".wiki-link, .mention-page");
    if (link) {
      e.preventDefault();
      const id = link.dataset.pageId;
      if (id && getPage(id)) navigate("page", id);
      else toast("Página não encontrada", { type: "warn" });
    }
  });
}

function onBlockKeydown(e, content, block) {
  if (slashState.open || wikiState.open || mentionState.open) {
    if (["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) return; // menus tratam
  }

  // Esc dentro do bloco → sai da edição e seleciona o bloco (modo seleção)
  if (e.key === "Escape" && !state.focusMode) {
    e.preventDefault();
    e.stopPropagation(); // sem isto, o mesmo Esc chega ao listener global e desfaz a seleção
    content.blur();
    selectOnlyBlock(block.id);
    return;
  }

  const found = findBlock(block.id);
  if (!found) return;
  const { list, index, parent } = found;

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    // sair de lista vazia → parágrafo
    if (["bulleted", "numbered", "todo"].includes(block.type) && !stripHtml(content.innerHTML).trim()) {
      block.type = "p";
      commit({ structural: true });
      focusBlock(block.id, true);
      return;
    }
    const afterHtml = splitAtCaret(content);
    block.content = sanitizeInline(content.innerHTML);
    const keepType = ["bulleted", "numbered", "todo"].includes(block.type) ? block.type : "p";
    const nb = makeBlock(keepType, sanitizeInline(afterHtml));
    if (block.type === "todo") nb.props = {};
    list.splice(index + 1, 0, nb);
    commit({ structural: true });
    focusBlock(nb.id, true);
  }
  else if (e.key === "Backspace" && isCaretAtStart(content)) {
    e.preventDefault();
    if (block.type !== "p" && TEXTUAL.has(block.type)) {
      // primeiro backspace: volta a parágrafo
      block.type = "p";
      block.props = {};
      commit({ structural: true });
      focusBlock(block.id, true);
      return;
    }
    if (index === 0 && !parent) {
      if (list.length === 1 && !stripHtml(block.content).trim() && state.page.blocks.length === 1) return;
      return;
    }
    const prev = list[index - 1];
    if (!prev) {
      // filho de toggle na primeira posição → promove para fora
      if (parent) {
        const pFound = findBlock(parent.id);
        list.splice(index, 1);
        pFound.list.splice(pFound.index + 1, 0, block);
        commit({ structural: true });
        focusBlock(block.id, true);
      }
      return;
    }
    if (!TEXTUAL.has(prev.type)) {
      // remove bloco vazio sobre divisor/imagem
      if (!stripHtml(block.content).trim()) {
        list.splice(index, 1);
        commit({ structural: true });
        const target = list[index - 1] || list[index];
        if (target) focusBlock(target.id, false);
      }
      return;
    }
    // merge com o anterior
    const prevLen = stripHtml(prev.content).length;
    prev.content = sanitizeInline(prev.content + block.content);
    list.splice(index, 1);
    commit({ structural: true });
    const el = state.blocksEl.querySelector(`[data-block-id="${prev.id}"] .block-content`);
    if (el) placeCaretAtTextOffset(el, prevLen);
  }
  else if (e.key === "ArrowUp" && isCaretAtStart(content)) {
    e.preventDefault();
    focusAdjacent(block.id, -1);
  }
  else if (e.key === "ArrowDown" && isCaretAtEnd(content)) {
    e.preventDefault();
    focusAdjacent(block.id, +1);
  }
  else if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      if (parent) {
        const pFound = findBlock(parent.id);
        list.splice(index, 1);
        pFound.list.splice(pFound.index + 1, 0, block);
        commit({ structural: true });
        focusBlock(block.id, true);
      }
      return;
    }
    // indenta para dentro de toggle anterior
    const prev = list[index - 1];
    if (prev?.type === "toggle") {
      prev.children = prev.children || [];
      prev.children.push(block);
      list.splice(index, 1);
      prev.props = { ...prev.props, open: true };
      commit({ structural: true });
      focusBlock(block.id, true);
    }
  }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && !e.shiftKey) {
    e.preventDefault();
    const copy = structuredClone(block);
    copy.id = uid("b");
    (copy.children || []).forEach((c) => (c.id = uid("b")));
    list.splice(index + 1, 0, copy);
    commit({ structural: true });
  }
  else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowUp") {
    e.preventDefault();
    if (index > 0) { [list[index - 1], list[index]] = [list[index], list[index - 1]]; commit({ structural: true }); focusBlock(block.id, false); }
  }
  else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowDown") {
    e.preventDefault();
    if (index < list.length - 1) { [list[index + 1], list[index]] = [list[index], list[index + 1]]; commit({ structural: true }); focusBlock(block.id, false); }
  }
}

function placeCaretAtTextOffset(el, offset) {
  el.focus();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, count = 0;
  while ((node = walker.nextNode())) {
    if (count + node.length >= offset) {
      const r = document.createRange();
      r.setStart(node, offset - count);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      return;
    }
    count += node.length;
  }
  placeCaret(el, false);
}

function flatTextualIds() {
  const ids = [];
  const walk = (blocks) => blocks.forEach((b) => {
    if (TEXTUAL.has(b.type) || b.type === "code") ids.push(b.id);
    if (b.type === "toggle" && b.props?.open !== false && b.children?.length) walk(b.children);
  });
  walk(state.page.blocks);
  return ids;
}

function focusAdjacent(id, dir) {
  const ids = flatTextualIds();
  const i = ids.indexOf(id);
  const next = ids[i + dir];
  if (next) focusBlock(next, dir < 0 ? false : true);
  else if (dir < 0) document.querySelector(".page-title")?.focus();
}

function focusBlock(id, atStart = true) {
  const el = state?.blocksEl?.querySelector(`[data-block-id="${id}"] .block-content`);
  if (el) placeCaret(el, atStart);
}

function addBlockAfter(id) {
  const found = findBlock(id);
  if (!found) return;
  const nb = makeBlock();
  found.list.splice(found.index + 1, 0, nb);
  commit({ structural: true });
  focusBlock(nb.id, true);
  setTimeout(() => {
    const el = state.blocksEl.querySelector(`[data-block-id="${nb.id}"] .block-content`);
    if (el) openSlashMenu(el, nb, true);
  }, 30);
}

/* ═══════════ Colar ═══════════ */
function interceptPlainPaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  document.execCommand("insertText", false, text.replace(/\n/g, " "));
}

function onPaste(e, content, block) {
  const items = [...(e.clipboardData?.items || [])];
  const img = items.find((i) => i.type.startsWith("image/"));
  if (img) {
    e.preventDefault();
    const file = img.getAsFile();
    insertImageBlock(block, file);
    return;
  }
  const text = e.clipboardData.getData("text/plain");
  if (!text) return;
  e.preventDefault();
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length <= 1 || block.type === "code") {
    document.execCommand("insertText", false, block.type === "code" ? text : lines.join(" "));
    return;
  }
  // multi-linha → vira múltiplos blocos
  const found = findBlock(block.id);
  document.execCommand("insertText", false, lines[0]);
  block.content = sanitizeInline(content.innerHTML);
  const newBlocks = lines.slice(1).map((l) => {
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) return makeBlock("h" + m[1].length, escapeHtml(m[2]));
    if ((m = l.match(/^[-*]\s+\[( |x)\]\s+(.*)/i))) return makeBlock("todo", escapeHtml(m[2]), { checked: m[1].toLowerCase() === "x" });
    if ((m = l.match(/^[-*]\s+(.*)/))) return makeBlock("bulleted", escapeHtml(m[1]));
    if ((m = l.match(/^\d+[.)]\s+(.*)/))) return makeBlock("numbered", escapeHtml(m[1]));
    if ((m = l.match(/^>\s?(.*)/))) return makeBlock("quote", escapeHtml(m[1]));
    return makeBlock("p", escapeHtml(l));
  });
  found.list.splice(found.index + 1, 0, ...newBlocks);
  commit({ structural: true });
  const last = newBlocks[newBlocks.length - 1];
  focusBlock(last.id, false);
}

/* ═══════════ Tela de bloqueio (PIN) ═══════════ */
function renderLockScreen(container, page) {
  container.innerHTML = "";
  const input = h("input", { class: "input", type: "password", inputmode: "numeric",
    placeholder: "PIN", style: "text-align:center;letter-spacing:6px;font-size:1.3rem;max-width:200px" });
  const msg = h("div", { style: "color:var(--danger);font-size:var(--fs-xs);height:16px" });
  const btn = h("button", { class: "btn primary" }, "Desbloquear");
  const box = h("div", { class: "lock-screen" },
    h("div", { class: "lock-icon" }, "🔒"),
    h("div", { class: "lock-title" }, page.title || "Página privada"),
    h("div", { class: "lock-desc" }, "Digite seu PIN local para ver esta página."),
    input, msg, btn);
  container.appendChild(box);
  const tryUnlock = async () => {
    if (await verifyPin(input.value)) { navigate("page", page.id); }
    else { msg.textContent = "PIN incorreto"; input.value = ""; input.focus(); }
  };
  btn.onclick = tryUnlock;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  setTimeout(() => input.focus(), 60);
}

async function togglePrivate(page) {
  if (!page.private) {
    if (!hasPin()) {
      const pin = await promptDialog({ title: "Criar PIN", label: "Defina um PIN local (só neste dispositivo):", placeholder: "ex.: 1234" });
      if (!pin) return;
      await setPin(pin);
      toast("PIN criado 🔐");
    }
    updatePage(page.id, { private: true });
    toast("Página agora é privada");
  } else {
    updatePage(page.id, { private: false });
    toast("Privacidade removida");
  }
  navigate("page", page.id);
}

/* ═══════════ Tags da página ═══════════ */
function renderTags(page) {
  const row = h("div", { class: "page-tags" });
  const paint = () => {
    row.innerHTML = "";
    (page.tags || []).forEach((t) => {
      row.appendChild(h("span", { class: "page-tag" },
        h("span", { onclick: () => navigate("tags", t), style: "cursor:pointer" }, "#" + t),
        h("button", { class: "pt-remove", title: "Remover", onclick: () => { page.tags = page.tags.filter((x) => x !== t); updatePage(page.id, { tags: page.tags }); paint(); } }, "×")));
    });
    const addBtn = h("button", { class: "page-tag-add" }, "＋ tag");
    addBtn.onclick = () => {
      const input = h("input", { class: "page-tag-input", placeholder: "tag…" });
      row.replaceChild(input, addBtn);
      input.focus();
      const done = (save) => {
        const val = input.value.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase();
        if (save && val && !(page.tags || []).includes(val)) {
          page.tags = [...(page.tags || []), val];
          updatePage(page.id, { tags: page.tags });
        }
        paint();
      };
      input.onkeydown = (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
      input.onblur = () => done(true);
    };
    row.appendChild(addBtn);
  };
  paint();
  return row;
}

/* ═══════════ Capa (banner) ═══════════ */
function renderCover(page) {
  const el = h("div", { class: "page-cover" },
    h("img", { src: page.cover, alt: "" }),
    page.locked ? null : h("div", { class: "cover-actions" },
      h("button", { class: "btn sm", onclick: () => pickCover(page) }, "Trocar"),
      h("button", { class: "btn sm ghost", onclick: () => { updatePage(page.id, { cover: "" }); navigate("page", page.id); } }, "Remover"))
  );
  return el;
}
function pickCover(page) {
  const input = h("input", { type: "file", accept: "image/*", style: "display:none" });
  input.addEventListener("change", () => {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { updatePage(page.id, { cover: reader.result }); navigate("page", page.id); };
    reader.readAsDataURL(f);
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 1000);
}

/* ═══════════ Sumário automático (TOC) ═══════════ */
function renderToc() {
  const el = h("div", { class: "block-toc" });
  const build = () => {
    el.innerHTML = "";
    const headings = state.page.blocks.filter((b) => ["h1", "h2", "h3", "h4"].includes(b.type) && stripHtml(b.content).trim());
    if (!headings.length) { el.appendChild(h("div", { class: "toc-empty" }, "Sem títulos ainda — adicione H1–H4 para montar o sumário.")); return; }
    headings.forEach((b) => {
      el.appendChild(h("button", {
        class: "toc-link toc-" + b.type,
        onclick: () => {
          const target = state.blocksEl.querySelector(`[data-block-id="${b.id}"]`);
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.querySelector(".block-content") && placeCaret(target.querySelector(".block-content"), true);
        },
      }, stripHtml(b.content)));
    });
  };
  build();
  el.rebuild = build;
  return el;
}

/* ═══════════ Bloco de gráfico (a partir de uma database) ═══════════ */
function renderChart(block) {
  const wrap = h("div", { class: "block-chart", style: "flex:1;min-width:0" });
  const cfg = block.props || {};
  const db = cfg.dbId ? getDatabase(cfg.dbId) : null;
  const prop = db?.properties.find((p) => p.id === cfg.propId && p.type === "select");

  const configBar = h("div", { class: "chart-config" });
  const dbSel = h("select", { class: "input", style: "width:auto" });
  dbSel.appendChild(h("option", { value: "" }, "— database —"));
  listDatabases().forEach((d) => dbSel.appendChild(h("option", { value: d.id, selected: d.id === cfg.dbId || null }, d.name)));
  const propSel = h("select", { class: "input", style: "width:auto" });
  const fillProps = (d) => {
    propSel.innerHTML = "";
    propSel.appendChild(h("option", { value: "" }, "— agrupar por —"));
    (d?.properties || []).filter((p) => p.type === "select").forEach((p) => propSel.appendChild(h("option", { value: p.id, selected: p.id === cfg.propId || null }, p.name)));
  };
  fillProps(db);
  dbSel.onchange = () => { block.props = { ...block.props, dbId: dbSel.value, propId: "" }; commit({ structural: true }); };
  propSel.onchange = () => { block.props = { ...block.props, propId: propSel.value }; commit({ structural: true }); };
  const kindBtn = h("button", { class: "btn ghost sm", title: "Tipo",
    onclick: () => { block.props = { ...block.props, kind: (cfg.kind === "pie" ? "bar" : "pie") }; commit({ structural: true }); } },
    cfg.kind === "pie" ? "◔ Pizza" : "▮ Barras");
  configBar.append(dbSel, propSel, kindBtn);
  wrap.appendChild(configBar);

  if (!db || !prop) {
    wrap.appendChild(h("div", { class: "chart-empty" }, "Escolha uma database e uma propriedade Select para montar o gráfico."));
    return wrap;
  }

  // conta linhas por opção
  const counts = (prop.options || []).map((o) => ({ o, n: db.rows.filter((r) => r.values[prop.id] === o.id).length }));
  const none = db.rows.filter((r) => !prop.options.some((o) => o.id === r.values[prop.id])).length;
  if (none) counts.push({ o: { name: "Sem valor", color: "gray" }, n: none });
  const total = counts.reduce((a, b) => a + b.n, 0) || 1;

  wrap.appendChild(h("div", { class: "chart-title" }, `${db.name} · por ${prop.name} (${total})`));
  if (cfg.kind === "pie") wrap.appendChild(pieChart(counts, total));
  else wrap.appendChild(barChart(counts, total));
  return wrap;
}

const CHART_HSL = { gray: "215 12% 55%", slate: "215 28% 50%", blue: "214 84% 56%", green: "148 55% 46%", amber: "36 90% 52%", red: "4 74% 57%", purple: "268 60% 58%", teal: "176 62% 44%" };
const colHsl = (c) => `hsl(${CHART_HSL[c] || CHART_HSL.gray})`;

function barChart(counts, total) {
  const max = Math.max(...counts.map((c) => c.n), 1);
  const rows = h("div", { class: "chart-bars" });
  counts.forEach(({ o, n }) => {
    rows.appendChild(h("div", { class: "cb-row" },
      h("div", { class: "cb-label" }, o.name),
      h("div", { class: "cb-track" }, h("div", { class: "cb-fill", style: `width:${(n / max) * 100}%;background:${colHsl(o.color)}` })),
      h("div", { class: "cb-val" }, String(n))));
  });
  return rows;
}
function pieChart(counts, total) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 42 42"); svg.setAttribute("class", "chart-pie");
  let acc = 0;
  counts.filter((c) => c.n).forEach(({ o, n }) => {
    const frac = n / total;
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "21"); c.setAttribute("cy", "21"); c.setAttribute("r", "15.915");
    c.setAttribute("fill", "none"); c.setAttribute("stroke", colHsl(o.color)); c.setAttribute("stroke-width", "8");
    c.setAttribute("stroke-dasharray", `${(frac * 100).toFixed(2)} ${(100 - frac * 100).toFixed(2)}`);
    c.setAttribute("stroke-dashoffset", String(25 - acc * 100));
    svg.appendChild(c);
    acc += frac;
  });
  const legend = h("div", { class: "chart-legend" });
  counts.filter((c) => c.n).forEach(({ o, n }) => legend.appendChild(
    h("span", { class: "cl-item" }, h("span", { class: "cl-dot", style: `background:${colHsl(o.color)}` }), `${o.name} · ${n}`)));
  return h("div", { class: "chart-pie-wrap" }, svg, legend);
}

/* ═══════════ Tabela inline ═══════════ */
function renderTableBlock(block) {
  block.props = block.props || {};
  const data = block.props.data || (block.props.data = [["", ""], ["", ""]]);
  const wrap = h("div", { class: "block-tableblock", style: "flex:1;min-width:0" });
  const table = h("table", { class: "inline-table" });
  data.forEach((row, ri) => {
    const tr = h("tr", {});
    row.forEach((cell, ci) => {
      const td = h("td", {});
      const c = h("div", { class: "it-cell", contenteditable: state.page.locked ? "false" : "true", html: sanitizeInline(cell || "") });
      if (ri === 0) c.classList.add("it-head");
      c.addEventListener("input", debounce(() => { data[ri][ci] = sanitizeInline(c.innerHTML); touchPageBlocks(state.page.id); }, 400));
      td.appendChild(c); tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  if (!state.page.locked) {
    wrap.appendChild(h("div", { class: "it-actions" },
      h("button", { class: "btn ghost sm", onclick: () => { data.forEach((r) => r.push("")); commit({ structural: true }); } }, "＋ coluna"),
      h("button", { class: "btn ghost sm", onclick: () => { data.push(new Array(data[0].length).fill("")); commit({ structural: true }); } }, "＋ linha"),
      h("button", { class: "btn ghost sm", onclick: () => { if (data[0].length > 1) { data.forEach((r) => r.pop()); commit({ structural: true }); } } }, "− coluna"),
      h("button", { class: "btn ghost sm", onclick: () => { if (data.length > 1) { data.pop(); commit({ structural: true }); } } }, "− linha")));
  }
  return wrap;
}

/* ═══════════ Barra de progresso ═══════════ */
function renderProgress(block) {
  block.props = block.props || { value: 40 };
  const wrap = h("div", { class: "block-progress", style: "flex:1;min-width:0" });
  const label = h("div", { class: "prog-label", contenteditable: state.page.locked ? "false" : "true", "data-placeholder": "Rótulo…", html: sanitizeInline(block.props.label || "") });
  label.addEventListener("input", debounce(() => { block.props.label = sanitizeInline(label.innerHTML); touchPageBlocks(state.page.id); }, 400));
  const pct = h("span", { class: "prog-pct" }, (block.props.value || 0) + "%");
  const range = h("input", { type: "range", min: "0", max: "100", value: String(block.props.value || 0), class: "prog-range", disabled: state.page.locked ? "" : null });
  const fill = h("div", { class: "prog-fill", style: `width:${block.props.value || 0}%` });
  range.addEventListener("input", () => { block.props.value = +range.value; pct.textContent = range.value + "%"; fill.style.width = range.value + "%"; });
  range.addEventListener("change", () => touchPageBlocks(state.page.id));
  wrap.append(
    h("div", { class: "prog-head" }, label, pct),
    h("div", { class: "prog-track" }, fill),
    state.page.locked ? null : range);
  return wrap;
}

/* ═══════════ Botão ═══════════ */
function renderButton(block) {
  block.props = block.props || {};
  const a = block.props.action || (block.props.action = { type: "url", target: "" });
  const btn = h("button", { class: "block-button" }, block.props.label || "Botão");
  btn.onclick = () => {
    if (a.type === "page" && a.target) navigate("page", a.target);
    else if (a.type === "url" && a.target) open(/^https?:/i.test(a.target) ? a.target : "https://" + a.target, "_blank");
    else if (!state.page.locked) configBtn();
  };
  const cog = state.page.locked ? null : h("button", { class: "icon-btn block-button-cfg", "aria-label": "Configurar", onclick: (e) => { e.stopPropagation(); configBtn(e.currentTarget); } }, "⚙");
  function configBtn(anchor) {
    showMenu(anchor || btn, [
      { icon: "✎", title: "Editar rótulo", action: async () => { const l = await promptDialog({ title: "Rótulo do botão", value: block.props.label || "" }); if (l != null) { block.props.label = l; commit({ structural: true }); } } },
      { icon: "🔗", title: "Abrir uma URL", action: async () => { const u = await promptDialog({ title: "URL", value: a.type === "url" ? a.target : "" }); if (u != null) { block.props.action = { type: "url", target: u }; commit({ structural: true }); } } },
      { icon: "📄", title: "Abrir uma página", action: () => pickPageForButton(block) },
    ]);
  }
  return h("div", { class: "block-button-wrap", style: "flex:1;min-width:0" }, btn, cog);
}
function pickPageForButton(block) {
  const items = listPages().filter((p) => p.id !== state.page.id).slice(0, 20).map((p) => ({
    icon: p.icon || "▢", title: p.title || "Sem título",
    action: () => { block.props.action = { type: "page", target: p.id }; commit({ structural: true }); },
  }));
  showMenu(state.blocksEl.querySelector(`[data-block-id="${block.id}"] .block-button`), items.length ? items : [{ title: "Nenhuma outra página" }]);
}

/* ═══════════ Sub-página ═══════════ */
function renderSubpage(block) {
  const child = block.props?.pageId ? getPage(block.props.pageId) : null;
  if (!child) return h("div", { class: "block-subpage broken" }, "⤷ Sub-página removida");
  return h("button", { class: "block-subpage", style: "flex:1;min-width:0", onclick: () => navigate("page", child.id) },
    h("span", { class: "sp-icon" }, child.icon || "📄"),
    h("span", { class: "sp-title" }, child.title || "Sem título"),
    h("span", { class: "sp-arrow" }, "›"));
}

/* ═══════════ Database inline (view viva dentro da página) ═══════════ */
function renderDbView(block) {
  const wrap = h("div", { class: "block-dbview", contenteditable: "false", style: "flex:1;min-width:0" });
  const db = block.props?.dbId ? getDatabase(block.props.dbId) : null;

  if (!db) {
    wrap.appendChild(h("button", {
      class: "dbv-pick",
      onclick: (e) => {
        const dbs = listDatabases();
        showMenu(e.currentTarget, [
          { label: "Embutir database" },
          ...dbs.map((d) => ({ icon: d.icon || "▦", title: d.name, action: () => { block.props = { dbId: d.id }; commit({ structural: true }); } })),
          { sep: true },
          { icon: "＋", title: "Criar nova database", action: () => {
            const nd = createDatabase({ name: "Nova database" });
            block.props = { dbId: nd.id };
            commit({ structural: true });
          } },
        ]);
      },
    }, "▦ Escolher database…"));
    return wrap;
  }

  const commitDb = () => touchDatabase(db.id);
  wrap.appendChild(h("div", { class: "dbv-head" },
    h("button", { class: "dbv-title", onclick: () => navigate("db", db.id) }, (db.icon || "▦") + " " + db.name),
    h("span", { class: "dbv-count" }, `${db.rows.length} ${db.rows.length === 1 ? "item" : "itens"}`),
    h("button", { class: "btn ghost sm", onclick: () => navigate("db", db.id) }, "↗ Abrir")));

  const props = db.properties.slice(0, 5);
  const table = h("table", { class: "dbv-table" });
  const trh = h("tr", {});
  props.forEach((p) => trh.appendChild(h("th", {}, p.name)));
  table.appendChild(h("thead", {}, trh));
  const tbody = h("tbody", {});
  const MAX = 50;
  db.rows.slice(0, MAX).forEach((row) => {
    const tr = h("tr", {});
    props.forEach((p, pi) => tr.appendChild(h("td", {}, dbvCell(db, row, p, pi === 0, commitDb))));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(h("div", { class: "dbv-scroll" }, table));
  if (db.rows.length > MAX) {
    wrap.appendChild(h("button", { class: "dbv-more", onclick: () => navigate("db", db.id) },
      `… mais ${db.rows.length - MAX} — abrir a database completa`));
  }

  if (!state.page.locked) {
    const input = h("input", { class: "dbv-add", placeholder: "＋ Novo item — Enter para adicionar" });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && input.value.trim()) {
        db.rows.push(makeRow(db, { title: input.value.trim() }));
        commitDb();
        commit({ structural: true });
      }
      if (e.key === "Escape") input.blur();
    });
    wrap.appendChild(input);
  }
  return wrap;
}

function dbvCell(db, row, p, isTitle, commitDb) {
  const v = row.values[p.id];
  if (isTitle || p.type === "title") {
    const c = h("div", { class: "dbv-cell-title", contenteditable: "true", spellcheck: "false" });
    c.textContent = row.values.title || "";
    c.addEventListener("blur", () => {
      const t = c.textContent.trim();
      if (t !== (row.values.title || "")) { row.values.title = t; row.updatedAt = Date.now(); commitDb(); }
    });
    c.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); c.blur(); } });
    return c;
  }
  if (p.type === "select") {
    const o = p.options?.find((x) => x.id === v);
    return h("button", {
      class: o ? `chip c-${o.color || "gray"}` : "dbv-empty",
      onclick: (e) => {
        e.stopPropagation();
        showMenu(e.currentTarget, (p.options || []).map((op) => ({
          icon: "◉", title: op.name,
          action: () => { row.values[p.id] = op.id; row.updatedAt = Date.now(); commitDb(); commit({ structural: true }); },
        })));
      },
    }, o ? o.name : "—");
  }
  if (p.type === "checkbox") {
    const c = h("div", {
      class: "todo-check" + (v ? " checked" : ""),
      onclick: () => { row.values[p.id] = !row.values[p.id]; row.updatedAt = Date.now(); commitDb(); c.classList.toggle("checked", row.values[p.id]); },
    }, "✓");
    return c;
  }
  if (p.type === "date") return h("span", { class: v ? "chip" : "dbv-empty" }, v ? "📅 " + fmtDate(v + "T12:00:00", { day: "numeric", month: "short" }) : "—");
  if (p.type === "created" || p.type === "updated")
    return h("span", { class: "chip" }, fmtDate(p.type === "created" ? row.createdAt : row.updatedAt, { day: "numeric", month: "short" }));
  if (p.type === "number") return h("span", {}, v != null && v !== "" ? Number(v).toLocaleString("pt-BR") : "—");
  return h("span", { class: v ? "" : "dbv-empty" }, v ? String(v).slice(0, 42) : "—");
}

/* ═══════════ Vídeo / Áudio local ═══════════ */
function renderMedia(block) {
  if (block.props?.src) {
    const el = block.type === "video"
      ? h("video", { src: block.props.src, controls: "", style: "width:100%;border-radius:var(--r-md)" })
      : h("audio", { src: block.props.src, controls: "", style: "width:100%" });
    return h("div", { class: "block-media", style: "flex:1;min-width:0" }, el);
  }
  return h("div", { class: "image-placeholder", style: "flex:1;min-width:0", onclick: () => pickMedia(block, block.type) },
    h("span", {}, block.type === "video" ? "🎬" : "🎧"),
    h("span", {}, `Clique para enviar um ${block.type === "video" ? "vídeo" : "áudio"} (fica no dispositivo)`));
}
function pickMedia(block, kind) {
  const input = h("input", { type: "file", accept: kind + "/*", style: "display:none" });
  input.addEventListener("change", () => {
    const f = input.files[0]; if (!f) return;
    if (f.size > 40 * 1024 * 1024) { toast("Arquivo grande demais (máx. 40MB para guardar localmente)", { type: "warn" }); return; }
    const reader = new FileReader();
    reader.onload = () => { block.props = { ...block.props, src: reader.result }; commit({ structural: true }); };
    reader.readAsDataURL(f);
  });
  document.body.appendChild(input); input.click(); setTimeout(() => input.remove(), 1000);
}

/* ═══════════ Bookmark ═══════════ */
function renderBookmark(block) {
  const url = block.props?.url;
  if (!url) {
    return h("div", { class: "image-placeholder", style: "flex:1;min-width:0", onclick: async () => {
      const u = await promptDialog({ title: "URL do bookmark", placeholder: "https://…" });
      if (u) { block.props = { ...block.props, url: u }; commit({ structural: true }); }
    } }, h("span", {}, "🔖"), h("span", {}, "Clique para colar um link"));
  }
  let host = url; try { host = new URL(/^https?:/i.test(url) ? url : "https://" + url).host; } catch {}
  return h("a", { class: "block-bookmark card hoverable", href: /^https?:/i.test(url) ? url : "https://" + url, target: "_blank", rel: "noopener", style: "flex:1;min-width:0" },
    h("span", { class: "bm-favicon" }, "🔖"),
    h("div", { class: "bm-body" },
      h("div", { class: "bm-host" }, host),
      h("div", { class: "bm-url" }, url)));
}

/* ═══════════ Embed (YouTube, Spotify, Maps, Figma, Loom, CodePen…) ═══════════ */
function embedSrc(raw) {
  let url = raw.trim();
  if (!/^https?:/i.test(url)) url = "https://" + url;
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  try {
    if (/youtube\.com$/.test(host) || host === "youtu.be") {
      const id = host === "youtu.be" ? u.pathname.slice(1) : (u.searchParams.get("v") || u.pathname.split("/").pop());
      return { src: "https://www.youtube.com/embed/" + id, ratio: "16/9" };
    }
    if (/spotify\.com$/.test(host)) return { src: "https://open.spotify.com/embed" + u.pathname, ratio: "16/9" };
    if (/loom\.com$/.test(host)) return { src: url.replace("/share/", "/embed/"), ratio: "16/9" };
    if (/codepen\.io$/.test(host)) return { src: url.replace("/pen/", "/embed/"), ratio: "16/10" };
    if (/figma\.com$/.test(host)) return { src: "https://www.figma.com/embed?embed_host=nexus&url=" + encodeURIComponent(url), ratio: "16/10" };
    if (/(google\.[a-z.]+|maps\.google)/.test(host) && /maps/.test(url)) {
      const q = u.searchParams.get("q") || decodeURIComponent((u.pathname.match(/\/place\/([^/]+)/) || [])[1] || "");
      return { src: "https://maps.google.com/maps?q=" + encodeURIComponent(q || url) + "&output=embed", ratio: "16/9" };
    }
  } catch {}
  return { src: url, ratio: "16/9" }; // genérico (pode ser bloqueado pelo site)
}
function renderEmbed(block) {
  const url = block.props?.url;
  if (!url) {
    return h("div", { class: "image-placeholder", style: "flex:1;min-width:0", onclick: async () => {
      const u = await promptDialog({ title: "Colar link para incorporar", placeholder: "YouTube, Spotify, Maps, Figma, Loom, CodePen…" });
      if (u) { block.props = { ...block.props, url: u }; commit({ structural: true }); }
    } }, h("span", {}, "▣"), h("span", {}, "Clique para colar um link (YouTube, Spotify, Maps, Figma…)"));
  }
  const info = embedSrc(url);
  const frame = h("iframe", {
    src: info.src, loading: "lazy", allow: "fullscreen; picture-in-picture; clipboard-write; encrypted-media",
    allowfullscreen: "", referrerpolicy: "no-referrer",
    style: `aspect-ratio:${info.ratio};width:100%;border:0`,
  });
  const bar = state.page.locked ? null : h("div", { class: "embed-bar" },
    h("a", { href: /^https?:/i.test(url) ? url : "https://" + url, target: "_blank", rel: "noopener", class: "embed-open" }, "abrir original ↗"),
    h("button", { class: "btn ghost sm", onclick: async () => { const u = await promptDialog({ title: "Trocar link", value: url }); if (u != null) { block.props.url = u; commit({ structural: true }); } } }, "trocar"));
  return h("div", { class: "block-embed", style: "flex:1;min-width:0" }, h("div", { class: "embed-frame" }, frame), bar);
}

/* ═══════════ Equação (KaTeX carregado sob demanda) ═══════════ */
let _katex = null;
function loadKatex() {
  if (_katex) return _katex;
  _katex = new Promise((resolve, reject) => {
    if (window.katex) return resolve(window.katex);
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    document.head.appendChild(link);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    s.onload = () => resolve(window.katex); s.onerror = reject;
    document.head.appendChild(s);
  });
  return _katex;
}
function renderEquation(block) {
  block.props = block.props || { latex: "" };
  const wrap = h("div", { class: "block-equation", style: "flex:1;min-width:0" });
  const display = h("div", { class: "eq-display" });
  const paint = () => {
    const src = block.props.latex || "";
    if (!src.trim()) { display.innerHTML = '<span class="eq-empty">Clique para escrever LaTeX — ex.: e^{i\\pi}+1=0</span>'; return; }
    loadKatex().then((k) => { try { k.render(src, display, { displayMode: true, throwOnError: false }); } catch { display.textContent = "⚠ LaTeX inválido"; } })
      .catch(() => { display.textContent = src; });
  };
  if (!state.page.locked) {
    display.onclick = () => {
      if (wrap.querySelector("textarea")) return;
      const ta = h("textarea", { class: "eq-input", rows: 2, placeholder: "\\frac{a}{b}, \\sum_{i=0}^n, \\sqrt{x}…" });
      ta.value = block.props.latex || "";
      const done = () => { block.props.latex = ta.value; touchPageBlocks(state.page.id); ta.replaceWith(display); paint(); };
      ta.addEventListener("blur", done);
      ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); ta.blur(); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ta.blur(); });
      display.replaceWith(ta); ta.focus();
    };
  }
  wrap.appendChild(display);
  paint();
  return wrap;
}

/* ═══════════ Colunas ═══════════ */
function renderColumns(block) {
  if (!block.children?.length) block.children = [{ id: uid("b"), type: "column", props: {}, children: [makeBlock()] }, { id: uid("b"), type: "column", props: {}, children: [makeBlock()] }];
  const grid = h("div", { class: "block-columns", style: `grid-template-columns:repeat(${block.children.length},1fr)` });
  block.children.forEach((colBlk) => {
    if (!colBlk.children) colBlk.children = [makeBlock()];
    const col = h("div", { class: "editor-column" });
    colBlk.children.forEach((child) => col.appendChild(renderBlock(child, { inToggle: true })));
    if (!state.page.locked) {
      col.appendChild(h("button", { class: "col-add", onclick: () => {
        colBlk.children.push(makeBlock());
        commit({ structural: true });
        focusBlock(colBlk.children[colBlk.children.length - 1].id, true);
      } }, "＋ bloco"));
    }
    grid.appendChild(col);
  });
  const holder = h("div", { style: "flex:1;min-width:0" }, grid);
  if (!state.page.locked && block.children.length < 4) {
    holder.appendChild(h("button", { class: "col-addcol", onclick: () => {
      block.children.push({ id: uid("b"), type: "column", props: {}, children: [makeBlock()] });
      commit({ structural: true });
    } }, "＋ coluna"));
  }
  return holder;
}

/* ═══════════ Imagens ═══════════ */
function renderImage(block) {
  if (block.props?.src) {
    return h("div", { class: "block-image" }, h("img", { src: block.props.src, alt: "" }));
  }
  const input = h("input", { type: "file", accept: "image/*", style: "display:none" });
  input.addEventListener("change", () => {
    if (input.files[0]) setImageFromFile(block, input.files[0]);
  });
  return h("div", {},
    h("div", { class: "image-placeholder", onclick: () => input.click() },
      h("span", {}, "🖼"), h("span", {}, "Clique para enviar uma imagem (ou cole com Ctrl+V)")),
    input
  );
}

function setImageFromFile(block, file) {
  const reader = new FileReader();
  reader.onload = () => {
    block.props = { ...block.props, src: reader.result };
    commit({ structural: true });
  };
  reader.readAsDataURL(file);
}

function insertImageBlock(afterBlock, file) {
  const found = findBlock(afterBlock.id);
  const nb = makeBlock("image", "");
  found.list.splice(found.index + 1, 0, nb);
  setImageFromFile(nb, file);
}

/* ═══════════ Código ═══════════ */
const LANGS = ["javascript", "typescript", "python", "html", "css", "json", "bash", "sql", "rust", "go", "texto"];
function renderCode(block) {
  const content = h("div", {
    class: "block-content",
    contenteditable: state.page.locked ? "false" : "true",
    spellcheck: "false",
    "data-placeholder": "// código…",
  });
  content.textContent = block.content || "";

  const langBtn = h("button", { class: "code-lang" }, (block.props?.lang || "texto") + " ▾");
  langBtn.onclick = (e) => showMenu(e.currentTarget, LANGS.map((l) => ({
    title: l,
    action: () => { block.props = { ...block.props, lang: l }; langBtn.textContent = l + " ▾"; highlight(); commit(); },
  })));

  const copyBtn = h("button", {
    class: "icon-btn code-copy", title: "Copiar código",
    onclick: () => { navigator.clipboard.writeText(block.content || ""); toast("Código copiado"); },
  }, "⧉");

  const save = debounce(() => { commit(); }, 500);
  content.addEventListener("input", () => { block.content = content.textContent; save(); });
  content.addEventListener("focus", () => { content.textContent = block.content || ""; });
  content.addEventListener("blur", highlight);
  content.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
    if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertText", false, "\n"); }
    if (e.key === "Backspace" && !content.textContent) {
      e.preventDefault();
      const found = findBlock(block.id);
      found.list.splice(found.index, 1);
      if (!found.list.length) found.list.push(makeBlock());
      commit({ structural: true });
    }
  });
  content.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });

  function highlight() {
    const code = block.content || "";
    content.innerHTML = highlightCode(code, block.props?.lang);
  }
  highlight();

  return h("div", { class: "code-wrap", style: "flex:1;min-width:0" },
    h("div", { class: "code-head" }, langBtn, copyBtn),
    content
  );
}

const KEYWORDS = /\b(function|const|let|var|return|if|else|for|while|class|import|export|from|def|async|await|new|try|catch|throw|switch|case|break|continue|typeof|instanceof|in|of|not|and|or|is|None|True|False|null|undefined|true|false|print|lambda|self|this|pass|elif|with|as|yield|struct|fn|pub|impl|use|mut|match)\b/g;
export function highlightCode(code, lang) {
  let out = escapeHtml(code);
  out = out.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[^`]*`)/g, '<span class="tok-str">$1</span>');
  out = out.replace(/(\/\/[^\n<]*|#(?![0-9a-fA-F]{3})[^\n<]*)/g, '<span class="tok-com">$1</span>');
  out = out.replace(KEYWORDS, '<span class="tok-kw">$1</span>');
  out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
  out = out.replace(/\b([a-zA-Z_]\w*)(?=\()/g, '<span class="tok-fn">$1</span>');
  return out;
}

/* ═══════════ Slash menu ═══════════ */
const slashState = { open: false, menu: null, block: null, contentEl: null, query: "" };

function maybeSlashMenu(content, block) {
  const before = textBeforeCaret(content);
  const m = before.match(/(?:^|\s)\/([^\s/]*)$/); // aceita acentos e outros caracteres
  if (m) {
    slashState.query = m[1];
    if (!slashState.open) openSlashMenu(content, block);
    else refreshSlashMenu();
  } else if (slashState.open) {
    closeSlash();
  }
}

function openSlashMenu(content, block, empty = false) {
  closeSlash();
  slashState.open = true;
  slashState.block = block;
  slashState.contentEl = content;
  if (empty) slashState.query = "";
  const menu = h("div", { class: "menu", role: "menu", style: "min-width:280px" });
  slashState.menu = menu;
  document.getElementById("overlay-root").appendChild(menu);
  refreshSlashMenu();

  const r = caretRange();
  const rect = r ? r.getBoundingClientRect() : content.getBoundingClientRect();
  positionFloating(menu, rect.width || rect.height ? rect : content.getBoundingClientRect(), { gap: 8 });

  const onKey = (e) => {
    if (!slashState.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSlash(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveSlashSel(+1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSlashSel(-1); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      menu.querySelector(".menu-item.selected")?.click();
    }
  };
  addEventListener("keydown", onKey, true);
  slashState.offKey = () => removeEventListener("keydown", onKey, true);
  const onOutside = (ev) => { if (!menu.contains(ev.target)) closeSlash(); };
  setTimeout(() => addEventListener("pointerdown", onOutside, true), 0);
  slashState.offOutside = () => removeEventListener("pointerdown", onOutside, true);
}

function refreshSlashMenu() {
  const { menu, query } = slashState;
  if (!menu) return;
  const scored = BLOCK_DEFS
    .map((d) => ({ d, s: query ? Math.max(fuzzyScore(query, d.title), fuzzyScore(query, d.kw)) : 0 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  menu.innerHTML = "";
  menu.appendChild(h("div", { class: "menu-label" }, "Blocos"));
  scored.forEach(({ d }, i) => {
    menu.appendChild(h("button", {
      class: "menu-item" + (i === 0 ? " selected" : ""),
      style: `animation-delay:${Math.min(i * 20, 140)}ms`,
      onclick: () => applySlash(d),
      onmousemove: (e) => {
        if (e.currentTarget.classList.contains("selected")) return;
        menu.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("selected"));
        e.currentTarget.classList.add("selected");
      },
    },
      h("i", { class: "mi-icon" }, d.icon),
      h("div", { class: "mi-body" },
        h("div", { class: "mi-title" }, d.title),
        h("div", { class: "mi-desc" }, d.desc)),
    ));
  });
  if (!scored.length) menu.appendChild(h("div", { class: "palette-empty" }, "Nenhum bloco encontrado"));
}

function moveSlashSel(dir) {
  const items = [...slashState.menu.querySelectorAll(".menu-item")];
  const cur = items.findIndex((x) => x.classList.contains("selected"));
  const next = clamp(cur + dir, 0, items.length - 1);
  items.forEach((x, i) => x.classList.toggle("selected", i === next));
  items[next]?.scrollIntoView({ block: "nearest" });
}

function applySlash(def) {
  const { block, contentEl } = slashState;
  // remove o texto "/query" digitado
  const text = contentEl.innerHTML.replace(/\/[^\s/]*(\s|&nbsp;)?$/, "");
  block.content = sanitizeInline(text);
  block.type = def.type;
  if (def.type === "callout") block.props = { icon: def.preset === "warn" ? "⚠" : def.preset === "ok" ? "✅" : def.preset === "danger" ? "⛔" : def.preset === "accent" ? "ℹ" : "💡", color: def.preset || "", ...block.props };
  if (def.type === "code") block.props = { lang: "javascript", ...block.props };
  if (def.type === "table") block.props = { data: [["", "", ""], ["", "", ""]] };
  if (def.type === "progress") block.props = { value: 40, label: "" };
  if (def.type === "button") block.props = { label: "Clique aqui", action: { type: "url", target: "" } };
  if (def.type === "bookmark") block.props = { url: "" };
  if (def.type === "embed") block.props = { url: "" };
  if (def.type === "equation") block.props = { latex: "" };
  if (def.type === "dbview") block.props = {};
  if (def.type === "columns") { block.children = [{ id: uid("b"), type: "column", props: {}, children: [makeBlock()] }, { id: uid("b"), type: "column", props: {}, children: [makeBlock()] }]; }
  if (def.type === "subpage") {
    const child = createPage({ title: "Sub-página", parentId: state.page.id });
    block.props = { pageId: child.id };
  }
  closeSlash();

  // blocos não-textuais ganham um parágrafo em branco logo abaixo, para o fluxo continuar
  const NEEDS_TRAILING = new Set(["table", "progress", "button", "subpage", "bookmark", "chart", "toc", "divider", "image", "video", "audio", "embed", "equation", "columns", "dbview"]);
  let trailingId = null;
  if (NEEDS_TRAILING.has(def.type)) {
    const found = findBlock(block.id);
    if (found) {
      const next = found.list[found.index + 1];
      if (!next || next.type !== "p" || stripHtml(next.content).trim()) {
        const nb = makeBlock();
        found.list.splice(found.index + 1, 0, nb);
        trailingId = nb.id;
      } else trailingId = next.id;
    }
  }

  commit({ structural: true });
  if (TEXTUAL.has(def.type)) focusBlock(block.id, false);
  else if (def.type === "code") {
    const el = state.blocksEl.querySelector(`[data-block-id="${block.id}"] .block-content`);
    if (el) { el.textContent = block.content ? stripHtml(block.content) : ""; placeCaret(el, false); }
  } else if (trailingId) {
    focusBlock(trailingId, true);
  }
  if (def.type === "video" || def.type === "audio") pickMedia(block, def.type);
}

function closeSlash() {
  slashState.menu?.remove();
  slashState.offKey?.();
  slashState.offOutside?.();
  Object.assign(slashState, { open: false, menu: null, block: null, contentEl: null, query: "" });
}

/* ═══════════ Wiki-links [[...]] ═══════════ */
const wikiState = { open: false, menu: null, block: null, contentEl: null, query: "" };

function maybeWikiLink(content, block) {
  const before = textBeforeCaret(content);
  const m = before.match(/\[\[([^\]]*)$/);
  if (m) {
    wikiState.query = m[1];
    if (!wikiState.open) openWikiMenu(content, block);
    else refreshWikiMenu();
  } else if (wikiState.open) closeWiki();
}

function openWikiMenu(content, block) {
  closeWiki();
  wikiState.open = true;
  wikiState.block = block;
  wikiState.contentEl = content;
  const menu = h("div", { class: "menu", style: "min-width:260px" });
  wikiState.menu = menu;
  document.getElementById("overlay-root").appendChild(menu);
  refreshWikiMenu();
  const r = caretRange();
  positionFloating(menu, r ? r.getBoundingClientRect() : content.getBoundingClientRect(), { gap: 8 });

  const onKey = (e) => {
    if (!wikiState.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeWiki(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...menu.querySelectorAll(".menu-item")];
      const cur = items.findIndex((x) => x.classList.contains("selected"));
      const next = clamp(cur + (e.key === "ArrowDown" ? 1 : -1), 0, items.length - 1);
      items.forEach((x, i) => x.classList.toggle("selected", i === next));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      menu.querySelector(".menu-item.selected")?.click();
    }
  };
  addEventListener("keydown", onKey, true);
  wikiState.offKey = () => removeEventListener("keydown", onKey, true);
}

function refreshWikiMenu() {
  const { menu, query } = wikiState;
  if (!menu) return;
  const pages = listPages()
    .filter((p) => p.id !== state.page.id)
    .map((p) => ({ p, s: query ? fuzzyScore(query, p.title || "") : 1 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  menu.innerHTML = "";
  menu.appendChild(h("div", { class: "menu-label" }, "Linkar página"));
  pages.forEach(({ p }, i) => {
    menu.appendChild(h("button", {
      class: "menu-item" + (i === 0 ? " selected" : ""),
      onclick: () => insertWikiLink(p),
    },
      h("i", { class: "mi-icon" }, p.icon || "▢"),
      h("div", { class: "mi-body" }, h("div", { class: "mi-title" }, p.title || "Sem título"))));
  });
  menu.appendChild(h("button", {
    class: "menu-item" + (!pages.length ? " selected" : ""),
    onclick: () => {
      const np = createPage({ title: query || "Nova página" });
      insertWikiLink(np);
    },
  },
    h("i", { class: "mi-icon" }, "＋"),
    h("div", { class: "mi-body" }, h("div", { class: "mi-title" }, `Criar “${query || "Nova página"}”`))));
}

function insertWikiLink(page) {
  const { contentEl, block } = wikiState;
  closeWiki();
  contentEl.focus();
  // apaga "[[query" antes do caret
  const sel = getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    let node = r.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.slice(0, r.startOffset);
      const idx = text.lastIndexOf("[[");
      if (idx >= 0) {
        const del = document.createRange();
        del.setStart(node, idx);
        del.setEnd(r.startContainer, r.startOffset);
        del.deleteContents();
      }
    }
  }
  const span = h("span", {
    class: "wiki-link", dataset: { pageId: page.id }, contenteditable: "false",
  }, page.title || "Sem título");
  const r2 = getSelection().getRangeAt(0);
  r2.insertNode(span);
  const space = document.createTextNode(" ");
  span.after(space);
  const after = document.createRange();
  after.setStartAfter(space);
  after.collapse(true);
  const s = getSelection();
  s.removeAllRanges(); s.addRange(after);

  block.content = sanitizeInline(contentEl.innerHTML);
  commit();
}

function closeWiki() {
  wikiState.menu?.remove();
  wikiState.offKey?.();
  Object.assign(wikiState, { open: false, menu: null, block: null, contentEl: null, query: "" });
}

/* ═══════════ Menções @página · @data ═══════════ */
const mentionState = { open: false, menu: null, block: null, contentEl: null, query: "" };

function maybeMention(content, block) {
  const before = textBeforeCaret(content);
  const m = before.match(/(?:^|\s)@([^\s@]*)$/); // @ no início ou após espaço
  if (m) {
    mentionState.query = m[1];
    if (!mentionState.open) openMentionMenu(content, block);
    else refreshMentionMenu();
  } else if (mentionState.open) closeMention();
}

function openMentionMenu(content, block) {
  closeMention();
  mentionState.open = true;
  mentionState.block = block;
  mentionState.contentEl = content;
  const menu = h("div", { class: "menu", style: "min-width:260px" });
  mentionState.menu = menu;
  document.getElementById("overlay-root").appendChild(menu);
  refreshMentionMenu();
  const r = caretRange();
  positionFloating(menu, r ? r.getBoundingClientRect() : content.getBoundingClientRect(), { gap: 8 });

  const onKey = (e) => {
    if (!mentionState.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMention(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...menu.querySelectorAll(".menu-item")];
      const cur = items.findIndex((x) => x.classList.contains("selected"));
      const next = clamp(cur + (e.key === "ArrowDown" ? 1 : -1), 0, items.length - 1);
      items.forEach((x, i) => x.classList.toggle("selected", i === next));
      items[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      menu.querySelector(".menu-item.selected")?.click();
    }
  };
  addEventListener("keydown", onKey, true);
  mentionState.offKey = () => removeEventListener("keydown", onKey, true);
  const onOutside = (ev) => { if (!menu.contains(ev.target)) closeMention(); };
  setTimeout(() => addEventListener("pointerdown", onOutside, true), 0);
  mentionState.offOutside = () => removeEventListener("pointerdown", onOutside, true);
}

function refreshMentionMenu() {
  const { menu, query } = mentionState;
  if (!menu) return;
  menu.innerHTML = "";
  const q = query.toLowerCase();
  let idx = 0;
  const item = (icon, title, desc, onclick) => {
    const b = h("button", { class: "menu-item" + (idx === 0 ? " selected" : ""), onclick },
      h("i", { class: "mi-icon" }, icon),
      h("div", { class: "mi-body" }, h("div", { class: "mi-title" }, title), desc ? h("div", { class: "mi-desc" }, desc) : null));
    menu.appendChild(b); idx++;
  };

  // ── Datas ──
  const now = Date.now();
  const dates = [
    { label: "Hoje", date: new Date(now) },
    { label: "Amanhã", date: new Date(now + 86400000) },
    { label: "Ontem", date: new Date(now - 86400000) },
  ].filter((d) => !q || fuzzyScore(q, d.label) >= 0 || "data".startsWith(q) || "date".startsWith(q));
  if (dates.length) {
    menu.appendChild(h("div", { class: "menu-label" }, "Data"));
    dates.forEach((d) => item("📅", d.label, fmtDate(d.date.getTime()), () => insertDateMention(d.date)));
  }

  // ── Páginas ──
  const pages = listPages()
    .filter((p) => p.id !== state.page.id && !p.archived)
    .map((p) => ({ p, s: query ? fuzzyScore(query, p.title || "") : 1 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  if (pages.length) {
    menu.appendChild(h("div", { class: "menu-label" }, "Páginas"));
    pages.forEach(({ p }) => item(p.icon || "▢", p.title || "Sem título", "", () => insertPageMention(p)));
  }

  if (query) item("＋", `Criar “${query}”`, "", () => { const np = createPage({ title: query }); insertPageMention(np); });
  if (!menu.querySelector(".menu-item")) menu.appendChild(h("div", { class: "palette-empty" }, "Sem resultados"));
}

/* Remove o gatilho (ex.: "@query") antes do caret e insere um nó no lugar */
function replaceTriggerWithNode(contentEl, triggerChar, node) {
  const sel = getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const c = r.startContainer;
    if (c.nodeType === Node.TEXT_NODE) {
      const text = c.textContent.slice(0, r.startOffset);
      const i = text.lastIndexOf(triggerChar);
      if (i >= 0) { const del = document.createRange(); del.setStart(c, i); del.setEnd(c, r.startOffset); del.deleteContents(); }
    }
  }
  const r2 = getSelection().getRangeAt(0);
  r2.insertNode(node);
  const space = document.createTextNode(" ");
  node.after(space);
  const after = document.createRange();
  after.setStartAfter(space); after.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(after);
}

function insertPageMention(page) {
  const { contentEl, block } = mentionState;
  closeMention();
  contentEl.focus();
  const span = h("span", { class: "mention mention-page", dataset: { pageId: page.id }, contenteditable: "false" },
    "@" + (page.title || "Sem título"));
  replaceTriggerWithNode(contentEl, "@", span);
  block.content = sanitizeInline(contentEl.innerHTML);
  commit();
}

function insertDateMention(date) {
  const { contentEl, block } = mentionState;
  closeMention();
  contentEl.focus();
  const span = h("span", { class: "mention mention-date", contenteditable: "false" }, "📅 " + fmtDate(date.getTime()));
  replaceTriggerWithNode(contentEl, "@", span);
  block.content = sanitizeInline(contentEl.innerHTML);
  commit();
}

function closeMention() {
  mentionState.menu?.remove();
  mentionState.offKey?.();
  mentionState.offOutside?.();
  Object.assign(mentionState, { open: false, menu: null, block: null, contentEl: null, query: "" });
}

/* ═══════════ Atalhos markdown ═══════════ */
function maybeMarkdownShortcut(content, block) {
  if (block.type === "code") return;
  const text = content.textContent;
  const map = [
    [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^####\s$/, "h4"],
    [/^[-*]\s$/, "bulleted"], [/^1[.)]\s$/, "numbered"],
    [/^\[\]\s$/, "todo"], [/^>\s$/, "quote"], [/^```$/, "code"], [/^---$/, "divider"],
    [/^▸\s$/, "toggle"],
  ];
  for (const [re, type] of map) {
    if (re.test(text) && block.type === "p") {
      block.type = type;
      block.content = "";
      if (type === "code") block.props = { lang: "javascript" };
      commit({ structural: true });
      if (type === "code") {
        const el = state.blocksEl.querySelector(`[data-block-id="${block.id}"] .block-content`);
        if (el) { el.textContent = ""; placeCaret(el, true); }
      } else if (type !== "divider") focusBlock(block.id, true);
      return;
    }
  }
}

/* ═══════════ Menu do bloco (handle) ═══════════ */
function blockMenu(e, block) {
  e.stopPropagation();
  const found = findBlock(block.id);
  showMenu(e.currentTarget, [
    { label: "Transformar em" },
    ...BLOCK_DEFS.filter((d) => TEXTUAL.has(d.type)).slice(0, 9).map((d) => ({
      icon: d.icon, title: d.title,
      action: () => { block.type = d.type; commit({ structural: true }); },
    })),
    { sep: true },
    { icon: "💬", title: comments(block).length ? `Comentários (${comments(block).length})` : "Comentar", action: () => {
      const anchor = state.blocksEl.querySelector(`[data-block-id="${block.id}"] .comment-marker`)
        || state.blocksEl.querySelector(`[data-block-id="${block.id}"]`);
      commentPopover(anchor, block);
    } },
    { icon: "↑", title: "Mover para cima", action: () => moveBlock(block, -1) },
    { icon: "↓", title: "Mover para baixo", action: () => moveBlock(block, +1) },
    { icon: "⧉", title: "Duplicar", kbd: "⌘D", action: () => {
      const copy = structuredClone(block); copy.id = uid("b");
      (copy.children || []).forEach((c) => (c.id = uid("b")));
      found.list.splice(found.index + 1, 0, copy);
      commit({ structural: true });
    } },
    { icon: "🗑", title: "Excluir bloco", danger: true, action: () => {
      found.list.splice(found.index, 1);
      if (!state.page.blocks.length) state.page.blocks.push(makeBlock());
      commit({ structural: true });
    } },
  ]);
}

/* Move um bloco para cima/baixo dentro da sua lista (reordenar sem arrastar — essencial no mobile) */
function moveBlock(block, dir) {
  const found = findBlock(block.id);
  if (!found) return;
  const { list, index } = found;
  const target = index + dir;
  if (target < 0 || target >= list.length) return;
  const [b] = list.splice(index, 1);
  list.splice(target, 0, b);
  commit({ structural: true });
}

/* ═══════════ Drag & drop de blocos ═══════════ */
function setupDrag(handleEl, blockEl, block) {
  handleEl.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/nexus-block", block.id);
    e.dataTransfer.effectAllowed = "move";
    blockEl.classList.add("dragging");
    setTimeout(() => blockEl.classList.add("lifted"), 0);
  });
  handleEl.addEventListener("dragend", () => {
    blockEl.classList.remove("dragging", "lifted");
    state.blocksEl.querySelectorAll(".drag-over-top,.drag-over-bottom")
      .forEach((x) => x.classList.remove("drag-over-top", "drag-over-bottom"));
  });

  blockEl.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes("text/nexus-block")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = blockEl.getBoundingClientRect();
    const top = e.clientY < rect.top + rect.height / 2;
    blockEl.classList.toggle("drag-over-top", top);
    blockEl.classList.toggle("drag-over-bottom", !top);
  });
  blockEl.addEventListener("dragleave", () => {
    blockEl.classList.remove("drag-over-top", "drag-over-bottom");
  });
  blockEl.addEventListener("drop", (e) => {
    const id = e.dataTransfer.getData("text/nexus-block");
    if (!id || id === block.id) return;
    e.preventDefault();
    const rect = blockEl.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const src = findBlock(id);
    const dst = findBlock(block.id);
    if (!src || !dst) return;
    src.list.splice(src.index, 1);
    // recalcula índice de destino após remoção
    const dst2 = findBlock(block.id);
    dst2.list.splice(dst2.index + (before ? 0 : 1), 0, src.block);
    commit({ structural: true });
  });
}

/* ═══════════ Barra de formatação flutuante ═══════════ */
let fmtBar = null;
const scheduleFmtBar = debounce(updateFmtBar, 120);

function updateFmtBar() {
  if (!state) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { hideFmtBar(); return; }
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const blockContent = (container.nodeType === 1 ? container : container.parentElement)?.closest?.(".block-content");
  if (!blockContent || !state.container.contains(blockContent)) { hideFmtBar(); return; }
  const blockEl = blockContent.closest(".block");
  if (blockEl?.dataset.type === "code") { hideFmtBar(); return; }
  const text = sel.toString();
  if (!text.trim()) { hideFmtBar(); return; }

  hideFmtBar();
  const cmd = (name, arg) => (e) => {
    e.preventDefault();
    document.execCommand(name, false, arg);
    syncBlockFromSelection();
  };
  const savedRange = range.cloneRange();

  fmtBar = h("div", { class: "fmt-bar" },
    fmtButton("B", "b", cmd("bold"), "bold"),
    fmtButton("I", "i", cmd("italic"), "italic"),
    fmtButton("U", "u", cmd("underline"), "underline"),
    fmtButton("S", "s", cmd("strikeThrough"), "strikeThrough"),
    fmtButton("‹›", "code", (e) => { e.preventDefault(); wrapSelection("code"); }),
    fmtButton("▉", "mark", (e) => { e.preventDefault(); wrapSelection("mark"); }),
    h("span", { class: "fmt-sep" }),
    fmtButton("🔗", "link", (e) => {
      e.preventDefault();
      const url = prompt("URL do link:");
      if (url) { document.execCommand("createLink", false, url); syncBlockFromSelection(); }
    }),
  );
  // estilo dos botões B/I/U/S
  fmtBar.querySelector('[data-k="b"]').style.fontWeight = "800";
  fmtBar.querySelector('[data-k="i"]').style.fontStyle = "italic";
  fmtBar.querySelector('[data-k="u"]').style.textDecoration = "underline";
  fmtBar.querySelector('[data-k="s"]').style.textDecoration = "line-through";

  document.getElementById("overlay-root").appendChild(fmtBar);
  const rect = range.getBoundingClientRect();
  const barRect = fmtBar.getBoundingClientRect();
  fmtBar.style.top = Math.max(8, rect.top - barRect.height - 8) + "px";
  fmtBar.style.left = clamp(rect.left + rect.width / 2 - barRect.width / 2, 8, innerWidth - barRect.width - 8) + "px";
}

function fmtButton(label, key, onmousedown, queryCmd) {
  const b = h("button", { class: "fmt-btn" + (key === "ai" ? " ai" : ""), dataset: { k: key }, onmousedown }, label);
  if (queryCmd) { try { if (document.queryCommandState(queryCmd)) b.classList.add("on"); } catch {} }
  return b;
}

function wrapSelection(tag) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const el = document.createElement(tag);
  try {
    range.surroundContents(el);
  } catch {
    el.appendChild(range.extractContents());
    range.insertNode(el);
  }
  sel.removeAllRanges();
  syncBlockFromSelection(el);
}

function syncBlockFromSelection(node) {
  const sel = getSelection();
  const anchor = node || (sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null);
  const el = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest?.(".block-content");
  if (!el) return;
  const blockEl = el.closest(".block");
  const found = findBlock(blockEl.dataset.blockId);
  if (found) {
    found.block.content = sanitizeInline(el.innerHTML);
    touchPageBlocks(state.page.id);
  }
}

function hideFmtBar() {
  fmtBar?.remove();
  fmtBar = null;
}

/* ═══════════ Topbar: histórico, foco, menu ═══════════ */
function setupTopbar(page) {
  const actions = document.getElementById("topbar-actions");
  actions.innerHTML = "";

  const focusBtn = h("button", { class: "icon-btn", title: "Modo foco", "aria-label": "Modo foco" }, "◎");
  focusBtn.onclick = () => toggleFocusMode(focusBtn);

  const presBtn = h("button", { class: "icon-btn", title: "Modo apresentação", "aria-label": "Apresentação" }, "▷");
  presBtn.onclick = () => startPresentation(page);

  const historyBtn = h("button", { class: "icon-btn", title: "Histórico de versões", "aria-label": "Histórico" }, "↺");
  historyBtn.onclick = () => showHistory(page);

  const moreBtn = h("button", { class: "icon-btn", title: "Mais opções", "aria-label": "Mais opções" }, "⋯");
  moreBtn.onclick = (e) => showMenu(e.currentTarget, [
    { icon: "★", title: page.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
      action: () => updatePage(page.id, { favorite: !page.favorite }) },
    { icon: "＋", title: "Nova sub-página", action: () => { const c = createPage({ parentId: page.id }); navigate("page", c.id); } },
    { icon: "⧉", title: "Duplicar página", action: () => { const c = duplicatePage(page.id); navigate("page", c.id); } },
    { icon: page.locked ? "🔓" : "🔒", title: page.locked ? "Desbloquear página" : "Bloquear página (somente leitura)",
      action: () => { updatePage(page.id, { locked: !page.locked }); navigate("page", page.id); } },
    { icon: page.private ? "👁" : "🔐", title: page.private ? "Remover privacidade" : "Tornar privada (PIN)",
      action: () => togglePrivate(page) },
    { sep: true },
    { icon: "⬇", title: "Exportar como Markdown", action: () => {
      import("../core/utils.js").then(({ download }) =>
        download((page.title || "pagina") + ".md", pageToMarkdown(page), "text/markdown"));
    } },
    { icon: "⎙", title: "Exportar como PDF (imprimir)", action: () => {
      document.title = page.title || "NEXUS";
      hideFmtBar(); closeMenus();
      setTimeout(() => window.print(), 60);
    } },
    { sep: true },
    { icon: "🗑", title: "Mover para a lixeira", danger: true, action: async () => {
      const kids = pageDescendants(page.id);
      const message = kids.length
        ? `Esta página tem ${kids.length} sub-página${kids.length > 1 ? "s" : ""} — elas também irão para a lixeira. Você pode restaurar tudo depois.`
        : "Você pode restaurar depois na Lixeira.";
      const ok = await confirmDialog({ title: "Mover para a lixeira?", message, confirmText: "Mover", danger: true });
      if (ok) {
        await deletePage(page.id);
        toast(kids.length ? `Página e ${kids.length} sub-página${kids.length > 1 ? "s" : ""} movidas para a lixeira` : "Página movida para a lixeira");
        navigate("home");
      }
    } },
  ], { align: "right" });

  actions.append(presBtn, focusBtn, historyBtn, moreBtn);
}

/* ═══════════ Modo apresentação (página → slides) ═══════════ */
function startPresentation(page) {
  // divide os blocos em slides: novo slide a cada H1/H2 ou divisor
  const slides = [];
  let cur = [];
  const flush = () => { if (cur.length) slides.push(cur); cur = []; };
  (page.blocks || []).forEach((b) => {
    if (b.type === "h1" || b.type === "h2") { flush(); cur.push(b); }
    else if (b.type === "divider") { flush(); }
    else cur.push(b);
  });
  flush();
  if (!slides.length) slides.push(page.blocks);

  let idx = 0;
  const stage = h("div", { class: "present-stage" });
  const counter = h("div", { class: "present-counter" });
  const overlay = h("div", { class: "present-overlay" }, stage,
    h("div", { class: "present-controls" },
      h("button", { class: "present-btn", onclick: () => go(-1) }, "‹"),
      counter,
      h("button", { class: "present-btn", onclick: () => go(1) }, "›"),
      h("button", { class: "present-btn", title: "Sair (Esc)", onclick: close }, "✕")));

  const render = () => {
    stage.innerHTML = "";
    const slide = h("div", { class: "present-slide anim-fade" });
    slides[idx].forEach((b) => { const el = staticBlock(b); if (el && el.nodeType) slide.appendChild(el); });
    stage.appendChild(slide);
    counter.textContent = `${idx + 1} / ${slides.length}`;
  };
  const go = (d) => { idx = clamp(idx + d, 0, slides.length - 1); render(); };
  function close() {
    overlay.remove();
    removeEventListener("keydown", onKey, true);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key)) { e.preventDefault(); go(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
  };
  addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  overlay.requestFullscreen?.().catch(() => {});
  render();
}

/* renderização estática (somente leitura) de um bloco, para apresentação */
function staticBlock(b) {
  const safe = sanitizeInline(b.content || "");
  switch (b.type) {
    case "h1": return h("h1", { class: "ps-h1", html: safe });
    case "h2": return h("h2", { class: "ps-h2", html: safe });
    case "h3": case "h4": return h("h3", { class: "ps-h3", html: safe });
    case "bulleted": return h("li", { class: "ps-li", html: "• " + safe });
    case "numbered": return h("li", { class: "ps-li", html: safe });
    case "todo": return h("div", { class: "ps-li" }, (b.props?.checked ? "☑ " : "☐ "), h("span", { html: safe }));
    case "quote": return h("blockquote", { class: "ps-quote", html: safe });
    case "callout": return h("div", { class: "ps-callout" }, (b.props?.icon || "💡") + " ", h("span", { html: safe }));
    case "code": return h("pre", { class: "ps-code" }, b.content || "");
    case "image": return b.props?.src ? h("img", { class: "ps-img", src: b.props.src }) : "";
    case "divider": return h("hr");
    case "equation": { const d = h("div", { class: "ps-eq" }); loadKatex().then((k) => { try { k.render(b.props?.latex || "", d, { displayMode: true, throwOnError: false }); } catch {} }).catch(() => { d.textContent = b.props?.latex || ""; }); return d; }
    case "dbview": { const d = b.props?.dbId ? getDatabase(b.props.dbId) : null; return d ? h("p", { class: "ps-p" }, `▦ ${d.name} · ${d.rows.length} itens`) : ""; }
    default: return safe ? h("p", { class: "ps-p", html: safe }) : "";
  }
}

function toggleFocusMode(btn) {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle("focus-mode", state.focusMode);
  btn.classList.toggle("active", state.focusMode);
  if (state.focusMode) {
    toast("Modo foco — Esc para sair", { type: "info", icon: "◎" });

    // HUD: contador de palavras + meta diária + tempo
    const goal = getFocusGoal();
    const hud = h("div", { class: "focus-hud" });
    const bar = h("div", { class: "fh-bar" }, h("div", { class: "fh-fill" }));
    const label = h("div", { class: "fh-label" });
    const goalBtn = h("button", { class: "fh-goal", title: "Definir meta de palavras" }, "🎯 meta");
    hud.append(h("div", { class: "fh-count" }, label), bar, goalBtn);
    document.body.appendChild(hud);
    const startWords = pageWordCount(state.page);

    const updateHud = () => {
      const words = pageWordCount(state.page);
      const written = Math.max(0, words - startWords);
      const g = getFocusGoal();
      label.textContent = `${words} palavras · +${written} nesta sessão`;
      const pct = g ? clamp((written / g) * 100, 0, 100) : 0;
      bar.querySelector(".fh-fill").style.width = pct + "%";
      goalBtn.textContent = g ? `🎯 ${written}/${g}` : "🎯 meta";
      if (g && written >= g && !state._goalHit) { state._goalHit = true; toast("Meta de escrita atingida! 🎉", { type: "ok" }); }
    };
    goalBtn.onclick = async () => {
      const v = await promptDialog({ title: "Meta de palavras da sessão", value: String(getFocusGoal() || 300) });
      const n = parseInt(v, 10);
      if (n >= 0) { setFocusGoal(n); state._goalHit = false; updateHud(); }
    };

    const onMove = () => {
      const sel = getSelection();
      const node = sel.anchorNode;
      const blockEl = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".block");
      state.blocksEl.querySelectorAll(".focus-current").forEach((x) => x.classList.remove("focus-current"));
      if (blockEl) {
        blockEl.classList.add("focus-current");
        blockEl.scrollIntoView({ block: "center", behavior: "smooth" }); // scroll estilo máquina de escrever
      }
    };
    const onInput = () => updateHud();
    const onEsc = (e) => { if (e.key === "Escape") toggleFocusMode(btn); };
    document.addEventListener("selectionchange", onMove);
    state.blocksEl.addEventListener("input", onInput, true);
    addEventListener("keydown", onEsc);
    updateHud();
    state.focusCleanup = () => {
      document.removeEventListener("selectionchange", onMove);
      state.blocksEl?.removeEventListener("input", onInput, true);
      removeEventListener("keydown", onEsc);
      hud.remove();
      state._goalHit = false;
    };
  } else {
    state.focusCleanup?.();
    state.blocksEl?.querySelectorAll(".focus-current").forEach((x) => x.classList.remove("focus-current"));
  }
}
function getFocusGoal() { return Number(getSetting("writeGoal", 300)) || 0; }
function setFocusGoal(n) { setSetting("writeGoal", n); }

/* ═══════════ Histórico de versões com diff ═══════════ */
async function showHistory(page) {
  const versions = await listVersions(page.id);
  const body = h("div", {});
  if (!versions.length) {
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "↺"),
      h("div", { class: "es-desc" }, "Snapshots automáticos aparecem aqui conforme você edita.")));
  }
  versions.forEach((v) => {
    const diffBtn = h("button", { class: "btn ghost sm" }, "Ver diff");
    const restoreBtn = h("button", { class: "btn sm" }, "Restaurar");
    const row = h("div", { class: "version-item" },
      h("div", {},
        h("div", { style: "font-weight:550" }, fmtRelative(v.ts)),
        h("div", { style: "font-size:var(--fs-xs);color:var(--text-3)" },
          new Date(v.ts).toLocaleString("pt-BR"))),
      h("div", { style: "display:flex;gap:6px" }, diffBtn, restoreBtn));
    diffBtn.onclick = () => {
      const cur = state.page.blocks.map((b) => stripHtml(b.content)).join("\n");
      const old = v.blocks.map((b) => stripHtml(b.content)).join("\n");
      const diffEl = renderDiff(old, cur);
      showModal({ title: "Diferenças (versão → atual)", body: diffEl, width: 640 });
    };
    restoreBtn.onclick = async () => {
      await restoreVersion(page.id, v.id);
      m.close();
      toast("Versão restaurada");
      navigate("page", page.id);
    };
    body.appendChild(row);
  });
  const m = showModal({ title: "Histórico de versões", body, width: 520 });
}

function renderDiff(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const out = h("div", { style: "font-size:var(--fs-sm);line-height:1.7;font-family:var(--font-mono);white-space:pre-wrap" });
  oldLines.forEach((l) => {
    if (!newSet.has(l) && l.trim()) out.appendChild(h("div", {}, h("span", { class: "diff-del" }, l)));
  });
  newLines.forEach((l) => {
    if (!oldSet.has(l) && l.trim()) out.appendChild(h("div", {}, h("span", { class: "diff-add" }, l)));
  });
  if (!out.children.length) out.appendChild(h("div", { style: "color:var(--text-3)" }, "Sem diferenças de texto."));
  return out;
}
